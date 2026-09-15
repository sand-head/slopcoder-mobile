/**
 * What the routine editor decides, kept out of the screen.
 *
 * A port of `Pages/Routines/TriggerEdit.cs` and the parts of `Editor.razor`
 * that assemble the server's draft. The rules here are the ones the web form
 * and the server already agree on — which kinds need a channel, what a
 * command word may look like, that a routine has one clock and it is a
 * column rather than a trigger row — and a second, phone-shaped copy of any
 * of them would be a copy that drifts. So this is one module, pure and
 * table-testable, and the screen only lays it out.
 *
 * The one thing the server owns outright is the schedule: "every weekday at
 * 7am" becomes a cron only through `POST /automations/schedule`, so a card's
 * `parse` is whatever that call last said and nothing here guesses at it.
 */
import {
  AutomationTriggerKind,
  ChannelKind,
  DeliveryKind,
  EMPTY_GUID,
  type AutomationDraft,
  type AutomationSummary,
  type AutomationTrigger,
  type ChannelSummary,
  type RoutineDraftTrigger,
  type ScheduleParse,
} from './contracts';

// ---- trigger cards ----

/**
 * One line of the kind picker. Not `AutomationTriggerKind`, because the picker
 * is not that enum: the schedule is a column on the routine rather than a
 * trigger row, and one chat-command kind is three lines in the menu — a
 * Discord command and a Telegram command differ only in which connection they
 * may name, which is exactly what somebody choosing a trigger is choosing
 * between.
 */
export type TriggerSlot =
  | 'none'
  | 'schedule'
  | 'fluxer'
  | 'discord'
  | 'telegram'
  | 'email'
  | 'webhook'
  | 'heartbeat';

/** The picker's lines, in the order the cockpit lists them. */
export const SLOTS: TriggerSlot[] = [
  'schedule',
  'fluxer',
  'discord',
  'telegram',
  'email',
  'webhook',
  'heartbeat',
];

/** The server's two words for how a heartbeat trigger rides the beat. */
export const HEARTBEAT_ALWAYS = 'always';
export const HEARTBEAT_NEEDED = 'needed';

/** One trigger while it is being edited. */
export interface TriggerCard {
  /**
   * A stable key for the list. `id` cannot be it: a card the user just added
   * has no id until the server assigns one, and two of them would collide.
   */
  key: string;
  /** The stored trigger's id, or the empty Guid for a card the user just added. */
  id: string;
  slot: TriggerSlot;
  enabled: boolean;
  /** The connection this listens on, for the chat-command and email kinds. */
  channelId: string | null;
  /**
   * The command word, the plus-tag, the webhook's optional JSON filter, or the
   * heartbeat's `always`/`needed` — whatever this kind matches on.
   */
  match: string;
  /** What the user typed into a schedule card: English, or raw cron. */
  when: string;
  /** Whether the schedule field is a raw cron box rather than English. */
  rawCron: boolean;
  /** What the server made of `when`, once it has answered. */
  parse: ScheduleParse | null;
  /** A parse is in flight: the ✓ line waits rather than flashing an error. */
  parsing: boolean;
}

let nextKey = 1;

/** A fresh card with nothing picked. */
export function newCard(slot: TriggerSlot = 'none'): TriggerCard {
  return {
    key: `card-${nextKey++}`,
    id: EMPTY_GUID,
    slot,
    enabled: true,
    channelId: null,
    match: slot === 'heartbeat' ? HEARTBEAT_ALWAYS : '',
    when: '',
    rawCron: false,
    parse: null,
    parsing: false,
  };
}

/** The contract kind a slot writes; null is the synthesized schedule. */
export function kindOf(slot: TriggerSlot): AutomationTriggerKind | null {
  switch (slot) {
    case 'fluxer':
    case 'discord':
    case 'telegram':
      return AutomationTriggerKind.ChannelCommand;
    case 'email':
      return AutomationTriggerKind.Email;
    case 'webhook':
      return AutomationTriggerKind.Webhook;
    case 'heartbeat':
      return AutomationTriggerKind.Heartbeat;
    default:
      return null;
  }
}

