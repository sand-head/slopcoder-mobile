/**
 * What the editor decides, off the phone: which cards are ready, how a form
 * folds into the server's draft, and how a stored routine unfolds back into
 * one. The rules are the web editor's (`TriggerEdit.cs`, `Editor.razor`), and
 * the cases here are the ones where a slip would save something the server
 * rejects — or worse, accepts and runs.
 */
import {
  AutomationKind,
  AutomationTriggerKind,
  ChannelKind,
  DeliveryKind,
  EMPTY_GUID,
  type AutomationSummary,
  type ChannelSummary,
} from '../src/api/contracts';
import {
  canSave,
  cardOfProposal,
  cardSummary,
  deliveryLabel,
  emptyForm,
  formOf,
  formProblem,
  heartbeatDraft,
  hookUrl,
  isValid,
  keyFor,
  moreSummary,
  newCard,
  problem,
  slotOf,
  slotsFor,
  timeOf,
  toDraft,
  unavailable,
  type TriggerCard,
} from '../src/api/routineEditor';

const discord: ChannelSummary = {
  id: 'ch-discord',
  kind: ChannelKind.Discord,
  displayName: 'bot',
  enabled: true,
  hasSecret: true,
  settings: '{}',
  pairedPeers: [],
  pendingPairings: [],
  mainSessionId: null,
  lastError: null,
  lastSeenAt: null,
  createdAt: '2026-09-01T00:00:00Z',
};

const mailbox: ChannelSummary = { ...discord, id: 'ch-mail', kind: ChannelKind.Email, displayName: 'inbox' };

const parsed = (cron: string, zone = 'Europe/Berlin') => ({
  ok: true,
  cron,
  zone,
  sentence: 'Every weekday at 07:00',
  firstRun: '2026-09-15T05:00:00Z',
  error: null,
});

function schedule(when = 'every weekday at 7am'): TriggerCard {
  return { ...newCard('schedule'), when, parse: parsed('0 7 * * 1-5') };
}

describe('a trigger card', () => {
  it('is nothing until a kind is picked', () => {
    expect(isValid(newCard())).toBe(false);
    expect(problem(newCard())).toBeNull();
  });

  it('is a schedule only once the server has read it as a cron', () => {
    const card = { ...newCard('schedule'), when: 'every weekday at 7am' };
    expect(isValid(card)).toBe(false);
    expect(isValid({ ...card, parse: parsed('0 7 * * 1-5') })).toBe(true);
  });

  /** A half-typed schedule is not an error to shout about; a rejected one is. */
  it('names the parse error, and stays quiet while typing or reading', () => {
    const card = { ...newCard('schedule'), when: 'whenever' };
    expect(problem(card)).toBeNull();
    expect(problem({ ...card, parsing: true, parse: { ...parsed(''), ok: false, error: 'no' } })).toBeNull();
    expect(problem({ ...card, parse: { ...parsed(''), ok: false, error: 'couldn’t read "whenever"' } })).toBe(
      'couldn’t read "whenever"',
    );
  });

  it('holds a chat command to the server’s word shape, slash forgiven', () => {
    const card = { ...newCard('discord'), channelId: discord.id, match: '/digest' };
    expect(isValid(card)).toBe(true);
    expect(isValid({ ...card, match: 'Digest' })).toBe(false);
    expect(problem({ ...card, match: 'Digest' })).toMatch(/lowercase/);
    expect(problem({ ...card, channelId: null })).toBe('pick the Discord connection it listens on');
  });

  it('needs a mailbox for mail', () => {
    const card = { ...newCard('email'), match: 'digest' };
    expect(isValid(card)).toBe(false);
    expect(problem(card)).toBe('pick the mailbox it listens on');
    expect(isValid({ ...card, channelId: mailbox.id })).toBe(true);
  });

  it('accepts a webhook and a heartbeat as they are', () => {
    expect(isValid(newCard('webhook'))).toBe(true);
    expect(isValid(newCard('heartbeat'))).toBe(true);
    expect(newCard('heartbeat').match).toBe('always');
  });

  it('summarises itself for the row it sits in', () => {
    expect(cardSummary(schedule(), [])).toBe('Every weekday at 07:00');
    expect(cardSummary({ ...newCard('discord'), channelId: discord.id, match: 'digest' }, [discord])).toBe(
      '/digest on bot',
    );
    expect(cardSummary({ ...newCard('heartbeat'), match: 'needed' }, [])).toBe('when the check-in needs you');
  });
});

