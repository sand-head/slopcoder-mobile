/**
 * The HTTP half of the client, ported from `src/SlopCoder.Client/SeamHttpClient.cs`.
 *
 * Three behaviours are load-bearing and none of them are obvious:
 *
 * - **`X-Slopcoder-Client` on every mutation.** `SameOriginFilter` guards the
 *   whole `/api/seam` group and answers a missing header with a bare 403 and no
 *   body. It applies to bearer-key callers too, not just browsers.
 * - **404 means null, not failure.** The seam returns it for "no such session"
 *   and for "not yours", deliberately indistinguishable.
 * - **401 means the credential died.** `/api` and `/hubs` answer with a bare
 *   401 rather than redirecting to the login page, precisely so a programmatic
 *   client can act on it. Signing out is the only correct response.
 */
import type {
  AgentEventEnvelope,
  CreateSessionRequest,
  CreateSessionResult,
  DeviceKey,
  FacetOption,
  GitRepoListing,
  GitRepoRow,
  ModelCandidate,
  PairRequest,
  PasswordLoginRequest,
  RemoteNodeSummary,
  ResolveApprovalRequest,
  ResolveQuestionRequest,
  ServerProtocol,
  SessionState,
  SessionSummary,
  SetApprovalRequest,
  SetFacetRequest,
  SetThinkingRequest,
  StartSessionRequest,
  SteerRequest,
  UsageDashboard,
} from './contracts';
import { UsageRange } from './contracts';

/** The header `SameOriginFilter` demands. Any value works; the web client sends "1". */
export const CLIENT_HEADER = 'X-Slopcoder-Client';

/** Thrown when the server rejects our key. The app signs out rather than retrying. */
export class SignedOutError extends Error {
  constructor() {
    super('The server rejected this device’s key.');
    this.name = 'SignedOutError';
  }
}

/**
 * The server could not be reached at all — no DNS, no route, no listener, or the
 * phone has no network.
 *
 * Distinct from `SeamError` on purpose: a 500 means slopcoder is there and
 * unhappy, and the two want different words and different remedies. `fetch`
 * reports both as exceptions, so the classification has to happen here or every
 * screen ends up showing "TypeError: Network request failed".
 */
export class OfflineError extends Error {
  constructor() {
    super('Could not reach slopcoder.');
    this.name = 'OfflineError';
  }
}

export class SeamError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'SeamError';
  }
}

export interface SeamOptions {
  baseUrl: string;
  apiKey: string;
  /** Called once when a 401 proves the key is dead. */
  onSignedOut?: () => void;
  /**
   * Reachability, reported from whether calls actually complete rather than
   * from the OS. A phone with full bars and no route to this server is offline
   * as far as anything here is concerned.
   */
  onReachable?: (reachable: boolean) => void;
}

export class Seam {
  readonly baseUrl: string;
  readonly apiKey: string;
  private readonly onSignedOut?: () => void;
  private readonly onReachable?: (reachable: boolean) => void;

  constructor({ baseUrl, apiKey, onSignedOut, onReachable }: SeamOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.onSignedOut = onSignedOut;
    this.onReachable = onReachable;
  }

  // ---- transport ----

  /**
   * The one place a status is interpreted. Callers get the code back as well as
   * the body, because 404 means different things to a read and to a command and
   * collapsing both to null loses that.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<{ status: number; value: T | null }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    // GET and HEAD are exempt from the filter, but sending it always is what
    // the reference client does and costs nothing.
    headers[CLIENT_HEADER] = '1';
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      // An aborted request is the caller changing its mind, not a dead server.
      if (error instanceof Error && error.name === 'AbortError') throw error;
      this.onReachable?.(false);
      throw new OfflineError();
    }

    // Anything with a status code means we got there, whatever it says.
    this.onReachable?.(true);

    if (response.status === 401) {
      this.onSignedOut?.();
      throw new SignedOutError();
    }
    if (response.status === 404) return { status: 404, value: null };
    if (!response.ok) {
      throw new SeamError(response.status, `${method} ${path} failed: ${response.status}`);
    }
    if (response.status === 204) return { status: 204, value: null };

    const text = await response.text();
    return { status: response.status, value: text.length === 0 ? null : (JSON.parse(text) as T) };
  }

  private async send<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T | null> {
    return (await this.request<T>(method, path, body, signal)).value;
  }

  get<T>(path: string, signal?: AbortSignal) {
    return this.send<T>('GET', path, undefined, signal);
  }

  /**
   * True when the command landed. A 404 is false, not an error: the session is
   * gone, the turn already ended, or the approval was answered elsewhere — all
   * things the caller must handle rather than treat as success.
   */
  async post(path: string, body?: unknown, signal?: AbortSignal): Promise<boolean> {
    const { status } = await this.request<void>('POST', path, body ?? {}, signal);
    return status !== 404;
  }

  // ---- sessions ----

  async sessions(signal?: AbortSignal): Promise<SessionSummary[]> {
    return (await this.get<SessionSummary[]>('api/seam/sessions/', signal)) ?? [];
  }

  session(id: string, signal?: AbortSignal) {
    return this.get<SessionState>(`api/seam/sessions/${id}`, signal);
  }