/** The connections a slot's channel picker may offer; null is "none". */
export function channelKindOf(slot: TriggerSlot): ChannelKind | null {
  switch (slot) {
    case 'fluxer':
      return ChannelKind.Fluxer;
    case 'discord':
      return ChannelKind.Discord;
    case 'telegram':
      return ChannelKind.Telegram;
    case 'email':
      return ChannelKind.Email;
    default:
      return null;
  }
}

/** What the picker calls a slot. */
export function slotName(slot: TriggerSlot): string {
  switch (slot) {
    case 'schedule':
      return 'Schedule';
    case 'fluxer':
      return 'Fluxer command';
    case 'discord':
      return 'Discord command';
    case 'telegram':
      return 'Telegram command';
    case 'email':
      return 'Email';
    case 'webhook':
      return 'Webhook';
    case 'heartbeat':
      return 'Heartbeat';
    default:
      return 'Choose a trigger kind';
  }
}

/** The line under the name: what this kind fires on. */
export function slotDescription(slot: TriggerSlot): string {
  switch (slot) {
    case 'schedule':
      return 'fires on its own';
    case 'fluxer':
      return 'fires when someone types it in Fluxer';
    case 'discord':
      return 'fires when someone types it in Discord';
    case 'telegram':
      return 'fires when a command reaches your bot';
    case 'email':
      return 'fires when mail arrives for it';
    case 'webhook':
      return 'fires when a POST arrives';
    case 'heartbeat':
      return 'rides the periodic check-in';
    default:
      return '';
  }
}

/**
 * The ✓ line's note — what happens once it fires. The schedule's is the one
 * exception: it is the parse, and {@link confirmation} writes that.
 */
export function slotNote(slot: TriggerSlot): string {
  switch (slot) {
    case 'fluxer':
    case 'discord':
      return 'replies where it was called · text after the command is appended to the prompt';
    case 'telegram':
      return 'replies in the same chat · text after the command is appended to the prompt';
    case 'email':
      return 'replies to the sender · the mail is attached to the prompt';
    case 'webhook':
      return 'secret shown once after create · payload is attached to the prompt as JSON';
    case 'heartbeat':
      return 'every 30 min · 08:00–22:00 · uses the heartbeat notepad';
    default:
      return '';
  }
}

/** The same word the server accepts; see `AutomationTriggerRules.CommandWord`. */
const COMMAND_WORD = /^[a-z][a-z0-9-]{0,31}$/;

/** The command as the server will store it: no leading slash, no surrounding space. */
export function commandWord(match: string): string {
  return match.trim().replace(/^\/+/, '');
}

/** Whether a card would survive the server's validation. */
export function isValid(card: TriggerCard): boolean {
  switch (card.slot) {
    case 'none':
      return false;
    case 'schedule':
      return card.parse?.ok === true && (card.parse.cron?.length ?? 0) > 0;
    case 'fluxer':
    case 'discord':
    case 'telegram':
      return card.channelId !== null && COMMAND_WORD.test(commandWord(card.match));
    case 'email':
      return card.channelId !== null && card.match.trim().length > 0;
    default:
      return true;
  }
}

/**
 * Why a card is not ready, in the words the ✕ line uses. Null when it is — or
 * when the user has typed nothing yet, which is not an error to shout about
 * while they are still filling the card in.
 */
export function problem(card: TriggerCard): string | null {
  const typed = card.match.trim().length > 0;
  switch (card.slot) {
    case 'schedule':
      if (card.parsing || card.when.trim().length === 0) return null;
      if (card.parse && !card.parse.ok) {
        return card.parse.error ?? 'couldn’t read that — try "every weekday at 7am"';
      }
      return null;
    case 'fluxer':
    case 'discord':
    case 'telegram':
      if (typed && !COMMAND_WORD.test(commandWord(card.match))) {
        return 'a command word is lowercase letters, digits and hyphens, starting with a letter';
      }
      if (typed && card.channelId === null) {
        return `pick the ${slotName(card.slot).replace(' command', '')} connection it listens on`;
      }
      return null;
    case 'email':
      if (typed && card.channelId === null) return 'pick the mailbox it listens on';
      return null;
    default:
      return null;
  }
}