describe('the kind picker', () => {
  it('offers one schedule per routine, and command kinds only with a connection', () => {
    const other = schedule();
    const card = newCard();
    expect(unavailable('schedule', card, [other, card], [])).toBe('this routine has one');
    expect(unavailable('schedule', other, [other, card], [])).toBeNull();
    expect(unavailable('discord', card, [card], [])).toMatch(/connect one/);
    expect(unavailable('discord', card, [card], [discord])).toBeNull();
    expect(unavailable('webhook', card, [card], [])).toBeNull();
  });

  /** An email trigger somebody already has must stay editable, mailbox or not. */
  it('lists email only when it is relevant', () => {
    expect(slotsFor(newCard(), [])).not.toContain('email');
    expect(slotsFor(newCard(), [mailbox])).toContain('email');
    expect(slotsFor(newCard('email'), [])).toContain('email');
  });

  it('places a stored chat command by the connection it names', () => {
    const trigger = { kind: AutomationTriggerKind.ChannelCommand, channelId: 'ch-fluxer', match: 'x', id: 't', enabled: true };
    expect(slotOf(trigger, [{ ...discord, id: 'ch-fluxer', kind: ChannelKind.Fluxer }])).toBe('fluxer');
    // The connection is gone: Discord with an empty picker, not a vanished row.
    expect(slotOf(trigger, [])).toBe('discord');
  });
});

