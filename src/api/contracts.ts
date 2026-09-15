/**
 * The seam's wire types, hand-ported from `src/SlopCoder.Contracts/`.
 *
 * slopcoder exposes no OpenAPI document, so these are written rather than
 * generated. Two things about the encoding are easy to get wrong and expensive
 * to debug:
 *
 * 1. **Enums travel as integers.** The server serializes with
 *    `JsonSerializerDefaults.Web`, which adds no string-enum converter. Every
 *    enum below is numeric, and the numbers are the contract — `ApprovalMode`
 *    in particular reserves 3 for a retired member and must never be renumbered.
 * 2. **Property names are camelCase**, because `JsonSerializerDefaults.Web`
 *    does apply that.
 *
 * `scripts/wire-check.cjs` pins both against a live server.
 */

// ---- enums (integers on the wire) ----

export enum SessionStatus {
  Idle = 0,
  Running = 1,
}

/** The outcome of deleting a session. Mirrors `DeleteResult` on the server. */
export enum DeleteResult {
  Deleted = 0,
  NotFound = 1,
  /** A turn is in flight; stop it first. */
  Running = 2,
}

export enum ApprovalMode {
  /** Ask only for what the classifier escalates. The default. */
  Dangerous = 0,
  /** Never ask. */
  Auto = 1,
  /** Ask on every tool call. */
  Always = 2,
  // 3 = Autonomous, retired but reserved. Do not reuse.
}

export enum ThinkingLevel {
  Off = 0,
  Low = 1,
  Medium = 2,
  High = 3,
  Max = 4,
}

export enum SandboxState {
  Host = 0,
  Running = 1,
  Stopped = 2,
}

export enum ProviderFault {
  None = 0,
  Transient = 1,
  RateLimited = 2,
  PlanLimit = 3,
  OutOfCredit = 4,
  Auth = 5,
  BadRequest = 6,
  Unknown = 7,
  ContextWindow = 8,
}

export enum GitServiceKind {
  GitHub = 0,
  Forgejo = 1,
}

// ---- sessions ----

/** Which machine a session's workspace lives on; absent means the server sandbox. */
export interface ClientWorkspace {
  machineId: string;
  machineName: string;
  directory: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  model: string;
  autoRoute: boolean;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  /** Null for a server-sandboxed session — which is every one this app creates. */
  clientWorkspace?: ClientWorkspace | null;
  /** Null when there is no machine to be connected. False means it is offline. */
  workspaceConnected?: boolean | null;
}

/** `"auto"`, or a specific model on a specific connection. */
export interface ModelSelection {
  auto: boolean;
  connectionId?: string | null;
  modelId?: string | null;
}

export const autoRoute: ModelSelection = { auto: true, connectionId: null, modelId: null };

export interface FacetOption {
  name: string;
  description?: string | null;
}

export interface LiveSnapshot {
  thinking: string;
  text: string;
}

export interface UsageReport {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  model: string;
  contextWindowTokens: number;
  connectionId?: string | null;
  providerKind?: number | null;
  connectionDisplayName?: string | null;
}

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  completions: number;
}

export interface UsageSummary {
  models: ModelUsage[];
  estimatedCost?: number | null;
}

export interface LimitWindow {
  label: string;
  usedPercent?: number | null;
  resetsAt?: string | null;
}

export interface ProviderQuota {
  windows: LimitWindow[];
  fault: ProviderFault;
  faultMessage?: string | null;
  faultClearsAt?: string | null;
  observedAt: string;
  planType?: string | null;
  pollError?: string | null;
}

export interface AttachedNode {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
}

export interface ActiveSubagent {
  id: number;
  task: string;
  model: string;
  startedAt: string;
}

/**
 * The cockpit's chrome. Deliberately small — it is pushed on every change at
 * ~75ms coalescing, and scrollback never rides it.
 */