/** What is still missing, before the user has typed enough to be wrong. */
export function pending(card: TriggerCard): string {
  switch (card.slot) {
    case 'schedule':
      return card.parsing ? 'reading that…' : 'say when, in English — "every weekday at 7am"';
    case 'email':
      return 'say what mail it claims, and which mailbox';
    default:
      return 'say the word it answers to, and where';
  }
}

/** The ✓ line: the parse for a schedule, the kind's note otherwise. */
export function confirmation(card: TriggerCard): string {
  if (card.slot !== 'schedule') return slotNote(card.slot);
  const parse = card.parse;
  if (!parse?.ok) return '';
  const first = parse.firstRun
    ? ` · first run ${new Date(parse.firstRun).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })}`
    : '';
  return `${parse.cron} · ${parse.zone}${first}`;
}

/**
 * One line that says what a card is, for the row it sits in before it is
 * opened: "Every weekday at 07:00", "/digest on Discord · bot", "POST
 * /api/hooks/…", "rides every beat".
 */
export function cardSummary(card: TriggerCard, channels: ChannelSummary[]): string {
  const channel = channels.find(c => c.id === card.channelId)?.displayName;
  switch (card.slot) {
    case 'none':
      return 'pick a kind';
    case 'schedule':
      return card.parse?.ok && card.parse.sentence
        ? card.parse.sentence
        : card.when.trim() || 'say when';
    case 'fluxer':
    case 'discord':
    case 'telegram': {
      const word = commandWord(card.match);
      return `${word ? `/${word}` : 'a command'}${channel ? ` on ${channel}` : ''}`;
    }
    case 'email':
      return `${card.match.trim() || 'mail'}${channel ? ` at ${channel}` : ''}`;
    case 'webhook':
      return card.match.trim() ? `POST · ${card.match.trim()}` : 'POST /api/hooks/…';
    case 'heartbeat':
      return card.match === HEARTBEAT_NEEDED ? 'when the check-in needs you' : 'every beat';
  }
}

/**
 * Which line of the picker a stored trigger is on. A chat command is told
 * apart by the connection it names, so a command whose channel is gone falls
 * back to Discord with an empty picker rather than vanishing from the form.
 */
export function slotOf(trigger: AutomationTrigger, channels: ChannelSummary[]): TriggerSlot {
  switch (trigger.kind) {
    case AutomationTriggerKind.Email:
      return 'email';
    case AutomationTriggerKind.Webhook:
      return 'webhook';
    case AutomationTriggerKind.Heartbeat:
      return 'heartbeat';
    default:
      return chatSlot(channels.find(c => c.id === trigger.channelId)?.kind);
  }
}

function chatSlot(kind: ChannelKind | undefined): TriggerSlot {
  switch (kind) {
    case ChannelKind.Fluxer:
      return 'fluxer';
    case ChannelKind.Telegram:
      return 'telegram';
    default:
      return 'discord';
  }
}

/** A stored trigger as a card on the form. */
export function cardOf(trigger: AutomationTrigger, channels: ChannelSummary[]): TriggerCard {
  return {
    ...newCard(slotOf(trigger, channels)),
    id: trigger.id,
    enabled: trigger.enabled,
    channelId: trigger.channelId ?? null,
    match: trigger.match ?? '',
  };
}

/**
 * The routine's own clock as a card. The synthesized schedule carries the
 * routine's id rather than one of its own, and starts as the raw cron: the
 * screen asks the server whether it reads back as a sentence.
 */
