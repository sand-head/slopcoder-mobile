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
  ApiKeySummary,
  AutomationDraft,
  AutomationSaveResult,
  AutomationSummary,
  ChannelDraft,
  ChannelSummary,
  CodexDeviceStart,
  CodexPollResult,
  ConnectionSummary,
  CreateConnectionRequest,
  CreateResult,
  CreateSessionRequest,
  CreateSessionResult,
  DeviceKey,
  DevicePairingCode,
  FacetCheck,
  FacetOption,
  GitAppSummary,
  GitConnectionSummary,
  GitRepoListing,
  GitRepoRow,
  McpServerRequest,
  McpServerSummary,
  ArtifactDetail,
  ArtifactSummary,
  MemorySummary,
  MintedApiKey,
  ModelCandidate,
  ModelOption,
  ModelTier,
  NodeCreateResult,
  NodeKeyResult,
  NodeTestResult,
  PairRequest,
  PasswordLoginRequest,
  PermissionsCheck,
  RemoteNodeRequest,
  RemoteNodeSummary,
  ResolveApprovalRequest,
  ResolveQuestionRequest,
  RoutineBoard,
  RoutineDetail,
  RoutineDraftResult,
  RoutineStatus,
  RunDetail,
  RunPage,
  SaveMemoryRequest,
  ScheduleParse,
  ServerProtocol,
  SessionState,
  SessionSummary,
  SetApprovalRequest,
  SetFacetRequest,
  SetThinkingRequest,
  SlashCommandInfo,
  SlashResult,
  StartSessionRequest,
  SteerRequest,
  TerminalDefaults,
  TerminalPrefs,
  TextResult,
  UsageDashboard,
  UserFacetSummary,
  UserSkillSummary,
} from './contracts';
import { CodexPollStatus, UsageRange } from './contracts';

/** `?tz=Europe/Berlin`, or nothing at all when the phone could not name its zone. */
function zone(timeZoneId?: string): string {
  return timeZoneId ? `?tz=${encodeURIComponent(timeZoneId)}` : '';
}

/** What a 404 on a board means: the user has nothing, not that we failed. */
const EMPTY_BOARD: RoutineBoard = {
  routines: [],
  failures: [],
  heartbeat: null,
  runsToday: 0,
  notifiedToday: 0,
  quietToday: 0,
  failedToday: 0,
  upcoming: [],
  recentRuns: [],
};

const EMPTY_STATUS: RoutineStatus = {
  anyRoutines: false,
  anyFailed: false,
  newestFailure: null,
  latestNotified: null,
  upcoming: [],
};

/** A write that came back with no body at all, which a save never should. */
const SAVE_UNANSWERED: AutomationSaveResult = {
  error: 'The server did not say whether that was saved.',
  webhooks: [],
};

const PARSE_UNANSWERED: ScheduleParse = {
  ok: false,
  cron: null,
  zone: null,
  sentence: null,
  firstRun: null,
  error: 'the server did not answer',
};