export interface SessionState {
  id: string;
  title: string;
  status: SessionStatus;
  stopRequested: boolean;
  connectionId?: string | null;
  selectedModel?: string | null;
  autoRoute: boolean;
  thinkingLevel?: ThinkingLevel | null;
  approvalMode: ApprovalMode;
  useClassifier: boolean;
  facetName?: string | null;
  goalText?: string | null;
  repoNames: string[];
  skillNames: string[];
  checkpointCount: number;
  /** Scrollback length; the ordinal the next event will take. */
  nextOrdinal: number;
  /** Null between turns. Nulled out of every Delta push — patches carry it instead. */
  live?: LiveSnapshot | null;
  facetCatalog: FacetOption[];
  /** The only trustworthy source of approval liveness. Never read it off the transcript. */
  pendingApprovalIds: string[];
  pendingQuestionIds: string[];
  lastUsage?: UsageReport | null;
  usage: UsageSummary;
  quota?: ProviderQuota | null;
  sandboxState: SandboxState;
  lastActivityAt: string;
  attachedNodes: AttachedNode[];
  activeSubagents: ActiveSubagent[];
  backgroundJobCount: number;
  effectiveThinkingLevel?: ThinkingLevel | null;
  clientWorkspace?: ClientWorkspace | null;
}

/**
 * Growth since the previous push, not a snapshot — a full snapshot per 75ms
 * tick would be O(n²) bytes over a long turn. See {@link LiveAccumulator}.
 */
export interface LivePatch {
  thinkingFrom: number;
  thinkingAppend: string;
  textFrom: number;
  textAppend: string;
}

/**
 * One transcript event. `payloadJson` is a JSON *string* holding the event —
 * parse it a second time. `kind` is the bare C# type name.
 */
export interface AgentEventEnvelope {
  ordinal: number;
  kind: string;
  payloadJson: string;
}

// ---- requests ----

export interface CreateSessionRequest {
  selection: ModelSelection;
  initialPrompt: string;
  repoUrls?: string[] | null;
  thinkingLevel?: ThinkingLevel | null;
  facet?: string | null;
  nodeIds?: string[] | null;
  /**
   * Omitted, always. Leaving this null is the whole mechanism by which a
   * session runs in the server's Docker sandbox rather than on a laptop — and
   * a phone has no filesystem to offer as one.
   */
  clientWorkspace?: null;
}

export interface CreateSessionResult {
  id?: string | null;
}

export interface ImageAttachment {
  mediaType: string;
  base64: string;
}

export interface StartSessionRequest {
  prompt: string;
  selection: ModelSelection;
  images?: ImageAttachment[] | null;
}

export interface SteerRequest {
  prompt: string;
}

export interface ResolveApprovalRequest {
  requestId: string;
  approved: boolean;
}

export interface UserQuestion {
  text: string;
  options: string[];
  allowFreeText: boolean;
}

export interface UserQuestionAnswer {
  question: string;
  answer: string;
}

export interface ResolveQuestionRequest {
  requestId: string;
  /** Null dismisses the question rather than answering it. */
  answers?: UserQuestionAnswer[] | null;
}

export interface RenameRequest {
  name?: string | null;
}

export interface SetThinkingRequest {
  level?: ThinkingLevel | null;
}

export interface SetApprovalRequest {
  mode: ApprovalMode;
  useClassifier: boolean;
}

export interface SetFacetRequest {
  facetName?: string | null;
}

// ---- usage ----

export enum UsageRange {
  Days7 = 0,
  Days30 = 1,
  Days90 = 2,
  All = 3,
}

export enum UsageAttributionQuality {
  Exact = 0,
  InferredLegacy = 1,
  UnknownLegacy = 2,
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  completions: number;
  estimatedCost?: number | null;
  /** Some model in here has no price, so the cost is a floor, not a total. */
  hasUnpriced: boolean;
}

/**
 * Tokens actually processed afresh — uncached input, cache writes, output.
 *
 * The headline figure, and computed here rather than read off the wire so the
 * app does not depend on whether the server serializes its computed properties.
 * In an agent loop the prompt prefix is re-read on every step, so the full
 * footprint runs to many times this and, shown alone, reads as consumption it
 * is not.
 */
