/**
 * The wording the Routines screens share.
 *
 * All of it is a port of `RoutineFormat.cs` and the parts of `TimeFormat.cs` it
 * leans on, and the two have to agree: the same run should not read as "quiet"
 * on a phone and "skipped" in the browser, and a strip of bars that means
 * something different on each is worse than no strip.
 *
 * Times are built from local `Date` parts rather than written as UTC strings,
 * so these pass wherever they are run — which is the same reason the board is
 * asked for in the phone's own zone.
 */
import {
  AutomationRunStatus,
  AutomationTriggerKind,
  ChannelKind,
  RunOutcome,
  type HeartbeatStatus,
  type RoutineBoard,
  type RoutineCard,
  type RoutineFailure,
  type RunDetail,
  type RunSummary,
} from '../src/api/contracts';
import {
  duration,
  failureMeta,
  groupRuns,
  heartbeatMeta,
  lastLabel,
  ledger,
  nextLabel,
  notepadLine,
  ordinal,
  outcomeOf,
  runNote,
  soon,
  spend,
  statusLabel,
  triggerKindName,
  until,
  when,
} from '../src/api/routines';

/** 2026-09-13, 09:00 on whatever clock the test is running on. */
const NOW = new Date(2026, 8, 13, 9, 0).getTime();

/**
 * Some of these read the clock themselves — a card footer says "in 22h", and
 * nobody wants to thread a timestamp through four layers of component to say
 * it. So the clock is pinned instead, and the helpers that *do* take a `now`
 * are still handed one, because those are the ones a screen re-renders with.
 */
beforeAll(() => jest.useFakeTimers({ now: NOW }));
afterAll(() => jest.useRealTimers());

const at = (dayOffset: number, hour: number, minute = 0) =>
  new Date(2026, 8, 13 + dayOffset, hour, minute).toISOString();

function run(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-1',
    routineId: 'routine-1',
    routineName: 'triage',
    startedAt: at(0, 7),
    finishedAt: at(0, 7, 4),
    status: AutomationRunStatus.Completed,
    outcome: RunOutcome.Notified,
    durationMs: 242_000,
    said: 'Two PRs need review.',
    error: null,
    delivered: true,
    trigger: 0,
    triggerId: null,
    triggerSource: null,
    retryOfRunId: null,
    ...overrides,
  };
}

describe('how long something took', () => {
  it.each([
    [480, '480ms'],
    [12_340, '12.3s'],
    [242_000, '4m 02s'],
    [4_320_000, '1h 12m'],
  ])('reads %ims as %s', (ms, text) => {
    expect(duration(ms)).toBe(text);
  });
});

describe('when something happens', () => {
  it('says how long until a deadline, and "now" once it is past', () => {
    expect(until(at(0, 11), NOW)).toBe('in 2h');
    expect(until(at(0, 9, 8), NOW)).toBe('in 8m');
    expect(until(at(0, 8), NOW)).toBe('now');
  });

  it('reads a past run as near as it needs to be', () => {
    expect(when(at(0, 7), NOW)).toBe('today 07:00');
    expect(when(at(-1, 14, 20), NOW)).toBe('yesterday 14:20');
    // Inside the last week it is a weekday; before that, a date.
    expect(when(at(-3, 7), NOW)).toMatch(/^\w{3,4} 07:00$/);
    expect(when(at(-40, 7), NOW)).not.toMatch(/:/);
  });

  /** The line has already said "next", so this one says only how far off. */
  it('shortens a coming fire to fit a list of them', () => {
    expect(soon(at(0, 9, 8), NOW)).toBe('8m');
    expect(soon(at(0, 12), NOW)).toBe('12:00');
    expect(soon(at(2, 7), NOW)).toMatch(/^\w{3,4} 07:00$/);
    expect(soon(at(-1, 7), NOW)).toBe('due');
  });
});

describe('how a run ended', () => {
  /**
   * A skip paints as a quiet bar — nothing was said and nothing is wrong — but
   * a row that calls it "quiet" hides that the run never happened at all.
   */
  it('calls a skip a skip, while colouring it quiet', () => {
    expect(statusLabel(AutomationRunStatus.Skipped)).toBe('skipped');
    expect(outcomeOf(AutomationRunStatus.Skipped)).toBe(RunOutcome.Quiet);
  });

  it('gives a run still going no outcome to colour', () => {
    expect(outcomeOf(AutomationRunStatus.Running)).toBeNull();
    expect(statusLabel(AutomationRunStatus.Running)).toBe('running');
  });

  it.each([
    [AutomationRunStatus.Completed, 'notified'],
    [AutomationRunStatus.Quiet, 'quiet'],
    [AutomationRunStatus.Failed, 'failed'],
  ])('labels %i as %s', (status, label) => {
    expect(statusLabel(status)).toBe(label);
  });
});

