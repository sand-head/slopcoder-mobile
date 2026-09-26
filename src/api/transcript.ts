/**
 * Folding raw events into display items, ported from
 * `SlopCoder.Web.Client/Pages/TranscriptFolder.cs` and `TranscriptGrouping.cs`.
 *
 * Events are not polymorphic JSON. Each envelope carries `kind` (the bare C#
 * type name) and `payloadJson` — a JSON *string* holding the event, so parsing
 * happens twice. `SubagentEvent` (legacy) nests a second envelope inside the first.
 *
 * The fold is incremental: it consumes only what is new, because a 75ms push
 * must not refold a thousand-event transcript. Unknown kinds are skipped
 * rather than thrown on — the server adds new ones, and an app in a store is
 * always older than the server it talks to.
 */
import type {
  AgentEventEnvelope,
  ImageAttachment,
  UserQuestion,
  UserQuestionAnswer,
} from './contracts';

export type ItemKind =
  | 'user'
  | 'text'
  | 'think'
  | 'tool'
  | 'note'
  | 'plan'
  | 'approval'
  | 'question'
  | 'error'
  | 'divider'
  | 'subagent-start'
  | 'subsession'
  | 'subsession-reply';

export interface PlanStep {
  text: string;
  status: 'pending' | 'in_progress' | 'done';
  dependsOn?: number[] | null;
}

export interface BaseItem {
  kind: ItemKind;
  key: string;
  ordinal: number;
  /** The subagent this belongs to, or null for the main thread. */
  sub: number | null;
}

export interface UserItem extends BaseItem {
  kind: 'user';
  text: string;
  steering: boolean;
  /** What rode with the prompt, inline as the seam persisted it. */
  images: ImageAttachment[];
}

export interface TextItem extends BaseItem {
  kind: 'text';
  text: string;
  durationMs?: number | null;
}

export interface ThinkItem extends BaseItem {
  kind: 'think';
  text: string;
  durationMs?: number | null;
}

export interface ToolItem extends BaseItem {
  kind: 'tool';
  name: string;
  input: string;
  result: string | null;
  isError: boolean;
  running: boolean;
}

export interface NoteItem extends BaseItem {
  kind: 'note';
  text: string;
  /** The renderer draws a mark from this; the fold no longer picks a character. */
  tone: 'muted' | 'ok' | 'warn';
  /** Which turn boundary this is, if it is one — what a subagent's status reduces over. */
  turn?: 'completed' | 'cancelled';
}

export interface PlanItem extends BaseItem {
  kind: 'plan';
  steps: PlanStep[];
}

export interface ApprovalItem extends BaseItem {
  kind: 'approval';
  requestId: string;
  toolName: string;
  input: string;
  reason: string;
  /** The classifier refused; a human saying yes is an override. */
  refused: boolean;
  approved: boolean | null;
  /**
   * For a tool that always asks (posting to a forge), exactly what approving
   * it would post — rendered text, as text, in full. The evidence the verdict
   * rests on, not decoration.
   */
  preview: string | null;
}

export interface QuestionItem extends BaseItem {
  kind: 'question';
  requestId: string;
  questions: UserQuestion[];
  answers: UserQuestionAnswer[] | null;
  resolved: boolean;
}

export interface ErrorItem extends BaseItem {
  kind: 'error';
  message: string;
  detail?: string | null;
  fault: number;
}

export interface DividerItem extends BaseItem {
  kind: 'divider';
  label: string;
}

/** Legacy: a nested subagent's header (transcripts persisted before sub-sessions). */
export interface SubagentStartItem extends BaseItem {
  kind: 'subagent-start';
  subagentId: number;
  task: string;
  model: string;
}

/**
 * A sub-session the agent opened: a whole session of its own, driven by this
 * agent. Only the anchor lives here — the card reads the sub-session's own
 * transcript.
 */
export interface SubSessionItem extends BaseItem {
  kind: 'subsession';
  subSessionId: string;
  /** The beat it was brought on for ("push relay"). */
  name: string;
  model: string;
  profile: string;
  routeReason: string | null;
  /** The name it goes by ("Ada"); empty on sub-sessions from before personas. */
  persona: string;
  /** Its accent (`tintFor`); empty renders untinted. */
  color: string;
}

