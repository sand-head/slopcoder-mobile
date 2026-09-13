/**
 * The live half of the client, ported from `src/SlopCoder.Client/HubSessionApi.cs`.
 *
 * Commands go over REST; this connection only *receives*. The hub exposes
 * `Subscribe`/`Unsubscribe` and nothing else, deliberately — every mutation
 * revalidates the credential on its own request.
 *
 * Two hazards worth stating plainly:
 *
 * - **A SignalR argument-list mismatch never throws.** If `Delta` is registered
 *   with the wrong arity the client cannot bind the invocation, logs where
 *   nobody looks, and drops it — every live update dies while the unit tests
 *   stay green. `Delta` takes exactly four arguments. `scripts/wire-check.cjs`
 *   pins it against a live server, mirroring `SessionHubWireTests.cs`.
 * - **Group membership does not survive a reconnect.** Every subscription must
 *   be re-established and re-seeded, or the session goes quiet while looking
 *   connected. On a phone this is the common case, not the edge case.
 * - **`withAutomaticReconnect` does not cover the first handshake.** It retries
 *   a socket that dropped after connecting once and nothing else, so a launch
 *   with no network leaves a hub that will never try again. This class owns
 *   that retry.
 * - **A transport that cannot connect is silent.** Whatever goes wrong — a
 *   proxy that will not upgrade, an auth scheme the socket handshake does not
 *   carry, a network that eats WebSockets — surfaces to the app as a connection
 *   that simply never arrives. So: long polling is allowed as a fallback, and
 *   the reason the last attempt failed is kept for the UI to show. Neither is
 *   a guess about which of those it is; they are what turns the next failure
 *   into something readable instead of another round of theories.
 */
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  HttpTransportType,
  type IRetryPolicy,
} from '@microsoft/signalr';
import type { AgentEventEnvelope, LivePatch, SessionState } from './contracts';

/**
 * SignalR's default policy gives up after about forty seconds. A phone loses
 * its socket every time the screen sleeps, so giving up is never right: back
 * off to every thirty seconds and keep trying until told to stop.
 */
class SteadyRetry implements IRetryPolicy {
  nextRetryDelayInMilliseconds(context: { previousRetryCount: number }): number {
    switch (context.previousRetryCount) {
      case 0:
        return 0;
      case 1:
        return 2_000;
      case 2:
        return 10_000;
      default:
        return 30_000;
    }
  }
}

export interface DeltaHandler {
  (
    sessionId: string,
    state: SessionState,
    events: AgentEventEnvelope[],
    patch: LivePatch | null,
  ): void;
}

export interface SessionHubOptions {
  baseUrl: string;
  apiKey: string;
  /** The session registry changed — re-list. Carries no payload by design. */
  onRegistryChanged?: () => void;
  onStateChange?: (connected: boolean) => void;
  /** Why the connection is not up, or null once it is. */
  onTrouble?: (reason: string | null) => void;
}

export class SessionHub {
  private connection: HubConnection | null = null;
  /** Why the last attempt failed, for a UI that would otherwise say nothing. */
  private failure: string | null = null;
  /** Our retry, for the attempts SignalR's own policy does not make. */
  private readonly retry = new SteadyRetry();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private stopped = false;
  /** Per-session handlers. A session with none left is unsubscribed. */
  private readonly listeners = new Map<string, Set<DeltaHandler>>();
  private readonly registryListeners = new Set<() => void>();
  private readonly options: SessionHubOptions;

  constructor(options: SessionHubOptions) {
    this.options = options;
  }

  get connected(): boolean {
    return this.connection?.state === HubConnectionState.Connected;
  }

  /** What went wrong last, or null if nothing has. */
  get lastFailure(): string | null {
    return this.failure;
  }