describe('the draft', () => {
  const routine: AutomationSummary = {
    id: 'r-1',
    name: 'morning triage',
    kind: AutomationKind.Job,
    prompt: 'triage the inbox',
    cronExpression: '0 7 * * 1-5',
    timeZoneId: 'Europe/Berlin',
    enabled: false,
    scheduleEnabled: false,
    facet: 'Assist',
    model: 'gpt-x',
    repoUrls: ['https://x/a/b.git'],
    nodeIds: ['n-1'],
    continuity: true,
    notepad: '',
    activeHoursStart: '08:00:00',
    activeHoursEnd: '22:30:00',
    deliveryKind: DeliveryKind.Channel,
    deliveryTargetId: discord.id,
    triggers: [
      { kind: AutomationTriggerKind.Webhook, channelId: null, match: null, secret: null, id: 't-hook', enabled: true },
      { kind: AutomationTriggerKind.ChannelCommand, channelId: discord.id, match: 'triage', secret: null, id: 't-cmd', enabled: false },
    ],
    sessionId: null,
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  it('unfolds a stored routine into the form, schedule first', () => {
    const form = formOf(routine, [discord], ['execute', 'assist']);
    expect(form.triggers.map(t => t.slot)).toEqual(['schedule', 'webhook', 'discord']);
    // The synthesized schedule carries the routine's own id.
    expect(form.triggers[0].id).toBe('r-1');
    expect(form.triggers[0].enabled).toBe(false);
    expect(form.triggers[0].rawCron).toBe(true);
    expect(form.triggers[2].id).toBe('t-cmd');
    expect(form.triggers[2].enabled).toBe(false);
    // The facet matches the catalog case-insensitively and keeps its stored spelling.
    expect(form.facet).toBe('Assist');
    expect(form.activeStart).toBe('08:00');
    expect(form.activeEnd).toBe('22:30');
    expect(form.delivery).toBe(`channel:${discord.id}`);
  });

  it('falls back to the default facet when the stored one is not in the catalog', () => {
    expect(formOf(routine, [discord], ['execute']).facet).toBe('execute');
  });

  it('folds the form back into what the server takes', () => {
    const form = formOf(routine, [discord], ['execute', 'assist']);
    form.triggers[0].parse = parsed('0 7 * * 1-5');
    form.triggers.push(newCard()); // added and never filled

    const draft = toDraft(form, false);
    expect(draft.cronExpression).toBe('0 7 * * 1-5');
    expect(draft.timeZoneId).toBe('Europe/Berlin');
    expect(draft.scheduleEnabled).toBe(false);
    expect(draft.enabled).toBe(false);
    // The schedule is a column, the empty card is dropped, ids ride along.
    expect(draft.triggers.map(t => t.id)).toEqual(['t-hook', 't-cmd']);
    expect(draft.triggers.every(t => t.secret === null)).toBe(true);
    expect(draft.triggers[1].enabled).toBe(false);
    expect(draft.activeHoursStart).toBe('08:00:00');
    expect(draft.activeHoursEnd).toBe('22:30:00');
    expect(draft.deliveryKind).toBe(DeliveryKind.Channel);
    expect(draft.deliveryTargetId).toBe(discord.id);
    expect(draft.repoUrls).toEqual(['https://x/a/b.git']);
    expect(draft.nodeIds).toEqual(['n-1']);
  });

  /**
   * A trigger the user just added has no id. It must go over the wire as the
   * empty Guid the server treats as "new" — an empty string is a 400.
   */
  it('sends a new trigger with the empty Guid', () => {
    const form = { ...emptyForm('UTC'), name: 'x', prompt: 'y', triggers: [newCard('webhook')] };
    expect(toDraft(form, true).triggers[0].id).toBe(EMPTY_GUID);
    expect(EMPTY_GUID).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('takes the parse’s zone over the typed one, and UTC over nothing', () => {
    const form = { ...emptyForm('  '), name: 'x', prompt: 'y', triggers: [schedule()] };
    expect(toDraft(form, true).timeZoneId).toBe('Europe/Berlin');
    expect(toDraft({ ...form, triggers: [newCard('webhook')] }, true).timeZoneId).toBe('UTC');
  });

  it('can save with a name, a prompt and one trigger that would fire', () => {
    const form = { ...emptyForm('UTC'), name: 'x', prompt: 'y', triggers: [newCard()] };
    expect(canSave(form)).toBe(false);
    expect(formProblem(form)).toBe('add a trigger that would fire');
    expect(canSave({ ...form, triggers: [newCard('webhook')] })).toBe(true);
    expect(formProblem({ ...form, name: ' ' })).toBe('give it a name');
    expect(formProblem({ ...form, triggers: [newCard('webhook')], activeStart: '25:00' })).toBe(
      'active hours read as HH:MM',
    );
  });

  it('adopts a proposed trigger from a description', () => {
    expect(cardOfProposal({ kind: null, when: 'every day at 9', channelId: null, match: null }, [])).toMatchObject({
      slot: 'schedule',
      when: 'every day at 9',
    });
    expect(
      cardOfProposal({ kind: AutomationTriggerKind.ChannelCommand, when: null, channelId: discord.id, match: 'digest' }, [discord]),
    ).toMatchObject({ slot: 'discord', channelId: discord.id, match: 'digest' });
    expect(cardOfProposal({ kind: AutomationTriggerKind.Heartbeat, when: null, channelId: null, match: null }, [])).toMatchObject({
      slot: 'heartbeat',
      match: 'always',
    });
  });

  it('writes the heartbeat’s four controls as a full draft, nothing else touched', () => {
    const beat = { ...routine, kind: AutomationKind.Heartbeat, cronExpression: '*/30 * * * *' };
    const draft = heartbeatDraft(beat, { interval: '0 * * * *', activeStart: '9', activeEnd: '', model: '' });
    expect(draft.cronExpression).toBe('0 * * * *');
    expect(draft.activeHoursStart).toBe('09:00:00');
    expect(draft.activeHoursEnd).toBeNull();
    expect(draft.model).toBeNull();
    expect(draft.deliveryTargetId).toBe(discord.id);
    expect(draft.triggers.map(t => t.id)).toEqual(['t-hook', 't-cmd']);
    expect(draft.enabled).toBe(false);
  });
});

describe('the small words', () => {
  it('reads a typed time as a TimeOnly', () => {
    expect(timeOf('7')).toBe('07:00:00');
    expect(timeOf('7:30')).toBe('07:30:00');
    expect(timeOf('22:05')).toBe('22:05:00');
    expect(timeOf('24:00')).toBeNull();
    expect(timeOf('7:60')).toBeNull();
    expect(timeOf('noon')).toBeNull();
    expect(timeOf('')).toBeNull();
  });

  it('keys delivery the way the settings page does', () => {
    expect(keyFor(DeliveryKind.Push, null)).toBe('push');
    expect(keyFor(DeliveryKind.None, null)).toBe('none');
    expect(keyFor(DeliveryKind.Channel, 'ch')).toBe('channel:ch');
    // A channel with no target is push, not a broken key.
    expect(keyFor(DeliveryKind.Channel, null)).toBe('push');
    expect(deliveryLabel('channel:ch-discord', [discord])).toBe('Discord · bot');
    expect(deliveryLabel('channel:gone', [discord])).toBe('a channel that is gone');
    expect(deliveryLabel('none', [])).toBe('nobody (log only)');
  });

  it('says what the fold holds', () => {
    const form = { ...emptyForm('Europe/Berlin'), activeStart: '8', repoUrls: ['a'], nodeIds: ['n', 'm'], continuity: true };
    expect(moreSummary(form)).toBe('execute · Europe/Berlin · 8–any · 1 repo · 2 nodes · remembers');
  });

  it('assembles the webhook URL with the trigger as a path segment', () => {
    expect(hookUrl('https://slop.example.com/', 'a', 't', 's3cret')).toBe(
      'https://slop.example.com/api/hooks/a/t?secret=s3cret',
    );
  });
});
