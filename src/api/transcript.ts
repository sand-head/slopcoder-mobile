/**
 * Folding raw events into display items, ported from
 * `SlopCoder.Web.Client/Pages/TranscriptFolder.cs` and `TranscriptGrouping.cs`.
 *
 * Events are not polymorphic JSON. Each envelope carries `kind` (the bare C#
 * type name) and `payloadJson` — a JSON *string* holding the event, so parsing
 * happens twice. `SubagentEvent` nests a second envelope inside the first.
 *
 * The fold is incremental: it consumes only what is new, because a 75ms push
 * must not refold a thousand-event transcript. Unknown kinds are skipped
 * rather than thrown on — the server adds new ones, and an app in a store is
 * always older than the server it talks to.
 */
import type { AgentEventEnvelope, UserQuestion, UserQuestionAnswer } from './contracts';

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
  | 'subagent-start';

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
  imageCount: number;
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

export interface SubagentStartItem extends BaseItem {
  kind: 'subagent-start';
  subagentId: number;
  task: string;
  model: string;
}

export type Item =
  | UserItem
  | TextItem
  | ThinkItem
  | ToolItem
  | NoteItem
  | PlanItem
  | ApprovalItem
  | QuestionItem
  | ErrorItem
  | DividerItem
  | SubagentStartItem;

/**
 * These two tools render as their own thing — the plan checklist, the question
 * card — so their tool rows are noise. A *failed* call still shows, because
 * then the row is the only evidence.
 */
const FOLDED_TOOLS = new Set(['update_plan', 'ask_user_question']);

export class TranscriptFolder {
  private items: Item[] = [];
  private processed = 0;
  /** Open tool calls, keyed by subagent then name, awaiting their result. */
  private openTools = new Map<string, ToolItem>();

  get all(): readonly Item[] {
    return this.items;
  }

  reset(): void {
    this.items = [];
    this.processed = 0;
    this.openTools.clear();
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

  private consume(envelope: AgentEventEnvelope, sub: number | null): void {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(envelope.payloadJson) as Record<string, unknown>;
    } catch {
      return; // A payload we cannot read is not worth a crash.
    }

    const base = { ordinal: envelope.ordinal, sub, key: `${envelope.ordinal}:${sub ?? 'main'}` };
    const str = (name: string) => (payload[name] as string) ?? '';

    switch (envelope.kind) {
      case 'UserPrompt':
      case 'SteeringPrompt':
        this.items.push({
          ...base,
          kind: 'user',
          text: str('text'),
          steering: envelope.kind === 'SteeringPrompt',
          imageCount: ((payload.images as unknown[]) ?? []).length,
        });
        break;

      case 'AssistantText':
        this.items.push({
          ...base,
          kind: 'text',
          text: str('text'),
          durationMs: (payload.durationMs as number) ?? null,
        });
        break;

      case 'ThinkingText':
        this.items.push({
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
        this.openTools.set(`${sub ?? 'main'}:${name}`, item);
        this.items.push(item);
        break;
      }

      case 'ToolCallFinished': {
        const name = str('toolName');
        const open = this.openTools.get(`${sub ?? 'main'}:${name}`);
        const isError = Boolean(payload.isError);

        if (open) {
          open.result = str('result');
          open.isError = isError;
          open.running = false;
          this.openTools.delete(`${sub ?? 'main'}:${name}`);
          break;
        }

        // A folded tool that failed: show it after all, since nothing else will.
        if (FOLDED_TOOLS.has(name) && isError) {
          this.items.push({
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
        this.items.push({
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
        this.items.push({
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
        this.items.push({
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
        this.items.push({
          ...base,
          kind: 'approval',
          requestId: str('requestId'),
          toolName: str('toolName'),
          input: str('inputJson'),
          reason: str('reason'),
          refused: Boolean(payload.refused),
          approved: null,
        });
        break;

      case 'ApprovalResolved': {
        const requestId = str('requestId');
        const card = this.items.find(
          (item): item is ApprovalItem => item.kind === 'approval' && item.requestId === requestId,
        );
        if (card) card.approved = Boolean(payload.approved);
        break;
      }

      case 'QuestionAsked':
        this.items.push({
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
        const card = this.items.find(
          (item): item is QuestionItem => item.kind === 'question' && item.requestId === requestId,
        );
        if (card) {
          card.answers = (payload.answers as UserQuestionAnswer[]) ?? null;
          card.resolved = true;
        }
        break;
      }

      case 'AgentError':
        this.items.push({
          ...base,
          kind: 'error',
          message: str('message'),
          detail: (payload.detail as string) ?? null,
          fault: (payload.fault as number) ?? 0,
        });
        break;

      case 'ModelSelected':
        this.items.push({
          ...base,
          kind: 'divider',
          label: payload.autoRouted ? `${str('model')} · auto` : str('model'),
        });
        break;

      case 'ContextCompacted':
        this.items.push({ ...base, kind: 'divider', label: 'context compacted' });
        break;

      case 'TurnCompleted':
        this.items.push({ ...base, kind: 'note', text: 'done', tone: 'ok' });
        break;

      case 'TurnCancelled':
        this.items.push({ ...base, kind: 'note', text: 'stopped (by you)', tone: 'warn' });
        break;

      case 'CompletionRetry':
        this.items.push({
          ...base,
          kind: 'note',
          text: `retrying (${payload.attempt}/${payload.maxAttempts}) — ${str('reason')}`,
          tone: 'warn',
        });
        break;

      case 'SandboxStatus':
        this.items.push({ ...base, kind: 'note', text: str('message'), tone: 'muted' });
        break;

      case 'CheckpointRestored':
        this.items.push({
          ...base,
          kind: 'note',
          text: `rewound to checkpoint ${payload.number}`,
          tone: 'muted',
        });
        break;

      case 'SubagentStarted':
        this.items.push({
          ...base,
          kind: 'subagent-start',
          subagentId: (payload.subagentId as number) ?? 0,
          task: str('task'),
          model: str('model'),
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
export function summarize(input: string, limit = 80): string {
  if (input.length === 0) return '';

  let text = input;
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    const first = Object.values(parsed).find(v => typeof v === 'string') as string | undefined;
    text = first ?? input;
  } catch {
    // Not JSON; show it as-is.
  }

  text = text.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