export function scheduleCardOf(routine: AutomationSummary): TriggerCard | null {
  if (!routine.cronExpression) return null;
  return {
    ...newCard('schedule'),
    id: routine.id,
    enabled: routine.scheduleEnabled,
    when: routine.cronExpression,
    rawCron: true,
  };
}

/** One proposed trigger from a draft as a card on the form. */
export function cardOfProposal(proposed: RoutineDraftTrigger, channels: ChannelSummary[]): TriggerCard {
  if (proposed.kind === null) {
    return { ...newCard('schedule'), when: proposed.when ?? '' };
  }
  const slot =
    proposed.kind === AutomationTriggerKind.Email
      ? 'email'
      : proposed.kind === AutomationTriggerKind.Webhook
        ? 'webhook'
        : proposed.kind === AutomationTriggerKind.Heartbeat
          ? 'heartbeat'
          : chatSlot(channels.find(c => c.id === proposed.channelId)?.kind);
  return {
    ...newCard(slot),
    channelId: proposed.channelId ?? null,
    match: proposed.match ?? (slot === 'heartbeat' ? HEARTBEAT_ALWAYS : ''),
  };
}

/**
 * One card as a stored trigger. The secret is null throughout — the phone
 * never holds one — and the id rides along so a webhook keeps its URL.
 */
export function toTrigger(card: TriggerCard): AutomationTrigger {
  const kind = kindOf(card.slot);
  if (kind === null) throw new Error('a schedule is a column, not a trigger row');
  return {
    kind,
    channelId: card.channelId,
    match: card.match.trim(),
    secret: null,
    id: card.id,
    enabled: card.enabled,
  };
}

/**
 * Whether a slot can be picked for this card. A command kind needs a
 * connection of that kind to name, and there is only ever one schedule.
 */
export function unavailable(
  slot: TriggerSlot,
  card: TriggerCard,
  cards: TriggerCard[],
  channels: ChannelSummary[],
): string | null {
  if (slot === 'schedule' && card.slot !== 'schedule' && cards.some(t => t !== card && t.slot === 'schedule')) {
    return 'this routine has one';
  }
  const kind = channelKindOf(slot);
  if (kind !== null && card.slot !== slot && !channels.some(c => c.kind === kind)) {
    return 'connect one in the cockpit’s settings';
  }
  return null;
}

/**
 * The picker's lines for one card. Email is only offered when it is
 * relevant — a mailbox is connected, or the card already is one — since an
 * existing email trigger has to be editable rather than quietly dropped.
 */
export function slotsFor(card: TriggerCard, channels: ChannelSummary[]): TriggerSlot[] {
  return SLOTS.filter(
    s => s !== 'email' || card.slot === 'email' || channels.some(c => c.kind === ChannelKind.Email),
  );
}

// ---- the form ----

/** One select, three shapes: "push", "none", or "channel:<id>". */
export type DeliveryKey = string;

export function channelKey(id: string): DeliveryKey {
  return `channel:${id}`;
}

export function keyFor(kind: DeliveryKind, targetId: string | null): DeliveryKey {
  if (kind === DeliveryKind.Channel && targetId) return channelKey(targetId);
  if (kind === DeliveryKind.None) return 'none';
  return 'push';
}

export function deliveryOf(key: DeliveryKey): DeliveryKind {
  if (key === 'none') return DeliveryKind.None;
  if (key.startsWith('channel:')) return DeliveryKind.Channel;
  return DeliveryKind.Push;
}

export function targetOf(key: DeliveryKey): string | null {
  return key.startsWith('channel:') ? key.slice('channel:'.length) || null : null;
}

/** "push", "Discord · bot-name", "nobody (log only)" — the reply row's value. */
export function deliveryLabel(key: DeliveryKey, channels: ChannelSummary[]): string {
  if (key === 'none') return 'nobody (log only)';
  const target = targetOf(key);
  if (target) {
    const channel = channels.find(c => c.id === target);
    return channel ? `${ChannelKind[channel.kind]} · ${channel.displayName}` : 'a channel that is gone';
  }
  return 'push notification';
}