describe('a failure', () => {
  const failure: RoutineFailure = {
    routineId: 'routine-1',
    name: 'triage',
    runId: 'run-9',
    at: at(0, 7),
    error: 'connection refused',
    durationMs: 12_340,
    streak: 3,
  };

  it('says what broke, for how long, and how many times in a row', () => {
    expect(failureMeta(failure)).toBe('connection refused · 12.3s · 3rd failure in a row');
  });

  /** A streak of one is just "it failed", which the line above already said. */
  it('leaves out a streak of one', () => {
    expect(failureMeta({ ...failure, streak: 1 })).toBe('connection refused · 12.3s');
  });

  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
  ])('counts %i as %s', (n, text) => {
    expect(ordinal(n)).toBe(text);
  });
});

describe('a routine card', () => {
  const card: RoutineCard = {
    id: 'routine-1',
    name: 'triage',
    kind: 0,
    enabled: true,
    scheduleEnabled: true,
    scheduleSentence: 'Every weekday at 07:00',
    scheduleMeta: '0 7 * * 1-5 · Europe/Berlin',
    history: [],
    lastRun: run(),
    nextFire: at(1, 7),
    lastFailed: false,
    running: false,
    triggerCount: 0,
  };

  it('says when it last ran and how that went', () => {
    expect(lastLabel(card)).toBe('last 07:00 · notified');
    expect(lastLabel({ ...card, lastRun: null })).toBe('never run');
  });

  /**
   * Three different things, and a paused routine must not be shown a next time
   * it is not going to keep.
   */
  it('says what is next, or why there is no next', () => {
    // A date rather than "tomorrow 07:00": `when` names a weekday only for the
    // week just gone, which is the cockpit's behaviour and not worth diverging
    // from on one screen.
    expect(nextLabel(card.nextFire, false)).toBe('next Sep 14 (in 22h)');
    expect(nextLabel(card.nextFire, true)).toBe('paused');
    expect(nextLabel(null, false)).toBe('on trigger');
  });
});

describe('the heartbeat', () => {
  const beat: HeartbeatStatus = {
    id: 'beat',
    enabled: true,
    intervalSentence: 'every 30 min',
    activeStart: '08:00:00',
    activeEnd: '22:00:00',
    nextFire: at(0, 9, 8),
    notepadItems: ['watch the CI queue', 'chase the flaky test', 'and a third'],
    quietToday: 3,
    notifiedToday: 1,
    running: false,
  };

  it('reads its cadence, its window and its next beat as one line', () => {
    expect(heartbeatMeta(beat)).toBe('every 30 min · 08:00–22:00 · next in 8m');
  });

  /** Paused, it has no next beat — saying one would be a promise it is not keeping. */
  it('says paused instead of a time it will not keep', () => {
    expect(heartbeatMeta({ ...beat, enabled: false })).toBe(
      'every 30 min · 08:00–22:00 · paused',
    );
  });

  it('counts the notepad and shows the first two of it', () => {
    expect(notepadLine(beat)).toBe('Notepad · 3 items · watch the CI queue, chase the flaky test');
    expect(notepadLine({ ...beat, notepadItems: [] })).toBe('Notepad · empty');
  });
});

describe('what a trigger is called', () => {
  it('names the service a chat command listens on', () => {
    const chat = AutomationTriggerKind.ChannelCommand;
    expect(triggerKindName(chat, ChannelKind.Discord)).toBe('Discord command');
    expect(triggerKindName(chat, ChannelKind.Fluxer)).toBe('Fluxer command');
    // A connection that no longer exists still has a kind to fall back on.
    expect(triggerKindName(chat, null)).toBe('Chat command');
  });

  it('calls a null kind the schedule, because that is what it is', () => {
    expect(triggerKindName(null)).toBe('Schedule');
    expect(triggerKindName(AutomationTriggerKind.Webhook)).toBe('Webhook');
    expect(triggerKindName(AutomationTriggerKind.Heartbeat)).toBe('Heartbeat');
  });
});

