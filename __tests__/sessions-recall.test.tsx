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
            navigate: jest.fn(),
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
});
