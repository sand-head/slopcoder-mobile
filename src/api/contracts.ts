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
