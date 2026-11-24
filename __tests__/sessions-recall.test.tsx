/**
 * Recall on the launcher: the header's search field filters the list locally,
 * and when the list comes up empty, the same words go to the server's
 * full-text search over what was *said* in past sessions.
 *
 * The web has only the second half — its sidebar field always searches the
 * server. A phone has the one field, so the order matters and is the point of
 * these checks: local hits suppress the server call entirely, an empty local
 * list with a one-letter query never calls it, and an empty local list with a
 * real query gets scrollback rows after the same 300ms debounce the web uses.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { SessionStatus, type SessionSummary } from '../src/api/contracts';
import { matchesSession } from '../src/api/sessionIdentity';

const sessionsFixture: SessionSummary[] = [
  {
    id: 's-1',
    title: 'Mobile parity',
    model: 'claude-fable-5',
    status: SessionStatus.Idle,
    createdAt: '2026-09-20T10:00:00Z',
    updatedAt: '2026-09-25T10:00:00Z',
    autoRoute: false,
  },
];

const hits = [
  {
    sessionId: 's-9',
    sessionTitle: 'Codex quota polling',
    when: '2026-09-24T09:30:00Z',
    kind: 'user',
    snippet: '…why does the quota refresh stall on the 5-hour window…',
  },
];

const mockSeam = {
  sessions: jest.fn((): Promise<SessionSummary[]> => Promise.resolve(sessionsFixture)),
  models: jest.fn(() => Promise.resolve([])),
  facets: jest.fn(() => Promise.resolve([])),
  recentRepos: jest.fn(() => Promise.resolve([])),
  nodes: jest.fn(() => Promise.resolve([])),
  routineStatus: jest.fn(() => Promise.resolve({ anyRoutines: false })),
  sessionSearch: jest.fn((): Promise<typeof hits> => Promise.resolve(hits)),
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));

// The mocked stores must return the SAME object every call: zustand reads
// through useSyncExternalStore, and a factory that builds a fresh object per
// render makes the snapshot unstable — React re-renders to re-read it, which
// re-renders, and the worker dies on an allocation loop rather than an error.
// (The web-era tests that get away with the unstable form simply render less.)
const mockAuthState = { seam: mockSeam };

jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) => select(mockAuthState),
}));

jest.mock('../src/state/hub', () => ({ useSessionHub: () => ({ hub: null }) }));

jest.mock('../src/state/repos', () => ({
  useOwnedRepos: () => ({ repos: [], loading: false }),
}));

jest.mock('../src/state/connection', () => ({
  useConnection: (select: (state: unknown) => unknown) => select({ recoveries: 0 }),
}));

const mockRoutineState = { setFailed: jest.fn() };

jest.mock('../src/state/routines', () => ({
  useRoutineAlert: (select: (state: unknown) => unknown) => select(mockRoutineState),
}));

import { SessionsScreen } from '../src/screens/Sessions';

/** The header search bar the navigator owns; the screen only receives its text. */
let onChangeText: ((e: { nativeEvent: { text: string } }) => void) | undefined;
const navigate = jest.fn();

async function mount() {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SessionsScreen
        navigation={
          {
            setOptions: (options: {
              headerSearchBarOptions?: { onChangeText: (e: { nativeEvent: { text: string } }) => void };
            }) => {
              onChangeText = options.headerSearchBarOptions?.onChangeText;
            },
            addListener: () => () => {},
            navigate,
          } as never
        }
      />,
    );
  });
  return tree;
}

beforeEach(() => {
  mockSeam.sessionSearch.mockClear();
  mockSeam.sessions.mockClear();
  navigate.mockClear();
  onChangeText = undefined;
});

/**
 * Real timers, and a real wait for the 300ms debounce. Fake timers were tried
 * first and OOM-killed the worker: something on this screen schedules
 * recurring work (the breathing status dot's animation loop), and advancing
 * time by hand never lets that loop settle between act() flushes. A real
 * 350ms per keystroke is the price of not debugging React's scheduler against
 * RN's animation frames in a unit test.
 */
const settleDebounce = () => new Promise<void>(resolve => setTimeout(resolve, 350));

async function type(tree: ReturnType<typeof create>, text: string) {
  await act(async () => {
    onChangeText!({ nativeEvent: { text } });
  });
  await act(async () => {
    await settleDebounce();
  });
  await act(async () => {});

  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const element = node as { children?: unknown[] };
    for (const child of element.children ?? []) walk(child);
  };
  walk(tree.toJSON());
  return out.join(' ');
}

