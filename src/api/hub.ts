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
}

export class SessionHub {
  private connection: HubConnection | null = null;
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

  async start(): Promise<void> {
    if (this.connection || this.stopped) return;

    const { baseUrl, apiKey } = this.options;
    const connection = new HubConnectionBuilder()
      .withUrl(`${baseUrl.replace(/\/+$/, '')}/hubs/session`, {
        // Bearer on negotiate, then `?access_token=` on the socket handshake —
        // the server accepts the query form only on /hubs/*. Pinned to
        // WebSockets because React Native has no EventSource, so an SSE
        // fallback fails looking like a hung connection rather than an error.
        // Negotiation is left on: it surfaces a dead key as a clean 401.
        accessTokenFactory: () => apiKey,
        transport: HttpTransportType.WebSockets,
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
      this.options.onStateChange?.(true);
      void this.resubscribeAll();
    });
    connection.onreconnecting(() => this.options.onStateChange?.(false));
    connection.onclose(() => {
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
      this.options.onStateChange?.(false);
      this.scheduleRetry();
      throw error;
    }

    this.attempts = 0;
    this.options.onStateChange?.(true);
    await this.resubscribeAll();
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