/**
 * A time as the server takes it — a `TimeOnly`, "07:00:00" — from what a
 * person types into a small box: "7:00", "07:00", "7". Null for blank, which
 * means "any time", and null for nonsense, which the ✕ line names.
 */
export function timeOf(text: string): string | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(text);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2] ?? '0');
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

/** Whether a typed time is either blank or readable. */
export function timeOk(text: string): boolean {
  return text.trim().length === 0 || timeOf(text) !== null;
}

/** The form, as the screen holds it. */
export interface RoutineForm {
  name: string;
  prompt: string;
  /** A model id, or "" for auto. */
  model: string;
  facet: string;
  repoUrls: string[];
  nodeIds: string[];
  timeZone: string;
  /** "07:00" as typed; blank means any time. */
  activeStart: string;
  activeEnd: string;
  continuity: boolean;
  delivery: DeliveryKey;
  triggers: TriggerCard[];
}

/** The facet a new routine runs as, which is the cockpit's default too. */
export const DEFAULT_FACET = 'execute';

export function emptyForm(timeZone: string): RoutineForm {
  return {
    name: '',
    prompt: '',
    model: '',
    facet: DEFAULT_FACET,
    repoUrls: [],
    nodeIds: [],
    timeZone,
    activeStart: '',
    activeEnd: '',
    continuity: false,
    delivery: 'push',
    triggers: [],
  };
}

/** A `TimeOnly` ("07:00:00") as the small box shows it. */
function shortTime(time: string | null): string {
  return time ? time.slice(0, 5) : '';
}

/** The form, filled from a stored routine. The schedule card is separate — see {@link scheduleCardOf}. */
export function formOf(routine: AutomationSummary, channels: ChannelSummary[], facets: string[]): RoutineForm {
  const stored = routine.facet ?? '';
  return {
    name: routine.name,
    prompt: routine.prompt,
    model: routine.model ?? '',
    facet:
      stored.length > 0 && facets.some(f => f.toLowerCase() === stored.toLowerCase())
        ? stored
        : DEFAULT_FACET,
    repoUrls: [...routine.repoUrls],
    nodeIds: [...routine.nodeIds],
    timeZone: routine.timeZoneId,
    activeStart: shortTime(routine.activeHoursStart),
    activeEnd: shortTime(routine.activeHoursEnd),
    continuity: routine.continuity,
    delivery: keyFor(routine.deliveryKind, routine.deliveryTargetId),
    triggers: [
      ...(scheduleCardOf(routine) ? [scheduleCardOf(routine)!] : []),
      ...routine.triggers.map(t => cardOf(t, channels)),
    ],
  };
}

/** Name, prompt, one trigger that would actually fire, and no unreadable time. */
export function canSave(form: RoutineForm): boolean {
  return (
    form.name.trim().length > 0 &&
    form.prompt.trim().length > 0 &&
    form.triggers.some(isValid) &&
    timeOk(form.activeStart) &&
    timeOk(form.activeEnd)
  );
}

/** Why the form cannot be saved yet, in one line; null when it can. */
export function formProblem(form: RoutineForm): string | null {
  if (form.name.trim().length === 0) return 'give it a name';
  if (form.prompt.trim().length === 0) return 'say what it should do each run';
  if (!form.triggers.some(isValid)) return 'add a trigger that would fire';
  if (!timeOk(form.activeStart) || !timeOk(form.activeEnd)) return 'active hours read as HH:MM';
  return null;
}

/**
 * The form as the server takes it. The schedule is the routine's own cron
 * column rather than a trigger row, so its card is folded back out here; a
 * card with no kind is one the user added and never filled, and is dropped
 * exactly as "remove" would have.
 */