export function newTokens(t: UsageTotals | ModelUsage): number {
  return t.inputTokens + t.cacheWriteTokens + t.outputTokens;
}

export function totalTokens(t: UsageTotals | ModelUsage): number {
  return t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;
}

export interface UsageBucket {
  /** `DateOnly` on the wire: an ISO date with no time. */
  day: string;
  totals: UsageTotals;
}

export interface UsageBreakdown {
  providerKind?: number | null;
  connectionName?: string | null;
  model: string;
  totals: UsageTotals;
  attributionQuality: UsageAttributionQuality;
}

export interface UsageDashboard {
  range: UsageRange;
  totals: UsageTotals;
  daily: UsageBucket[];
  breakdown: UsageBreakdown[];
}

// ---- catalogs the create screen needs ----

export interface ModelCandidate {
  connectionId: string;
  connectionName: string;
  kind: number;
  modelId: string;
  modelDisplayName: string;
  tier: number;
  tierSource: number;
  contextWindowTokens: number;
  defaultThinkingLevel?: ThinkingLevel | null;
  supportedThinkingLevels: ThinkingLevel[];
}

export interface GitRepoRow {
  fullName: string;
  cloneUrl: string;
  kind: GitServiceKind;
  private: boolean;
}

export interface GitRepoListing {
  repos: GitRepoRow[];
  errors: string[];
}

export interface RemoteNodeSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  enabled: boolean;
}

// ---- device auth (outside the seam) ----

export interface DeviceKey {
  fullKey: string;
  userName: string;
}

export interface PasswordLoginRequest {
  userName: string;
  password: string;
  deviceName: string;
}

export interface PairRequest {
  code: string;
  deviceName: string;
}

/** What the server says went wrong, in a form worth branching on. */
export type LoginFailure = 'invalid' | 'inactive' | 'twofactor' | 'too-many-attempts';

export interface ServerProtocol {
  executor: number;
  version: string;
  client?: unknown;
}

// ---- routines ----
//
// Ported from `IAutomationsApi.cs`. The entities are called automations and the
// screens are called Routines; the seam keeps the old word in its paths and the
// new one in these read-shaped records, and so does this file.
//
// Two families over the same rows. `AutomationSummary` is the editable shape —
// every column, exactly as stored — and the rest are what the screens paint:
// already folded, already worded, so a phone is not left deriving "3rd failure
// in a row" or "Every weekday at 07:00" from a run log it would have to page
// through.

export enum AutomationKind {
  /** A routine somebody wrote: its prompt is whatever they typed. */
  Job = 0,
  /** The one system-owned check-in per user. Its prompt is fixed. */
  Heartbeat = 1,
}

export enum DeliveryKind {
  None = 0,
  Push = 1,
  Channel = 2,
}

export enum AutomationRunStatus {
  Running = 0,
  Completed = 1,
  Failed = 2,
  /** Not attempted: the session was busy, or the window had closed. */
  Skipped = 3,
  /** Completed with nothing to say — the agent answered `NO_REPLY`. */
  Quiet = 4,
}

export enum AutomationRunTrigger {
  Schedule = 0,
  Manual = 1,
  ChannelCommand = 2,
  Email = 3,
  Webhook = 4,
  Heartbeat = 5,
}

export enum AutomationTriggerKind {
  ChannelCommand = 0,
  Email = 1,
  Webhook = 2,
  Heartbeat = 3,
}

export enum ChannelKind {
  Telegram = 0,
  Ntfy = 1,
  Discord = 2,
  Fluxer = 3,
  Email = 4,
}

/**
 * Three outcomes rather than five statuses, because a bar and a dot can only
 * carry three: did it say something, was it quiet, did it break. A run still
 * going has no outcome at all.
 */
export enum RunOutcome {
  Notified = 0,
  Quiet = 1,
  Failed = 2,
}

export interface AutomationTrigger {
  kind: AutomationTriggerKind;
  channelId?: string | null;
  match?: string | null;
  /** Always blank on a read: the server stores the hash, never the secret. */
  secret?: string | null;
  id: string;
  enabled: boolean;
}