/**
 * A sub-session's reply arriving. Sub-sessions run on their own clock, so a
 * reply does not return to anyone: it reaches the driving agent on its own —
 * interrupting the turn the agent was having, or starting one if it was idle.
 * It is its own item rather than a `user` one because nobody typed it, and the
 * transcript must never suggest otherwise.
 */
export interface SubSessionReplyItem extends BaseItem {
  kind: 'subsession-reply';
  subSessionId: string;
  persona: string;
  /** The beat they are on, for the line under their name. */
  name: string;
  text: string;
  isError: boolean;
  color: string;
  /**
   * It landed inside a turn the agent was already having, rather than starting
   * one. Worth saying: the same card in the middle of a turn means something
   * different from one at the top of it. False on rows from before the server
   * could interrupt.
   */
  interjected: boolean;
}

export type Item =
  | UserItem
  | SubSessionReplyItem
  | TextItem
  | ThinkItem
  | ToolItem
  | NoteItem
  | PlanItem
  | ApprovalItem
  | QuestionItem
  | ErrorItem
  | DividerItem
  | SubagentStartItem
  | SubSessionItem;

/**
 * These two tools render as their own thing — the plan checklist, the question
 * card — so their tool rows are noise. A *failed* call still shows, because
 * then the row is the only evidence.
 */
const FOLDED_TOOLS = new Set(['update_plan', 'ask_user_question']);

/**
 * What a promotion did, as one phrase — the twin of the server's
 * `SubSessionMessage.Promotion`. Each field carries only what actually moved,
 * so a partner whose profile nobody touched must not read as promoted; an
 * older server sends a profile and nothing else, which still reads right.
 */