const DRAFT_UNANSWERED: RoutineDraftResult = {
  ok: false,
  error: 'The server did not answer.',
  name: null,
  prompt: null,
  model: null,
  triggers: [],
  deliveryKind: 1,
  deliveryTargetId: null,
  reading: [],
  elapsedMs: 0,
  draftedBy: null,
};

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

  /**
   * A command that answers with a validation problem rather than throwing.
   *
   * The routines seam returns `TextResult` — `{value}` — where a null value
   * means it worked and a string is the sentence to show. A bare null body
   * would be ambiguous with an empty 204, which is why the server wraps it; the
   * 404 is ours to word, since the seam deliberately cannot tell "no such
   * routine" from "not yours".
   */
  private async problem(path: string, body?: unknown): Promise<string | null> {
    return this.textResult('POST', path, body ?? {}, 'That routine is gone.');
  }

  /**
   * The same `{value}` answer, from any settings command. The seam answers a
   * 404 for "no such row" and "not yours" alike, so the sentence is ours.
   */
  private async textResult(
    method: string,
    path: string,
    body: unknown,
    gone: string,
  ): Promise<string | null> {
    const { status, value } = await this.request<TextResult>(method, path, body);
    if (status === 404) return gone;
    return value?.value ?? null;
  }

  /**
   * A command that answers 204 or 404 and nothing else: true when it landed.
   * A PUT, mostly — the settings pages flip switches with these.
   */
  private async landed(method: string, path: string, body?: unknown): Promise<boolean> {
    const { status } = await this.request<void>(method, path, body ?? {});
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

  // ---- slash commands ----
  //
  // Parsing happens here (`api/slash.ts`), running happens there: the commands
  // want the sandbox, the facet catalogue and the live model.

  /**
   * Every command this session offers — the built-ins, plus whatever
   * `.slopcoder/commands/*.md` each attached repository defines.
   *
   * Reading the repo templates walks the sandbox, so this is asked for the
   * first time a slash is typed rather than when the screen opens: a session
   * nobody runs a command in never wakes a container to list them.
   */
  async slashCommands(id: string, signal?: AbortSignal): Promise<SlashCommandInfo[]> {
    return (await this.get<SlashCommandInfo[]>(`api/seam/sessions/${id}/slash/`, signal)) ?? [];
  }

  /**
   * Runs it, and answers with the prompt to send when a repo template expanded.
   *
   * Null covers three things the caller treats alike — a command that handled
   * itself (204), a session that is gone or not ours (404), and an input the
   * server did not read as a command at all. In every one of them there is
   * nothing left to send; what the command had to say is already in the
   * scrollback.
   */
  runSlashCommand(id: string, input: string) {
    return this.send<SlashResult>('POST', `api/seam/sessions/${id}/slash/`, { input });
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

  /**
   * A bare array, not a listing. `/git/repos` answers `{repos, errors}` because
   * a fan-out can half-fail; `/git/repos/search` is best-effort and answers the
   * rows alone (`SeamEndpoints.cs`, `IGitApi.SearchRepositoriesAsync`). Reading
   * it as a listing yielded `undefined.repos` — so every search came back empty
   * and the attach sheet only ever showed recent sessions' repositories.
   */
  async searchRepos(query: string, signal?: AbortSignal): Promise<GitRepoRow[]> {
    return (
      (await this.get<GitRepoRow[]>(
        `api/seam/git/repos/search?q=${encodeURIComponent(query)}`,
        signal,
      )) ?? []
    );
  }

  async nodes(signal?: AbortSignal): Promise<RemoteNodeSummary[]> {
    return (await this.get<RemoteNodeSummary[]>('api/seam/nodes/', signal)) ?? [];
  }

  /** Every channel connection the caller owns: what a trigger listens on, where an answer goes. */
  async channels(signal?: AbortSignal): Promise<ChannelSummary[]> {
    return (await this.get<ChannelSummary[]>('api/seam/channels/', signal)) ?? [];
  }

  // ---- routines ----
  //
  // The paths still say `automations`: the entities kept that name and the
  // screens took the new one (`docs/general-assistant.md`). Every read here is
  // already folded server-side, so a screen is one call and no arithmetic.

  /**
   * The whole board. `tz` is the phone's own zone, which is what "today" is
   * counted in — leave it off and the server counts in UTC, which is somebody
   * else's midnight.
   */
  async routineBoard(tz?: string, signal?: AbortSignal): Promise<RoutineBoard> {
    return (
      (await this.get<RoutineBoard>(`api/seam/automations/board${zone(tz)}`, signal)) ?? EMPTY_BOARD
    );
  }

  /** The cheap read behind the sessions screen's strip. */
  async routineStatus(tz?: string, signal?: AbortSignal): Promise<RoutineStatus> {
    return (
      (await this.get<RoutineStatus>(`api/seam/automations/status${zone(tz)}`, signal)) ??
      EMPTY_STATUS
    );
  }

  /** Null when it is not the caller's, which is indistinguishable from gone. */
  routine(id: string, signal?: AbortSignal) {
    return this.get<RoutineDetail>(`api/seam/automations/${id}/detail`, signal);
  }

  async routineRuns(id: string, skip: number, take: number, signal?: AbortSignal): Promise<RunPage> {
    return (
      (await this.get<RunPage>(
        `api/seam/automations/${id}/runs/page?skip=${skip}&take=${take}`,
        signal,
      )) ?? { runs: [], total: 0 }
    );
  }

  routineRun(id: string, runId: string, signal?: AbortSignal) {
    return this.get<RunDetail>(`api/seam/automations/${id}/runs/${runId}`, signal);
  }

  setRoutineEnabled(id: string, enabled: boolean) {
    return this.problem(`api/seam/automations/${id}/enabled/${enabled}`);
  }

  /** Start a run right now, ignoring active hours. */
  runRoutineNow(id: string) {
    return this.problem(`api/seam/automations/${id}/run`);
  }

  /** Run it again, recording the new run as this one's retry. */
  retryRoutineRun(id: string, runId: string) {
    return this.problem(`api/seam/automations/${id}/runs/${runId}/retry`);
  }

  setTriggerEnabled(id: string, triggerId: string, enabled: boolean) {
    return this.problem(`api/seam/automations/${id}/triggers/${triggerId}/enabled/${enabled}`);
  }

  /** Start a manual run tagged with one trigger, as if it had fired. */
  fireTrigger(id: string, triggerId: string) {
    return this.problem(`api/seam/automations/${id}/triggers/${triggerId}/fire`);
  }

  setRoutinePrompt(id: string, prompt: string) {
    return this.problem(`api/seam/automations/${id}/prompt`, { value: prompt });
  }

  /** Replace the agent-maintained scratch the heartbeat watches. */
  setRoutineNotepad(id: string, notepad: string) {
    return this.problem(`api/seam/automations/${id}/notepad`, { value: notepad });
  }

  /** False when it was already gone, or was never the caller's. */
  async deleteRoutine(id: string): Promise<boolean> {
    const { status } = await this.request<void>('DELETE', `api/seam/automations/${id}`);
    return status !== 404;
  }

  /**
   * The caller's heartbeat, creating it — paused, on the default schedule — the
   * first time anyone asks. At most one exists per user, so this is safe to
   * call from a button that says "set it up".
   */
  heartbeat(): Promise<AutomationSummary | null> {
    return this.send<AutomationSummary>('POST', 'api/seam/automations/heartbeat', {});
  }

  // ---- authoring ----
  //
  // A create or an update answers with a result rather than a TextResult: a
  // write may mint a webhook secret, and that is the one moment it is ever
  // readable. `error` null means it worked.

  /** Every routine, in the editable shape. */
  async routines(signal?: AbortSignal): Promise<AutomationSummary[]> {
    return (await this.get<AutomationSummary[]>('api/seam/automations/', signal)) ?? [];
  }

  async createRoutine(draft: AutomationDraft): Promise<AutomationSaveResult> {
    return (
      (await this.send<AutomationSaveResult>('POST', 'api/seam/automations/', draft)) ??
      SAVE_UNANSWERED
    );
  }

  /** A 404 is worded here: the seam cannot tell "no such routine" from "not yours". */
  async updateRoutine(id: string, draft: AutomationDraft): Promise<AutomationSaveResult> {
    const { status, value } = await this.request<AutomationSaveResult>(
      'PUT',
      `api/seam/automations/${id}`,
      draft,
    );
    if (status === 404) return { error: 'That routine is gone.', webhooks: [] };
    return value ?? SAVE_UNANSWERED;
  }

  /**
   * Mint a fresh secret for one webhook trigger, invalidating the old one at
   * once. The URL keeps its trigger id; what changes is the credential.
   */
  async rotateWebhookSecret(id: string, triggerId: string): Promise<AutomationSaveResult> {
    const { status, value } = await this.request<AutomationSaveResult>(
      'POST',
      `api/seam/automations/${id}/webhooks/${triggerId}/rotate`,
      {},
    );
    if (status === 404) return { error: 'That routine is gone.', webhooks: [] };
    return value ?? SAVE_UNANSWERED;
  }

  /**
   * Read a typed schedule as a cron, server-side and deterministically, so the
   * ✓ line says the same thing whether the schedule was drafted or typed.
   */
  async parseSchedule(text: string, timeZoneId?: string, signal?: AbortSignal): Promise<ScheduleParse> {
    return (
      (await this.send<ScheduleParse>(
        'POST',
        'api/seam/automations/schedule',
        { text, timeZoneId: timeZoneId ?? null },
        signal,
      )) ?? PARSE_UNANSWERED
    );
  }

  /** Draft a routine from a description. Never throws for a model's failure; see `ok`. */
  async draftRoutine(description: string, timeZoneId?: string, signal?: AbortSignal): Promise<RoutineDraftResult> {
    return (
      (await this.send<RoutineDraftResult>(
        'POST',
        'api/seam/automations/draft',
        { description, timeZoneId: timeZoneId ?? null },
        signal,
      )) ?? DRAFT_UNANSWERED
    );
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

  // ---- settings ----
  //
  // One method per call the web's settings pages make, over the same
  // `/api/seam/*` groups (`Http*Api.cs`). A create answers `{id, error}`; an
  // update or a command answers `{value}` with null for success; a switch
  // answers 204 or 404. Nothing here ever reads a secret back.

  // -- connections --

  async connections(signal?: AbortSignal): Promise<ConnectionSummary[]> {
    return (await this.get<ConnectionSummary[]>('api/seam/connections/', signal)) ?? [];
  }

  /** The key is validated against the provider before it is stored; the error says why not. */
  async createConnection(request: CreateConnectionRequest): Promise<CreateResult> {
    return (
      (await this.send<CreateResult>('POST', 'api/seam/connections/', request)) ?? {
        id: null,
        error: 'The server did not answer.',
      }
    );
  }

  deleteConnection(id: string) {
    return this.landed('DELETE', `api/seam/connections/${id}`);
  }

  /** Resolved server-side with the decrypted key; only names come back. */
  async connectionModels(id: string, signal?: AbortSignal): Promise<ModelOption[]> {
    return (await this.get<ModelOption[]>(`api/seam/connections/${id}/models`, signal)) ?? [];
  }

  async connectionTiers(id: string, signal?: AbortSignal): Promise<Record<string, ModelTier>> {
    return (await this.get<Record<string, ModelTier>>(`api/seam/connections/${id}/tiers`, signal)) ?? {};
  }

  /** Null clears the grade back to the catalog's default. */
  setModelTier(id: string, modelId: string, tier: ModelTier | null) {
    return this.landed('PUT', `api/seam/connections/${id}/tiers`, { modelId, tier });
  }

  setConnectionEnabled(id: string, enabled: boolean) {
    return this.landed('PUT', `api/seam/connections/${id}/enabled`, { value: enabled });
  }

  async disabledModels(id: string, signal?: AbortSignal): Promise<string[]> {
    return (await this.get<string[]>(`api/seam/connections/${id}/disabled-models`, signal)) ?? [];
  }

  setModelEnabled(id: string, modelId: string, enabled: boolean) {
    return this.landed('PUT', `api/seam/connections/${id}/models/enabled`, { modelId, enabled });
  }

  async gitConnections(signal?: AbortSignal): Promise<GitConnectionSummary[]> {
    return (await this.get<GitConnectionSummary[]>('api/seam/git/connections', signal)) ?? [];
  }

  deleteGitConnection(id: string) {
    return this.landed('DELETE', `api/seam/git/connections/${id}`);
  }

  async gitApps(signal?: AbortSignal): Promise<GitAppSummary[]> {
    return (await this.get<GitAppSummary[]>('api/seam/git/apps', signal)) ?? [];
  }

  // -- codex --
  //
  // The device flow runs on the server: it holds the PKCE verifier and the
  // tokens, and creates the connection in the poll that sees the approval.

  async codexStart(): Promise<CodexDeviceStart> {
    return (
      (await this.send<CodexDeviceStart>('POST', 'api/seam/codex/device', {})) ?? {
        deviceAuthId: null,
        userCode: null,
        interval: '00:00:00',
        verificationUrl: '',
        error: 'The server did not answer.',
      }
    );
  }

  async codexPoll(deviceAuthId: string, userCode: string, signal?: AbortSignal): Promise<CodexPollResult> {
    return (
      (await this.send<CodexPollResult>('POST', 'api/seam/codex/device/poll', { deviceAuthId, userCode }, signal)) ?? {
        status: CodexPollStatus.Failed,
        error: 'The server did not answer.',
      }
    );
  }

  /** The one inbound road for tokens: a paste of `~/.codex/auth.json`. */
  codexImport(json: string) {
    return this.textResult('POST', 'api/seam/codex/import', { value: json }, 'The server did not answer.');
  }

  // -- mcp servers --

  async mcpServers(signal?: AbortSignal): Promise<McpServerSummary[]> {
    return (await this.get<McpServerSummary[]>('api/seam/mcp/', signal)) ?? [];
  }

  async createMcpServer(request: McpServerRequest): Promise<CreateResult> {
    return (
      (await this.send<CreateResult>('POST', 'api/seam/mcp/', request)) ?? {
        id: null,
        error: 'The server did not answer.',
      }
    );
  }

  updateMcpServer(id: string, request: McpServerRequest) {
    return this.textResult('PUT', `api/seam/mcp/${id}`, request, 'That server is gone.');
  }

  setMcpServerEnabled(id: string, enabled: boolean) {
    return this.landed('PUT', `api/seam/mcp/${id}/enabled`, { value: enabled });
  }

  deleteMcpServer(id: string) {
    return this.landed('DELETE', `api/seam/mcp/${id}`);
  }

  // -- remote nodes --

  async createNode(request: RemoteNodeRequest): Promise<NodeCreateResult> {
    return (
      (await this.send<NodeCreateResult>('POST', 'api/seam/nodes/', request)) ?? {
        id: null,
        error: 'The server did not answer.',
        authorizedKeysLine: null,
      }
    );
  }

  updateNode(id: string, request: RemoteNodeRequest) {
    return this.textResult('PUT', `api/seam/nodes/${id}`, request, 'That node is gone.');
  }

  async regenerateNodeKey(id: string): Promise<NodeKeyResult> {
    const { status, value } = await this.request<NodeKeyResult>('POST', `api/seam/nodes/${id}/key`, {});
    if (status === 404) return { authorizedKeysLine: null, error: 'That node is gone.' };
    return value ?? { authorizedKeysLine: null, error: 'The server did not answer.' };
  }

  setNodeEnabled(id: string, enabled: boolean) {
    return this.landed('PUT', `api/seam/nodes/${id}/enabled`, { value: enabled });
  }

  deleteNode(id: string) {
    return this.landed('DELETE', `api/seam/nodes/${id}`);
  }

  resetNodeHostKeyPin(id: string) {
    return this.landed('DELETE', `api/seam/nodes/${id}/host-key-pin`);
  }

  async testNode(id: string): Promise<NodeTestResult> {
    const { status, value } = await this.request<NodeTestResult>('POST', `api/seam/nodes/${id}/test`, {});
    if (status === 404) return { ok: false, detail: 'That node is gone.' };
    return value ?? { ok: false, detail: 'The server did not answer.' };
  }

  // -- terminal --

  terminalDefaults(signal?: AbortSignal) {
    return this.get<TerminalDefaults>('api/seam/terminal-settings/defaults', signal);
  }

  async terminalPrefs(signal?: AbortSignal): Promise<TerminalPrefs> {
    return (await this.get<TerminalPrefs>('api/seam/terminal-settings/', signal)) ?? { packages: null, shell: null };
  }

  saveTerminalPrefs(packages: string | null, shell: string | null) {
    return this.send<void>('PUT', 'api/seam/terminal-settings/', { packages, shell });
  }

  // -- facets, hooks, permission rules --

  async userFacets(signal?: AbortSignal): Promise<UserFacetSummary[]> {
    return (await this.get<UserFacetSummary[]>('api/seam/user-config/facets', signal)) ?? [];
  }

  saveFacet(name: string, content: string) {
    return this.send<void>('POST', 'api/seam/user-config/facets', { name, content });
  }

  deleteFacet(id: string) {
    return this.landed('DELETE', `api/seam/user-config/facets/${id}`);
  }

  /** The exact parser the runtime uses, so a facet that checks out here loads there. */
  async checkFacet(name: string, content: string): Promise<FacetCheck> {
    return (
      (await this.send<FacetCheck>('POST', 'api/seam/user-config/facets/check', { name, content })) ?? {
        name: null,
        toolsAllowed: 0,
        toolsDenied: 0,
        model: null,
        error: 'the server did not answer',
      }
    );
  }

  async hooks(signal?: AbortSignal): Promise<string | null> {
    return (await this.get<TextResult>('api/seam/user-config/hooks', signal))?.value ?? null;
  }

  /** An empty document removes the global hooks. */
  saveHooks(json: string | null) {
    return this.send<void>('PUT', 'api/seam/user-config/hooks', { value: json });
  }

  async permissions(signal?: AbortSignal): Promise<string | null> {
    return (await this.get<TextResult>('api/seam/user-config/permissions', signal))?.value ?? null;
  }

  savePermissions(yaml: string | null) {
    return this.send<void>('PUT', 'api/seam/user-config/permissions', { value: yaml });
  }

  async checkPermissions(yaml: string): Promise<PermissionsCheck> {
    return (
      (await this.send<PermissionsCheck>('POST', 'api/seam/user-config/permissions/check', { value: yaml })) ?? {
        ruleCount: 0,
        error: 'The server did not answer.',
      }
    );
  }

  // -- artifacts --

  async artifacts(signal?: AbortSignal): Promise<ArtifactSummary[]> {
    return (await this.get<ArtifactSummary[]>('api/seam/artifacts/', signal)) ?? [];
  }

  /** Null when the artifact is gone, or was never this account's. */
  artifact(id: string, signal?: AbortSignal): Promise<ArtifactDetail | null> {
    return this.get<ArtifactDetail>(`api/seam/artifacts/${id}`, signal);
  }

  /** Mints or revokes the unlisted link; the summary comes back with the new token. */
  shareArtifact(id: string, shared: boolean): Promise<ArtifactSummary | null> {
    return this.send<ArtifactSummary>('POST', `api/seam/artifacts/${id}/share`, { shared });
  }

  deleteArtifact(id: string) {
    return this.landed('DELETE', `api/seam/artifacts/${id}`);
  }

  /**
   * Where an artifact's bytes live. Two URLs, and the difference matters: the
   * owner's needs the bearer key, so it is only useful to `fetch` from inside
   * the app, while the share link opens in any browser and is the one to hand
   * to the system share sheet.
   */
  artifactRawUrl(id: string): string {
    return `${this.baseUrl}/artifacts/${id}/raw`;
  }

  shareUrl(sharePath: string): string {
    return `${this.baseUrl}/${sharePath}`;
  }

  // -- memory --

  async memories(signal?: AbortSignal): Promise<MemorySummary[]> {
    return (await this.get<MemorySummary[]>('api/seam/memory/', signal)) ?? [];
  }

  saveMemory(request: SaveMemoryRequest) {
    return this.send<void>('POST', 'api/seam/memory/', request);
  }

  deleteMemory(id: string) {
    return this.landed('DELETE', `api/seam/memory/${id}`);
  }

  // -- skills --

  async skills(signal?: AbortSignal): Promise<UserSkillSummary[]> {
    return (await this.get<UserSkillSummary[]>('api/seam/skills/', signal)) ?? [];
  }

  /** A save that the parser refuses answers with why; null is saved. */
  saveSkill(name: string, content: string) {
    return this.textResult('POST', 'api/seam/skills/', { name, content }, 'The server did not answer.');
  }

  deleteSkill(id: string) {
    return this.landed('DELETE', `api/seam/skills/${id}`);
  }

  // -- channels --

  createChannel(draft: ChannelDraft) {
    return this.textResult('POST', 'api/seam/channels/', draft, 'The server did not answer.');
  }

  updateChannel(id: string, draft: ChannelDraft) {
    return this.textResult('PUT', `api/seam/channels/${id}`, draft, 'That channel is gone.');
  }

  deleteChannel(id: string) {
    return this.landed('DELETE', `api/seam/channels/${id}`);
  }

  setChannelEnabled(id: string, enabled: boolean) {
    return this.textResult('POST', `api/seam/channels/${id}/enabled/${enabled}`, {}, 'That channel is gone.');
  }

  /** The code the bot (or the mailbox) handed a stranger. In the body: a URL ends up in logs. */
  pairChannel(id: string, code: string) {
    return this.textResult('POST', `api/seam/channels/${id}/pair`, { code }, 'That channel is gone.');
  }

  unpairChannel(id: string, peerId: string) {
    return this.textResult('POST', `api/seam/channels/${id}/unpair`, { peerId }, 'That channel is gone.');
  }

  testChannel(id: string) {
    return this.textResult('POST', `api/seam/channels/${id}/test`, {}, 'That channel is gone.');
  }

  // -- api keys --

  async apiKeys(signal?: AbortSignal): Promise<ApiKeySummary[]> {
    return (await this.get<ApiKeySummary[]>('api/seam/api-keys/', signal)) ?? [];
  }

  /** The full key is in this answer and nowhere else, ever again. */
  mintApiKey(name: string) {
    return this.send<MintedApiKey>('POST', 'api/seam/api-keys/', { name });
  }

  revokeApiKey(id: string) {
    return this.landed('DELETE', `api/seam/api-keys/${id}`);
  }

  /** A 90-second single-use code another device redeems for a key of its own. */
  startPairing() {
    return this.send<DevicePairingCode>('POST', 'api/seam/api-keys/pairing', {});
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