  async start(): Promise<void> {
    if (this.connection || this.stopped) return;

    const { baseUrl, apiKey } = this.options;
    const connection = new HubConnectionBuilder()
      .withUrl(`${baseUrl.replace(/\/+$/, '')}/hubs/session`, {
        // Bearer on negotiate. On the socket itself SignalR picks the form by
        // platform: under React Native it sends `Authorization` as a handshake
        // header, elsewhere `?access_token=`. The server takes either.
        //
        // WebSockets first, long polling second, and **no** server-sent events:
        // React Native has no EventSource, so SSE fails looking like a hung
        // connection rather than an error. Long polling is worse on battery and
        // immeasurably better than a transcript that never updates, and it is
        // reached only when the socket cannot be established at all.
        //
        // Negotiation is left on: it surfaces a dead key as a clean 401, and a
        // fallback cannot happen without it.
        accessTokenFactory: () => apiKey,
        // eslint-disable-next-line no-bitwise -- HttpTransportType is a flags enum.
        transport: HttpTransportType.WebSockets | HttpTransportType.LongPolling,
      })
      .withAutomaticReconnect(new SteadyRetry())
      .build();

    // Exactly four parameters. See the note at the top of this file.
    connection.on(
      'Delta',
      (
        sessionId: string,
        state: SessionState,
        events: AgentEventEnvelope[],
        patch: LivePatch | null,
      ) => {
        for (const handler of this.listeners.get(sessionId) ?? []) {
          handler(sessionId, state, events ?? [], patch ?? null);
        }
      },
    );

    connection.on('RegistryChanged', () => {
      this.options.onRegistryChanged?.();
      for (const listener of this.registryListeners) listener();
    });

    connection.onreconnected(() => {
      this.attempts = 0;
      this.note(null);
      this.options.onStateChange?.(true);
      void this.resubscribeAll();
    });
    connection.onreconnecting(error => {
      this.note(error);
      this.options.onStateChange?.(false);
    });
    connection.onclose(error => {
      this.note(error);
      this.options.onStateChange?.(false);
      // `stop()` clears the field before closing, so reaching here still
      // holding it means SignalR gave up rather than that we asked it to.
      if (this.connection !== connection) return;

      this.connection = null;
      this.scheduleRetry();
    });

    this.connection = connection;

    try {
      await connection.start();
    } catch (error) {
      // Leaving a never-started connection assigned would wedge the hub for the
      // life of the process: every later `start()` — the foreground poke, a
      // screen mounting — returns at the guard above, and the automatic
      // reconnect policy never engages for a handshake that did not happen. The
      // app then sits behind "Reconnecting to live updates…" forever.
      this.connection = null;
      this.note(error);
      this.options.onStateChange?.(false);
      this.scheduleRetry();
      throw error;
    }

    this.attempts = 0;
    this.note(null);
    this.options.onStateChange?.(true);
    await this.resubscribeAll();
  }

  /**
   * Keep the reason, and tell whoever is listening.
   *
   * SignalR's own messages are the useful ones here — "Failed to complete
   * negotiation", a status code, a transport name — and they are otherwise
   * written to a console nobody can read on a phone.
   */
  private note(error: unknown): void {
    const reason =
      error == null
        ? null
        : error instanceof Error
          ? error.message
          : String(error);

    this.failure = reason;
    this.options.onTrouble?.(reason);
  }

  /**
   * Try again later, on the same cadence a dropped socket gets. The first delay
   * is floored: `SteadyRetry` answers 0 for a drop, which is right when the
   * socket was up a moment ago and a busy loop when the server is simply down.
   */
  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer || this.connection) return;

    const delay = this.retry.nextRetryDelayInMilliseconds({ previousRetryCount: this.attempts++ });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.start().catch(() => {});
    }, Math.max(delay, 1_000));
  }

  /** "Something in your session list changed" — the push carries no payload. */
  addRegistryListener(listener: () => void): () => void {
    this.registryListeners.add(listener);
    return () => this.registryListeners.delete(listener);
  }

  addListener(sessionId: string, handler: DeltaHandler): void {
    const existing = this.listeners.get(sessionId);
    if (existing) existing.add(handler);
    else this.listeners.set(sessionId, new Set([handler]));
  }

  removeListener(sessionId: string, handler: DeltaHandler): void {
    const existing = this.listeners.get(sessionId);
    if (!existing) return;

    existing.delete(handler);
    if (existing.size === 0) this.listeners.delete(sessionId);
  }

  /** Returns the seed state — the snapshot every later delta is relative to. */
  async subscribe(sessionId: string): Promise<SessionState | null> {
    if (!this.connected) return null;

    return (await this.connection!.invoke<SessionState>('Subscribe', sessionId)) ?? null;
  }

  async unsubscribe(sessionId: string): Promise<void> {
    // Someone else on this screen stack may still be watching.
    if (this.listeners.has(sessionId) || !this.connected) return;

    try {
      await this.connection!.invoke('Unsubscribe', sessionId);
    } catch {
      // A connection that dropped has already forgotten the group.
    }
  }

  /**
   * After a reconnect the server has forgotten every group, so re-join each
   * one and hand the listeners a fresh state. They treat it as a state-only
   * delta, which is exactly what drives the gap machinery to heal the hole the
   * disconnection left.
   */
  private async resubscribeAll(): Promise<void> {
    for (const sessionId of [...this.listeners.keys()]) {
      try {
        const state = await this.connection!.invoke<SessionState>('Subscribe', sessionId);
        if (!state) continue;

        for (const handler of this.listeners.get(sessionId) ?? []) {
          handler(sessionId, state, [], null);
        }
      } catch {
        // The next reconnect will try again.
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    const connection = this.connection;
    this.connection = null;
    this.listeners.clear();
    this.registryListeners.clear();
    await connection?.stop();
  }
}