function promotion(
  profile: string,
  model: string,
  effort: string,
): string {
  const parts: string[] = [];
  if (profile) parts.push(`promoted to ${profile}`);
  if (model) parts.push(`moved to ${model}`);
  if (effort) parts.push(`set to ${effort.toLowerCase()} effort`);
  if (parts.length === 0) return 'changed';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export class TranscriptFolder {
  private items: Item[] = [];
  private processed = 0;
  /**
   * Open tool calls, keyed by subagent then name, awaiting their result. The
   * value is the slot in {@link items}, not the item — the item is replaced
   * when the result lands, so holding it would be holding the stale one.
   */
  private openTools = new Map<string, number>();
  private version = 0;

  get all(): readonly Item[] {
    return this.items;
  }

  /**
   * Bumped whenever an item is added or replaced, and never otherwise.
   *
   * Every push from the hub re-folds, and almost none of them change anything
   * here — a turn's text streams through the accumulator and only lands as an
   * event when it is finished. Without a way to tell the difference, the screen
   * published a fresh array per push, which re-grouped the whole transcript and
   * re-rendered every mounted row. This is that way.
   */
  get revision(): number {
    return this.version;
  }

  reset(): void {
    this.items = [];
    this.processed = 0;
    this.openTools.clear();
    this.version++;
  }

  /**
   * Fold everything not yet seen. Pass the whole window each time; the cursor
   * makes repeat calls cheap.
   */
  fold(events: readonly AgentEventEnvelope[]): readonly Item[] {
    for (let i = this.processed; i < events.length; i++) {
      this.consume(events[i], null);
    }
    this.processed = events.length;
    return this.items;
  }

  /** A prepended page shifts everything; the caller must refold from scratch. */
  refold(events: readonly AgentEventEnvelope[]): readonly Item[] {
    this.reset();
    return this.fold(events);
  }

  /** Append, and say so. Returns the slot, for the things that come back to it. */
  private add(item: Item): number {
    this.version++;
    return this.items.push(item) - 1;
  }

  /**
   * Replace a slot rather than write through the item in it.
   *
   * A tool row that filled in its own `result`, an approval card that set its
   * own `approved`, kept the identity React had already rendered, so a memoized
   * row had no way to know it had changed and the result never appeared. The
   * rule this buys is worth more than the allocation: an item's identity
   * changes exactly when the item does.
   */
  private replace(index: number, item: Item): void {
    this.version++;
    this.items[index] = item;
  }

  private consume(envelope: AgentEventEnvelope, sub: number | null): void {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(envelope.payloadJson) as Record<string, unknown>;
    } catch {
      return; // A payload we cannot read is not worth a crash.
    }

    const base = {
      ordinal: envelope.ordinal,
      sub,
      key: `${envelope.ordinal}:${sub ?? 'main'}`,
    };
    const str = (name: string) => (payload[name] as string) ?? '';

    switch (envelope.kind) {
      case 'UserPrompt':
      case 'SteeringPrompt':
        this.add({
          ...base,
          kind: 'user',
          text: str('text'),
          steering: envelope.kind === 'SteeringPrompt',
          images: readImages(payload.images),
        });
        break;

      case 'AssistantText':
        this.add({
          ...base,
          kind: 'text',
          text: str('text'),
          durationMs: (payload.durationMs as number) ?? null,
        });
        break;

      case 'ThinkingText':
        this.add({
          ...base,
          kind: 'think',
          text: str('text'),
          durationMs: (payload.durationMs as number) ?? null,
        });
        break;

      case 'ToolCallStarted': {
        const name = str('toolName');
        if (FOLDED_TOOLS.has(name)) break;

        const item: ToolItem = {
          ...base,
          kind: 'tool',
          name,
          input: str('inputJson'),
          result: null,
          isError: false,
          running: true,
        };
        this.openTools.set(`${sub ?? 'main'}:${name}`, this.add(item));
        break;
      }

      case 'ToolCallFinished': {
        const name = str('toolName');
        const open = this.openTools.get(`${sub ?? 'main'}:${name}`);
        const isError = Boolean(payload.isError);

        if (open !== undefined) {
          const started = this.items[open] as ToolItem;
          this.replace(open, {
            ...started,
            result: str('result'),
            isError,
            running: false,
          });
          this.openTools.delete(`${sub ?? 'main'}:${name}`);
          break;
        }

        // A folded tool that failed: show it after all, since nothing else will.
        if (FOLDED_TOOLS.has(name) && isError) {
          this.add({
            ...base,
            kind: 'tool',
            name,
            input: '',
            result: str('result'),
            isError: true,
            running: false,
          });
        }
        break;
      }

      // Both reuse the tool row — a command is a tool call with a shell on the
      // other end, and setup output is one with the sandbox on it.
      case 'CommandExecuted':
        this.add({
          ...base,
          kind: 'tool',
          name: 'command',
          input: str('command'),
          result: str('output'),
          isError: Boolean(payload.isError),
          running: false,
        });
        break;

      case 'SetupOutput':
        this.add({
          ...base,
          kind: 'tool',
          name: str('label') || 'setup',
          input: '',
          result: str('output'),
          isError: Boolean(payload.isError),
          running: false,
        });
        break;

      case 'PlanUpdated':
        this.add({
          ...base,
          kind: 'plan',
          steps: ((payload.steps as PlanStep[]) ?? []).map(step => ({
            text: step.text,
            status: step.status,
            dependsOn: step.dependsOn ?? null,
          })),
        });
        break;

      case 'ApprovalRequested':
        this.add({
          ...base,
          kind: 'approval',
          requestId: str('requestId'),
          toolName: str('toolName'),
          input: str('inputJson'),
          reason: str('reason'),
          refused: Boolean(payload.refused),
          approved: null,
          preview: str('preview') || null,
        });
        break;

      case 'ApprovalResolved': {
        const requestId = str('requestId');
        const at = this.items.findIndex(
          (item): item is ApprovalItem =>
            item.kind === 'approval' && item.requestId === requestId,
        );
        if (at >= 0) {
          const card = this.items[at] as ApprovalItem;
          this.replace(at, { ...card, approved: Boolean(payload.approved) });
        }
        break;
      }

      case 'QuestionAsked':
        this.add({
          ...base,
          kind: 'question',
          requestId: str('requestId'),
          questions: (payload.questions as UserQuestion[]) ?? [],
          answers: null,
          resolved: false,
        });
        break;

      case 'QuestionAnswered': {
        const requestId = str('requestId');
        const at = this.items.findIndex(
          (item): item is QuestionItem =>
            item.kind === 'question' && item.requestId === requestId,
        );
        if (at >= 0) {
          const card = this.items[at] as QuestionItem;
          this.replace(at, {
            ...card,
            answers: (payload.answers as UserQuestionAnswer[]) ?? null,
            resolved: true,
          });
        }
        break;
      }

      case 'AgentError':
        this.add({
          ...base,
          kind: 'error',
          message: str('message'),
          detail: (payload.detail as string) ?? null,
          fault: (payload.fault as number) ?? 0,
        });
        break;

      case 'ModelSelected':
        this.add({
          ...base,
          kind: 'divider',
          label: payload.autoRouted ? `${str('model')} · auto` : str('model'),
        });
        break;

      case 'ContextCompacted':
        this.add({ ...base, kind: 'divider', label: 'context compacted' });
        break;

      case 'TurnCompleted':
        this.add({
          ...base,
          kind: 'note',
          text: 'done',
          tone: 'ok',
          turn: 'completed',
        });
        break;

      case 'TurnCancelled':
        this.add({
          ...base,
          kind: 'note',
          text: 'stopped (by you)',
          tone: 'warn',
          turn: 'cancelled',
        });
        break;

      case 'CompletionRetry':
        this.add({
          ...base,
          kind: 'note',
          text: `retrying (${payload.attempt}/${payload.maxAttempts}) — ${str(
            'reason',
          )}`,
          tone: 'warn',
        });
        break;

      case 'SandboxStatus':
        this.add({
          ...base,
          kind: 'note',
          text: str('message'),
          tone: 'muted',
        });
        break;

      case 'CheckpointRestored':
        this.add({
          ...base,
          kind: 'note',
          text: `rewound to checkpoint ${payload.number}`,
          tone: 'muted',
        });
        break;

      case 'SubagentStarted':
        this.add({
          ...base,
          kind: 'subagent-start',
          subagentId: (payload.subagentId as number) ?? 0,
          task: str('task'),
          model: str('model'),
        });
        break;

      case 'SubSessionOpened':
        this.add({
          ...base,
          kind: 'subsession',
          subSessionId: str('subSessionId'),
          name: str('name'),
          model: str('model'),
          profile: str('profile') || 'general',
          routeReason: (payload.routeReason as string | null) ?? null,
          persona: str('persona'),
          color: str('color'),
        });
        break;

      case 'SubSessionReplied':
        this.add({
          ...base,
          kind: 'subsession-reply',
          subSessionId: str('subSessionId'),
          persona: str('persona'),
          name: str('name'),
          text: str('text'),
          isError: payload.isError === true,
          color: str('color'),
          interjected: payload.interjected === true,
        });
        break;

      // The card reads its closed state off the sub-session itself; the close
      // tool's own row already marks the moment in the stream. A revival has no
      // tool row of its own — prompting renders as a prompt — so that one gets
      // a note, and so does a profile change.
      case 'SubSessionClosed':
        break;

      case 'SubSessionReopened':
        this.add({
          ...base,
          kind: 'note',
          text: 'sub-session picked back up',
          tone: 'muted',
        });
        break;

      case 'SubSessionPromoted':
        this.add({
          ...base,
          kind: 'note',
          text: `sub-session ${promotion(
            str('profile'),
            str('model'),
            str('effort'),
          )}`,
          tone: 'muted',
        });
        break;

      case 'SubagentEvent': {
        // A second envelope inside the first: same shape, one level down.
        const inner: AgentEventEnvelope = {
          ordinal: envelope.ordinal,
          kind: (payload.innerKind as string) ?? '',
          payloadJson: (payload.innerPayloadJson as string) ?? '{}',
        };
        this.consume(inner, (payload.subagentId as number) ?? 0);
        break;
      }

      // UsageReport drives the context gauge, not the stream. Checkpoints
      // attach a rewind affordance to the prompt above rather than standing
      // alone. Neither produces an item, and neither is an error.
      case 'UsageReport':
      case 'CheckpointCreated':
        break;

      default:
        break;
    }
  }
}

