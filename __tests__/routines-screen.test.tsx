/**
 * The board, rendered — because nothing else here can be.
 *
 * There is no way to run this app on a Linux dev machine: the screens only ever
 * execute on a phone, after a twenty-minute signed build, in front of the
 * person who then has to describe what went wrong. So the cheapest possible
 * check is worth having — mount it against a board the server could really
 * send, and prove the words that matter reach the screen.
 *
 * This is a smoke test, not a layout one. It cannot tell you the strip is the
 * right height; it can tell you the tab you shipped renders at all, which is
 * the failure that costs a build.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import {
  AutomationKind,
  AutomationRunStatus,
  RunOutcome,
  type RoutineBoard,
} from '../src/api/contracts';

const board: RoutineBoard = {
  routines: [
    {
      id: 'routine-1',
      name: 'morning triage',
      kind: AutomationKind.Job,
      enabled: true,
      scheduleEnabled: true,
      scheduleSentence: 'Every weekday at 07:00',
      scheduleMeta: '0 7 * * 1-5 · Europe/Berlin',
      history: [null, RunOutcome.Quiet, RunOutcome.Notified, RunOutcome.Failed],
      lastRun: {
        id: 'run-1',
        routineId: 'routine-1',
        routineName: 'morning triage',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: AutomationRunStatus.Failed,
        outcome: RunOutcome.Failed,
        durationMs: 12_340,
        said: null,
        error: 'connection refused',
        delivered: false,
        trigger: 0,
        triggerId: null,
        triggerSource: null,
        retryOfRunId: null,
      },
      nextFire: new Date(Date.now() + 3_600_000).toISOString(),
      lastFailed: true,
      running: false,
      triggerCount: 1,
    },
  ],
  failures: [
    {
      routineId: 'routine-1',
      name: 'morning triage',
      runId: 'run-1',
      at: new Date().toISOString(),
      error: 'connection refused',
      durationMs: 12_340,
      streak: 3,
    },
  ],
  heartbeat: null,
  runsToday: 4,
  notifiedToday: 1,
  quietToday: 2,
  failedToday: 1,
  upcoming: [],
  recentRuns: [],
};

const mockSeam = {
  routineBoard: jest.fn(() => Promise.resolve(board)),
  setRoutineEnabled: jest.fn(() => Promise.resolve(null)),
  retryRoutineRun: jest.fn(() => Promise.resolve(null)),
  heartbeat: jest.fn(() => Promise.resolve(null)),
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// The banner has a hub behind it and nothing to say about routines.
jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));

jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) =>
    select({ seam: mockSeam, credential: { server: 'https://slop.example.com' } }),
}));

// The imports come after the mocks on purpose: a screen imported first
// would capture the real store before jest replaced it.
import { RoutinesScreen } from '../src/screens/Routines';
import { SheetSegments } from '../src/ui/Sheet';

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  setOptions: jest.fn(),
  addListener: () => () => {},
};

async function mount() {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(<RoutinesScreen navigation={navigation} />);
  });
  return tree!;
}

/**
 * Every string the tree renders, in order and joined as they appear.
 *
 * The children, never the props: a rendered node's props hold React elements
 * (a `refreshControl`, a `right` slot) whose owners point back up the tree, so
 * serializing them is a circular structure rather than a sentence.
 */
function text(tree: ReturnType<typeof create>): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string') return void parts.push(node);
    if (Array.isArray(node)) return void node.forEach(walk);
    (node as { children?: unknown[] }).children?.forEach(walk);
  };
  walk(tree.toJSON());
  return parts.join('');
}

describe('the routines board', () => {
  beforeEach(() => {
    mockSeam.routineBoard.mockClear();
    navigation.navigate.mockClear();
  });

  it('opens on the runs ledger and leads with what needs you', async () => {
    const rendered = text(await mount());

    // One failure, so the singular — the streak of three is the *run's* meta.
    expect(rendered).toContain('1 failed run needs you');
    expect(rendered).toContain('morning triage failed at');
    // The failure's own words, and the streak, rather than a bare "it failed".
    expect(rendered).toContain('3rd failure in a row');
  });

  it('counts the day at the foot, the way the cockpit header does', async () => {
    expect(text(await mount())).toContain('4 runs today');
  });

  /**
   * The tab the board is *named* for. Its card carries the sentence, the cron
   * line and the footer; a routine that reads as only a name is the regression
   * worth catching.
   */
  it('paints a routine as a card with its schedule in words', async () => {
    const tree = await mount();
    await act(async () => tree.root.findByType(SheetSegments).props.onSelect('routines'));

    const rendered = text(tree);
    expect(rendered).toContain('Every weekday at 07:00');
    expect(rendered).toContain('0 7 * * 1-5 · Europe/Berlin');
    expect(rendered).toContain('last ');
  });

  /** Writing a routine is a form of our own now, not a page in a browser. */
  it('presents the editor for a new routine', async () => {
    await mount();
    const options = navigation.setOptions.mock.calls.at(-1)![0];
    options.unstable_headerRightItems()[0].onPress();
    expect(navigation.navigate).toHaveBeenCalledWith('RoutineEditor');
  });

  /** "today" is counted on the reader's clock, so the phone has to say which. */
  it('asks for the board in this phone zone', async () => {
    await mount();
    expect(mockSeam.routineBoard).toHaveBeenCalledWith(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });
});
