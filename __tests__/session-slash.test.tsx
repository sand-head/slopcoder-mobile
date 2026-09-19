/**
 * A slash command goes to the seam, not to the model.
 *
 * This is the whole point of the feature and the one part of it a unit test
 * can reach: the composer's menu is checked in `composer.test.tsx`, the rules
 * in `slash.test.ts`, and what is left is the wiring in `send` — which,
 * before this existed, cheerfully posted "/compact" to an agent as a prompt.
 *
 * Mounting the cockpit means standing in for everything under it. The mocks
 * below are that, and nothing more: a session that is not running, no
 * transcript, and a seam that records what it was asked.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import {
  ApprovalMode,
  SandboxState,
  SessionStatus,
  type SessionState,
} from '../src/api/contracts';

const mockState: SessionState = {
  id: 's-1',
  title: 'the session',
  status: SessionStatus.Idle,
  stopRequested: false,
  autoRoute: true,
  approvalMode: ApprovalMode.Dangerous,
  useClassifier: true,
  repoNames: ['slopcoder'],
  skillNames: [],
  checkpointCount: 0,
  nextOrdinal: 0,
  facetCatalog: [],
  pendingApprovalIds: [],
  pendingQuestionIds: [],
  usage: { models: [] },
  sandboxState: SandboxState.Running,
  lastActivityAt: new Date().toISOString(),
  attachedNodes: [],
  subSessions: [],
  backgroundJobCount: 0,
};

const mockSeam = {
  models: jest.fn(() => Promise.resolve([])),
  facets: jest.fn(() => Promise.resolve([])),
  slashCommands: jest.fn(() =>
    Promise.resolve([{ name: 'compact', help: 'summarize older history' }]),
  ),
  runSlashCommand: jest.fn(() => Promise.resolve(null)),
  start: jest.fn(() => Promise.resolve(true)),
  steer: jest.fn(() => Promise.resolve(true)),
  presence: jest.fn(() => Promise.resolve(true)),
  setThinking: jest.fn(() => Promise.resolve(null)),
  setApprovalMode: jest.fn(() => Promise.resolve(null)),
  setFacet: jest.fn(() => Promise.resolve(null)),
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));
jest.mock('../src/ui/TerminalSheet', () => ({ TerminalSheet: () => null }));
jest.mock('../src/ui/shake', () => ({ useShake: () => {} }));
jest.mock('../src/ui/keyboard', () => ({ useKeyboardOffset: () => 0 }));
jest.mock('../src/navigation/headers', () => ({ useHeaderInset: () => 0 }));
jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) => select({ seam: mockSeam }),
}));
jest.mock('../src/state/hub', () => ({ useSessionHub: () => ({ hub: null, connected: true }) }));
jest.mock('../src/state/session', () => ({
  useSession: () => ({
    state: mockState,
    items: [],
    live: null,
    loading: false,
    error: null,
    canLoadEarlier: false,
    loadEarlier: () => {},
  }),
}));

// After the mocks: a screen imported first would capture the real stores.
import { SessionDetailScreen } from '../src/screens/SessionDetail';

/**
 * Unmounted after each test: the transcript is a `VirtualizedList`, whose
 * windowing runs off a timer, and a tree left standing fires that timer after
 * the test has finished — a React act warning for work nobody asked for.
 */
let mounted: ReturnType<typeof create> | undefined;

async function mount() {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(
      <SessionDetailScreen
        route={{ params: { id: 's-1' } }}
        navigation={{ setOptions: () => {}, navigate: () => {} }}
      />,
    );
  });
  mounted = tree!;
  return tree!;
}

async function type(tree: ReturnType<typeof create>, text: string) {
  const input = tree.root.find(
    node => node.props.accessibilityLabel === 'Send a message…' && !!node.props.onChangeText,
  );
  await act(async () => input.props.onChangeText(text));
}

async function press(tree: ReturnType<typeof create>, label: string) {
  await act(async () =>
    tree.root.find(
      node => node.props.accessibilityLabel === label && node.props.accessibilityRole === 'button',
    ).props.onPress(),
  );
}

beforeEach(() => {
  Object.values(mockSeam).forEach(fn => fn.mockClear());
});

afterEach(async () => {
  if (mounted) await act(async () => mounted?.unmount());
  mounted = undefined;
});

describe('the cockpit composer', () => {
  it('runs a slash command through the seam and starts no turn with it', async () => {
    const tree = await mount();

    await type(tree, '/compact');
    await press(tree, 'Send');

    expect(mockSeam.runSlashCommand).toHaveBeenCalledWith('s-1', '/compact');
    // What the command had to say is in the scrollback; nothing was prompted.
    expect(mockSeam.start).not.toHaveBeenCalled();
    expect(mockSeam.steer).not.toHaveBeenCalled();
  });

  /** A repo template answers with a prompt, which is sent as if it were typed. */
  it('sends what a template expanded to', async () => {
    mockSeam.runSlashCommand.mockResolvedValueOnce({
      promptToSend: 'review the diff',
    } as never);
    const tree = await mount();

    await type(tree, '/review the diff');
    await press(tree, 'Send');

    expect(mockSeam.start).toHaveBeenCalledWith(
      's-1',
      expect.objectContaining({ prompt: 'review the diff' }),
    );
  });

  it('leaves ordinary prose alone', async () => {
    const tree = await mount();

    await type(tree, 'fix the failing test');
    await press(tree, 'Send');

    expect(mockSeam.runSlashCommand).not.toHaveBeenCalled();
    expect(mockSeam.start).toHaveBeenCalledWith(
      's-1',
      expect.objectContaining({ prompt: 'fix the failing test' }),
    );
  });

  /** The menu's list comes from the server, and the screen asks as it opens. */
  it('has the session own commands ready before the first slash', async () => {
    const tree = await mount();

    expect(mockSeam.slashCommands).toHaveBeenCalledWith('s-1');

    await type(tree, '/');
    const labels = tree.root
      .findAll(node => typeof node.props.accessibilityLabel === 'string')
      .map(node => node.props.accessibilityLabel as string);
    expect(labels).toContain('/compact');
  });
});