/** A one-line summary of a tool's input, for the collapsed row. */
/**
 * A prompt's images as the seam persisted them: `mediaType` and `base64Data`,
 * or nothing for a text-only prompt and for every prompt from before
 * attachments existed. A malformed entry is dropped rather than rendered as
 * a broken picture.
 */
function readImages(raw: unknown): ImageAttachment[] {
  if (!Array.isArray(raw)) return [];
  const images: ImageAttachment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { mediaType, base64Data } = entry as Record<string, unknown>;
    if (
      typeof mediaType !== 'string' ||
      typeof base64Data !== 'string' ||
      !base64Data
    )
      continue;
    images.push({ mediaType, base64Data });
  }
  return images;
}

export function summarize(input: string, limit = 80): string {
  if (input.length === 0) return '';

  let text = input;
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    const first = Object.values(parsed).find(v => typeof v === 'string') as
      | string
      | undefined;
    text = first ?? input;
  } catch {
    // Not JSON; show it as-is.
  }

  text = text.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * One subagent's whole thread, collapsed into a single row anchored where the
 * subagent first appeared — the port of `TranscriptGrouping.Group`.
 *
 * Without this every event a subagent emits lands in the main stream as it
 * happens, so a fan-out of three reads as one interleaved flood with no way to
 * tell whose tool call is whose. Here the main thread keeps its order and each
 * subagent's items are gathered under its own header, however they interleave.
 */