export interface AutomationSummary {
  id: string;
  name: string;
  kind: AutomationKind;
  prompt: string;
  cronExpression: string;
  timeZoneId: string;
  enabled: boolean;
  scheduleEnabled: boolean;
  facet: string | null;
  model: string | null;
  repoUrls: string[];
  nodeIds: string[];
  continuity: boolean;
  notepad: string;
  /** "07:00:00" — a `TimeOnly`, not a timestamp. */
  activeHoursStart: string | null;
  activeHoursEnd: string | null;
  deliveryKind: DeliveryKind;
  deliveryTargetId: string | null;
  triggers: AutomationTrigger[];
  sessionId: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One run, as every Routines surface shows it. */
export interface RunSummary {
  id: string;
  routineId: string;
  routineName: string;
  startedAt: string;
  finishedAt: string | null;
  status: AutomationRunStatus;
  /** Null while it is still running — that is the pulsing dot, not a colour. */
  outcome: RunOutcome | null;
  durationMs: number | null;
  /** The first line of the answer, bounded, or the error when it failed. */
  said: string | null;
  error: string | null;
  delivered: boolean;
  trigger: AutomationRunTrigger;
  triggerId: string | null;
  triggerSource: string | null;
  retryOfRunId: string | null;
}

export interface NextFire {
  routineId: string;
  name: string;
  at: string;
}

export interface RoutineCard {
  id: string;
  name: string;
  kind: AutomationKind;
  enabled: boolean;
  scheduleEnabled: boolean;
  /** The schedule in words, or what starts it when there is no clock. */
  scheduleSentence: string;
  /** The mono second line: "0 7 * * 1-5 · Europe/Berlin". */
  scheduleMeta: string;
  /** Exactly 14, oldest first, left-padded with nulls. Null is "no run". */
  history: (RunOutcome | null)[];
  lastRun: RunSummary | null;
  nextFire: string | null;
  lastFailed: boolean;
  running: boolean;
  triggerCount: number;
}

export interface RoutineFailure {
  routineId: string;
  name: string;
  runId: string;
  at: string;
  error: string | null;
  durationMs: number | null;
  /** Consecutive failures back from the latest finished run. At least 1. */
  streak: number;
}

export interface HeartbeatStatus {
  id: string;
  enabled: boolean;
  intervalSentence: string;
  activeStart: string | null;
  activeEnd: string | null;
  nextFire: string | null;
  notepadItems: string[];
  quietToday: number;
  notifiedToday: number;
  running: boolean;
}

/** Everything the board paints, in one call. */
export interface RoutineBoard {
  routines: RoutineCard[];
  failures: RoutineFailure[];
  /** Null until the user has one; the board never creates it by itself. */
  heartbeat: HeartbeatStatus | null;
  runsToday: number;
  notifiedToday: number;
  quietToday: number;
  failedToday: number;
  upcoming: NextFire[];
  /** The phone's ledger: the last runs across every routine, newest first. */
  recentRuns?: RunSummary[] | null;
}

/** The cheap read behind the sessions screen's strip. */
export interface RoutineStatus {
  anyRoutines: boolean;
  anyFailed: boolean;
  newestFailure: RoutineFailure | null;
  latestNotified: RunSummary | null;
  upcoming: NextFire[];
}

export interface TriggerStats {
  /** The trigger's own id — or the routine's, for the synthesized schedule. */
  triggerId: string;
  /** Null for that synthesized schedule. */
  kind: AutomationTriggerKind | null;
  enabled: boolean;
  summary: string;
  note: string;
  lastFired: string | null;
  lastFiredBy: string | null;
  fires30d: number;
  history: (RunOutcome | null)[];
  channel?: ChannelKind | null;
}

export interface RoutineDetail {
  routine: AutomationSummary;
  scheduleSentence: string;
  scheduleMeta: string;
  nextFire: string | null;
  /** Where an unprompted run's answer goes: "your browser", "nobody (log only)". */
  notifiesLabel: string;
  /** Thirty entries, oldest first, left-padded with nulls. */
  history: (RunOutcome | null)[];
  runs30d: number;
  notified30d: number;
  failed30d: number;
  medianDurationMs: number | null;
  triggers: TriggerStats[];
  lastRun: RunSummary | null;
  running: boolean;
}

export interface RunPage {
  runs: RunSummary[];
  total: number;
}

/** One tool call in a run's replayed transcript. */
export interface RunStep {
  /** The tool's name. */
  symbol: string;
  /** Its most telling argument — a path, a command, a query. */
  name: string;
  meta: string | null;
  ok: boolean;
}

export interface RunDetail {
  run: RunSummary;
  sessionId: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  steps: RunStep[];
  finalMessage: string | null;
  endedAt: string | null;
}

// ---- authoring a routine ----
//
// The editable half, ported from the same file. `AutomationDraft` is what a
// create or an update sends; the server answers with the problem to show or
// the webhook secrets that write minted, which is the one moment they are
// readable.

/** A `Guid.Empty`: what a trigger the user just added carries until the server assigns one. */
export const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

/**
 * The editable half of a routine. `cronExpression` may be blank when
 * `triggers` holds at least one; the heartbeat's `prompt` is ignored.
 * `activeHoursStart`/`End` are `TimeOnly`s: "07:00:00", never a timestamp.
 */
export interface AutomationDraft {
  name: string;
  prompt: string;
  cronExpression: string;
  timeZoneId: string;
  enabled: boolean;
  facet: string | null;
  model: string | null;
  repoUrls: string[];
  continuity: boolean;
  activeHoursStart: string | null;
  activeHoursEnd: string | null;
  deliveryKind: DeliveryKind;
  deliveryTargetId: string | null;
  triggers: AutomationTrigger[];
  scheduleEnabled: boolean;
  nodeIds: string[];
}

/** A webhook secret, handed back exactly once by the write that minted it. */
export interface AutomationWebhookSecret {
  automationId: string;
  triggerId: string;
  secret: string;
}

/** The outcome of a create or an update: a problem, or the secrets it minted. */
export interface AutomationSaveResult {
  error: string | null;
  webhooks: AutomationWebhookSecret[];
}

/** What the server made of a schedule somebody typed. */
export interface ScheduleParse {
  ok: boolean;
  cron: string | null;
  zone: string | null;
  /** The cron read back in words, for the ✓ line. */
  sentence: string | null;
  /** When it would next fire, ignoring active hours. */
  firstRun: string | null;
  error: string | null;
}

export interface ScheduleParseRequest {
  text: string;
  timeZoneId: string | null;
}

export interface RoutineDraftRequest {
  description: string;
  timeZoneId: string | null;
}

/** One trigger a draft proposes; a null `kind` is the schedule, and `when` its English. */
export interface RoutineDraftTrigger {
  kind: AutomationTriggerKind | null;
  when: string | null;
  channelId: string | null;
  match: string | null;
}

/**
 * A routine drafted from a description. Best-effort by construction: `ok` is
 * false and the form simply stays as it was when no model could draft it.
 */
export interface RoutineDraftResult {
  ok: boolean;
  error: string | null;
  name: string | null;
  prompt: string | null;
  model: string | null;
  triggers: RoutineDraftTrigger[];
  deliveryKind: DeliveryKind;
  deliveryTargetId: string | null;
  /** The "the agent read this as" lines, already worded. */
  reading: string[];
  elapsedMs: number;
  draftedBy: string | null;
}

// ---- channels ----
//
// Ported from `IChannelsApi.cs`. The editor needs them twice: a chat command
// or an email trigger listens on one, and a run's answer can be delivered to
// one. Never carries the bot token — only whether one is set.

export interface PendingPairing {
  peerId: string;
  code: string;
  issuedAt: string;
}

export interface ChannelSummary {
  id: string;
  kind: ChannelKind;
  displayName: string;
  enabled: boolean;
  hasSecret: boolean;
  settings: string;
  pairedPeers: string[];
  pendingPairings: PendingPairing[];
  mainSessionId: string | null;
  lastError: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}