describe('launcher recall', () => {
  it('never asks the server while the local list still matches', async () => {
    const tree = await mount();
    const all = await type(tree, 'mobile');
    expect(all).toContain('Mobile parity');
    expect(mockSeam.sessionSearch).not.toHaveBeenCalled();
  });

  it('asks the server once the local list comes up empty, and shows the scrollback hits', async () => {
    const tree = await mount();
    const all = await type(tree, 'quota');
    expect(mockSeam.sessionSearch).toHaveBeenCalledWith('quota', 10);
    expect(all).toContain('said in past sessions');
    expect(all).toContain('Codex quota polling');
    expect(all).toContain('user');
    expect(all).toContain('why does the quota refresh stall');
  });

  it('says so when nothing was said that matches either', async () => {
    mockSeam.sessionSearch.mockImplementation(() => Promise.resolve([]));
    const tree = await mount();
    const all = await type(tree, 'quota');
    expect(all).toContain('Nothing said in a past session matches that.');
  });

  it('does not ask for a one-letter query', async () => {
    const tree = await mount();
    await type(tree, 'q');
    expect(mockSeam.sessionSearch).not.toHaveBeenCalled();
  });

  /**
   * An archived session is off the list but not gone: search is how it is
   * found again, so an empty list must still search — and a hit has to say it
   * can only be read now, not continued.
   */
  it('searches an empty list, and marks a hit from an archived session', async () => {
    mockSeam.sessions.mockImplementationOnce(() => Promise.resolve([]));
    mockSeam.sessionSearch.mockImplementation(() => Promise.resolve([{ ...hits[0], archived: true }]));
    const tree = await mount();
    const all = await type(tree, 'quota');
    expect(mockSeam.sessionSearch).toHaveBeenCalledWith('quota', 10);
    expect(all).toContain('Codex quota polling');
    expect(all).toContain('· archived');
    expect(all).not.toContain('No sessions yet');
  });

  it('does not expose retired shared rooms on the launcher', async () => {
    const tree = await mount();
    try {
      expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Create channel')).toHaveLength(0);
    } finally { await act(async () => tree.unmount()); }
  });
});


test('local session search matches optional repository labels and real status without breaking old servers', () => {
  const old = sessionsFixture[0];
  expect(matchesSession(old, 'mobile')).toBe(true);
  expect(matchesSession(old, 'slopcoder')).toBe(false);
  expect(matchesSession({ ...old, repoNames: null }, 'idle')).toBe(true);
  expect(matchesSession({ ...old, repoNames: ['SlopCoder-Mobile'], status: SessionStatus.Running }, 'CODER-MOBILE')).toBe(true);
  expect(matchesSession({ ...old, repoNames: [] }, 'running')).toBe(false);
  expect(matchesSession({ ...old, status: SessionStatus.Running }, 'running')).toBe(true);
});

it('places recents in a single rounded pane without a leading divider', async () => {
  const tree = await mount();
  const pane = tree.root.findByProps({ testID: 'recent-sessions-pane' });
  expect(pane.props.style.borderRadius).toBeGreaterThan(0);
  expect(tree.root.findAll(node => node.props.children === 'Recent sessions').length).toBeGreaterThan(0);
  expect(pane.findAll(node => node.props.accessibilityLabel === 'Mobile parity, idle').length).toBeGreaterThan(0);
  await act(async () => tree.unmount());
});

it('filters recents without triggering full-text recall or losing the list', async () => {
  const tree = await mount();
  const filter = (label: string) => tree.root.find(node => node.props.accessibilityLabel === label && node.props.onPress);
  act(() => filter('Running sessions').props.onPress());
  expect(filter('Running sessions').props.accessibilityState.selected).toBe(true);
  expect(tree.root.findAll(node => node.props.accessibilityLabel === 'Mobile parity, idle')).toHaveLength(0);
  expect(mockSeam.sessionSearch).not.toHaveBeenCalled();
  act(() => filter('All recent sessions').props.onPress());
  expect(tree.root.findAll(node => node.props.accessibilityLabel === 'Mobile parity, idle').length).toBeGreaterThan(0);
  await act(async () => tree.unmount());
});