  /**
   * `take=0` means no limit. The tail window the cockpit opens with is
   * `from = nextOrdinal - window`; gap pulls use the local cursor.
   */
  async scrollback(id: string, from: number, take = 0, signal?: AbortSignal) {
    return (
      (await this.get<AgentEventEnvelope[]>(
        `api/seam/sessions/${id}/scrollback?from=${from}&take=${take}`,
        signal,
      )) ?? []
    );
  }

  /** Creating is cheap and synchronous; starting the turn is not. Hence two calls. */
  async createSession(request: CreateSessionRequest): Promise<string | null> {
    const result = await this.send<CreateSessionResult>('POST', 'api/seam/sessions/', request);
    return result?.id ?? null;
  }

  start(id: string, request: StartSessionRequest) {
    return this.post(`api/seam/sessions/${id}/start`, request);
  }

  /** False when no turn is in flight — the caller should start one instead. */
  steer(id: string, request: SteerRequest) {
    return this.post(`api/seam/sessions/${id}/steer`, request);
  }

  stop(id: string) {
    return this.post(`api/seam/sessions/${id}/stop`);
  }

  /**
   * Bumps the idle clock and respawns a stopped container in the background.
   * The reaper stops idle sandboxes, so a viewer that never says it is here
   * makes the next prompt pay a cold start.
   */
  presence(id: string) {
    return this.post(`api/seam/sessions/${id}/presence`);
  }

  approve(id: string, request: ResolveApprovalRequest) {
    return this.post(`api/seam/sessions/${id}/approvals`, request);
  }

  answer(id: string, request: ResolveQuestionRequest) {
    return this.post(`api/seam/sessions/${id}/questions`, request);
  }

  rename(id: string, name: string) {
    return this.send<void>('PUT', `api/seam/sessions/${id}/name`, { name });
  }

  setThinking(id: string, request: SetThinkingRequest) {
    return this.send<void>('PUT', `api/seam/sessions/${id}/thinking`, request);
  }

  setApprovalMode(id: string, request: SetApprovalRequest) {
    return this.send<void>('PUT', `api/seam/sessions/${id}/approval-mode`, request);
  }

  setFacet(id: string, request: SetFacetRequest) {
    return this.send<void>('PUT', `api/seam/sessions/${id}/facet`, request);
  }

  deleteSession(id: string) {
    return this.send<{ result: number }>('DELETE', `api/seam/sessions/${id}`);
  }

  // ---- catalogs ----

  async models(signal?: AbortSignal): Promise<ModelCandidate[]> {
    return (await this.get<ModelCandidate[]>('api/seam/connections/candidates', signal)) ?? [];
  }

  async facets(signal?: AbortSignal): Promise<FacetOption[]> {
    return (await this.get<FacetOption[]>('api/seam/user-config/facet-catalog', signal)) ?? [];
  }

  async recentRepos(take = 6, signal?: AbortSignal): Promise<string[]> {
    return (await this.get<string[]>(`api/seam/sessions/recent-repos?take=${take}`, signal)) ?? [];
  }

  async repos(signal?: AbortSignal): Promise<GitRepoListing> {
    return (
      (await this.get<GitRepoListing>('api/seam/git/repos', signal)) ?? { repos: [], errors: [] }
    );
  }

  async searchRepos(query: string, signal?: AbortSignal): Promise<GitRepoRow[]> {
    const listing = await this.get<GitRepoListing>(
      `api/seam/git/repos/search?q=${encodeURIComponent(query)}`,
      signal,
    );
    return listing?.repos ?? [];
  }

  async nodes(signal?: AbortSignal): Promise<RemoteNodeSummary[]> {
    return (await this.get<RemoteNodeSummary[]>('api/seam/nodes/', signal)) ?? [];
  }

  usage(range: UsageRange, signal?: AbortSignal) {
    return this.get<UsageDashboard>(`api/seam/usage?range=${UsageRange[range]}`, signal);
  }

  protocol(signal?: AbortSignal) {
    return this.get<ServerProtocol>('api/seam/protocol', signal);
  }

  /** The cheap "is this key still good" probe the terminal client runs at startup. */
  async probe(): Promise<boolean> {
    try {
      await this.sessions();
      return true;
    } catch {
      return false;
    }
  }
}

// ---- device auth: the only calls made without a key ----

async function claim(baseUrl: string, path: string, body: unknown): Promise<DeviceKey> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // A typo'd address and a server that is down look identical from here, and
    // both are "could not reach" rather than "wrong password".
    throw new OfflineError();
  }

  const text = await response.text();
  const payload = text.length > 0 ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new SeamError(response.status, payload.error ?? 'invalid');
  }
  return payload as DeviceKey;
}

export function loginWithPassword(baseUrl: string, request: PasswordLoginRequest) {
  return claim(baseUrl, '/api/auth/device/password', request);
}

export function redeemPairingCode(baseUrl: string, request: PairRequest) {
  return claim(baseUrl, '/api/auth/device/pair', request);
}

/** `slopcoder://pair?server=<url>&code=<CODE>` — what the settings page draws. */
export function parsePairingUri(raw: string): { server: string; code: string } | null {
  const match = /^slopcoder:\/\/pair\?(.*)$/.exec(raw.trim());
  if (!match) return null;

  const params = new URLSearchParams(match[1]);
  const server = params.get('server');
  const code = params.get('code');
  return server && code ? { server, code } : null;
}