describe('the ledger', () => {
  const board = (overrides: Partial<RoutineBoard>): RoutineBoard => ({
    routines: [],
    failures: [],
    heartbeat: null,
    runsToday: 0,
    notifiedToday: 0,
    quietToday: 0,
    failedToday: 0,
    upcoming: [],
    ...overrides,
  });

  it('takes the merged list the server sends', () => {
    const recent = [run({ id: 'a' }), run({ id: 'b' })];
    expect(ledger(board({ recentRuns: recent })).map(r => r.id)).toEqual(['a', 'b']);
  });

  /**
   * An older host does not send one, and a board whose runs have all aged out
   * sends an empty one. The cards' own last runs still make an honest, if
   * short, list — which beats a tab that says nothing has ever run.
   */
  it('falls back to the cards own last runs, newest first', () => {
    const card = (id: string, startedAt: string): RoutineCard => ({
      id,
      name: id,
      kind: 0,
      enabled: true,
      scheduleEnabled: true,
      scheduleSentence: '',
      scheduleMeta: '',
      history: [],
      lastRun: run({ id: `run-${id}`, startedAt }),
      nextFire: null,
      lastFailed: false,
      running: false,
      triggerCount: 0,
    });

    const rows = ledger(
      board({ recentRuns: [], routines: [card('old', at(-2, 7)), card('new', at(0, 7))] }),
    );
    expect(rows.map(r => r.id)).toEqual(['run-new', 'run-old']);
  });

  it('leaves out a routine that has never run', () => {
    const never: RoutineCard = {
      id: 'x',
      name: 'x',
      kind: 0,
      enabled: true,
      scheduleEnabled: true,
      scheduleSentence: '',
      scheduleMeta: '',
      history: [],
      lastRun: null,
      nextFire: null,
      lastFailed: false,
      running: false,
      triggerCount: 0,
    };
    expect(ledger(board({ routines: [never] }))).toEqual([]);
  });
});

describe('grouping the ledger', () => {
  it('groups into today, yesterday and earlier, in that order', () => {
    const groups = groupRuns(
      [
        run({ id: 'a', startedAt: at(0, 7) }),
        run({ id: 'b', startedAt: at(-1, 7) }),
        run({ id: 'c', startedAt: at(-9, 7) }),
        run({ id: 'd', startedAt: at(0, 8) }),
      ],
      NOW,
    );

    expect(groups.map(g => g.label)).toEqual(['today', 'yesterday', 'earlier']);
    expect(groups[0].runs.map(r => r.id)).toEqual(['a', 'd']);
  });

  /** An empty heading is a heading that says nothing; it is not rendered. */
  it('skips a bucket nothing fell into', () => {
    const groups = groupRuns([run({ startedAt: at(-1, 7) })], NOW);
    expect(groups.map(g => g.label)).toEqual(['yesterday']);
  });
});

describe('one run, in full', () => {
  const detail = (overrides: Partial<RunDetail> = {}): RunDetail => ({
    run: run(),
    sessionId: 'session-1',
    model: 'claude-sonnet',
    inputTokens: 30_000,
    outputTokens: 8_000,
    estimatedCost: 0.11,
    steps: [],
    finalMessage: null,
    endedAt: at(0, 7, 4),
    ...overrides,
  });

  it('prices a run in one line', () => {
    expect(spend(detail())).toBe('4m 02s · 38k tokens · $0.11 · claude-sonnet');
  });

  /**
   * A provider that reported no usage should read as short, not as broken: a
   * row of dashes claims we know the figures were zero.
   */
  it('leaves out what it was not told, rather than writing dashes', () => {
    expect(spend(detail({ inputTokens: null, outputTokens: null, estimatedCost: null }))).toBe(
      '4m 02s · claude-sonnet',
    );
  });

  it('ends the turn in the transcript own wording', () => {
    expect(runNote(detail())).toMatch(/^end of turn · notified · /);
    expect(runNote(detail({ run: run({ delivered: false }) }))).toMatch(/not delivered/);
  });

  it('says why a run failed, and admits when nothing was recorded', () => {
    const failed = run({ status: AutomationRunStatus.Failed, outcome: RunOutcome.Failed });
    expect(runNote(detail({ run: { ...failed, error: 'connection refused' } }))).toBe(
      'failed · connection refused',
    );
    expect(runNote(detail({ run: failed }))).toBe('failed · no error was recorded');
  });

  it('explains a quiet run rather than showing an empty panel', () => {
    const quiet = run({ status: AutomationRunStatus.Quiet, outcome: RunOutcome.Quiet, said: null });
    expect(runNote(detail({ run: quiet }))).toBe('quiet · NO_REPLY');
  });
});