export function toDraft(form: RoutineForm, enabled: boolean): AutomationDraft {
  const schedule = form.triggers.find(t => t.slot === 'schedule');
  const cron = schedule?.parse?.ok && schedule.parse.cron ? schedule.parse.cron : '';
  const zone = schedule?.parse?.zone || (form.timeZone.trim() || 'UTC');

  return {
    name: form.name.trim(),
    prompt: form.prompt,
    cronExpression: cron,
    timeZoneId: zone,
    enabled,
    facet: form.facet,
    model: form.model.trim().length > 0 ? form.model : null,
    repoUrls: [...form.repoUrls],
    continuity: form.continuity,
    activeHoursStart: timeOf(form.activeStart),
    activeHoursEnd: timeOf(form.activeEnd),
    deliveryKind: deliveryOf(form.delivery),
    deliveryTargetId: targetOf(form.delivery),
    triggers: form.triggers.filter(t => t.slot !== 'none' && t.slot !== 'schedule').map(toTrigger),
    scheduleEnabled: schedule?.enabled ?? true,
    nodeIds: [...form.nodeIds],
  };
}

/**
 * What the fold holds, in the fact-line voice the detail screen uses, so a
 * closed "more options" still says what the routine will run as.
 */
export function moreSummary(form: RoutineForm): string {
  const bits = [form.facet, form.timeZone.trim() || 'UTC'];
  if (form.activeStart.trim() || form.activeEnd.trim()) {
    bits.push(`${form.activeStart.trim() || 'any'}–${form.activeEnd.trim() || 'any'}`);
  }
  if (form.repoUrls.length > 0) bits.push(`${form.repoUrls.length} ${form.repoUrls.length === 1 ? 'repo' : 'repos'}`);
  if (form.nodeIds.length > 0) bits.push(`${form.nodeIds.length} ${form.nodeIds.length === 1 ? 'node' : 'nodes'}`);
  if (form.continuity) bits.push('remembers');
  return bits.join(' · ');
}

/**
 * The heartbeat's own controls, written as a full draft: every other field
 * is carried across unchanged, so saving the interval cannot quietly clear
 * the delivery target or the triggers. As `Detail.razor` does it.
 */
export function heartbeatDraft(
  beat: AutomationSummary,
  settings: { interval: string; activeStart: string; activeEnd: string; model: string },
): AutomationDraft {
  return {
    name: beat.name,
    prompt: beat.prompt,
    cronExpression: settings.interval,
    timeZoneId: beat.timeZoneId,
    enabled: beat.enabled,
    facet: beat.facet,
    model: settings.model.trim().length > 0 ? settings.model : null,
    repoUrls: [...beat.repoUrls],
    continuity: beat.continuity,
    activeHoursStart: timeOf(settings.activeStart),
    activeHoursEnd: timeOf(settings.activeEnd),
    deliveryKind: beat.deliveryKind,
    deliveryTargetId: beat.deliveryTargetId,
    triggers: beat.triggers.map(t => ({ ...t, secret: null })),
    scheduleEnabled: beat.scheduleEnabled,
    nodeIds: [...beat.nodeIds],
  };
}

/** The cadences the heartbeat card offers, as the cockpit lists them. */
export const HEARTBEAT_INTERVALS: { key: string; label: string }[] = [
  { key: '*/15 * * * *', label: '15 minutes' },
  { key: '*/30 * * * *', label: '30 minutes' },
  { key: '0 * * * *', label: 'hour' },
  { key: '0 */3 * * *', label: '3 hours' },
];

/**
 * The webhook URL the caller will POST to. The trigger id is a path segment,
 * not a query: a routine with two webhooks then tells which one fired from the
 * URL alone. The `?secret=` is for callers that cannot set a header.
 */
export function hookUrl(server: string, automationId: string, triggerId: string, secret: string): string {
  return `${server.replace(/\/+$/, '')}/api/hooks/${automationId}/${triggerId}?secret=${secret}`;
}

/** The webhook path as far as it is known before the save. */
export function hookPath(automationId: string | null, card: TriggerCard): string {
  return `/api/hooks/${automationId ?? '…'}/${card.id === EMPTY_GUID ? '(assigned on save)' : card.id}`;
}

/** The first eight hex digits of a trigger id, as the cockpit's chip prints it. */
export function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8);
}