export interface SubagentGroup {
  kind: 'subagent';
  key: string;
  subagentId: number;
  task: string;
  model: string;
  items: Item[];
}

export type Row = Item | SubagentGroup;

/** What a subagent's thread has come to, in the order the web decides it. */
export type SubagentState = 'running' | 'done' | 'cancelled' | 'failed';

export function groupSubagents(items: readonly Item[]): Row[] {
  const rows: Row[] = [];
  const groups = new Map<number, SubagentGroup>();

  const groupFor = (id: number, start?: SubagentStartItem): SubagentGroup => {
    let group = groups.get(id);
    if (!group) {
      group = {
        kind: 'subagent',
        key: `sub:${id}`,
        subagentId: id,
        task: '',
        model: '',
        items: [],
      };
      groups.set(id, group);
      rows.push(group); // anchored at first sight
    }
    if (start) {
      group.task = start.task;
      group.model = start.model;
    }
    return group;
  };

  for (const item of items) {
    if (item.kind === 'subagent-start') {
      // The header is the start event itself; a subagent that has said nothing
      // yet still gets its row, so the fan-out is visible as it begins.
      groupFor(item.subagentId, item);
    } else if (item.sub === null) {
      rows.push(item);
    } else {
      // A thread whose start scrolled out of the loaded window still groups;
      // it just has no task to show until the earlier page arrives.
      groupFor(item.sub).items.push(item);
    }
  }

  return rows;
}

/**
 * A failure dominates, then a stop, then a clean finish; otherwise the thread
 * is still going — the precedence `TranscriptGrouping.DeriveState` uses.
 */
export function subagentState(items: readonly Item[]): SubagentState {
  let done = false;
  let cancelled = false;
  for (const item of items) {
    if (item.kind === 'error') return 'failed';
    if (item.kind === 'note' && item.turn === 'cancelled') cancelled = true;
    if (item.kind === 'note' && item.turn === 'completed') done = true;
  }
  return cancelled ? 'cancelled' : done ? 'done' : 'running';
}

/** What a still-running subagent is doing: its latest tool, else a hint. */
export function subagentDetail(items: readonly Item[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === 'tool') return item.running ? `${item.name}…` : item.name;
  }
  return items.some(item => item.kind === 'think') ? 'thinking…' : 'working…';
}
