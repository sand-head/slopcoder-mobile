/**
 * What the cockpit does with three things the server added: an archived
 * session, a chat-room @mention arriving in the transcript, and the session's
 * own chat handle.
 *
 * An archived session is read-only for good — the server refuses a turn in it
 * — so a composer there would only collect words to throw away.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { ApprovalMode, SandboxState, SessionStatus, type SessionState } from '../src/api/contracts';
import type { Item } from '../src/api/transcript';

const base: SessionState = {
  id: 's-1',
  title: 'the session',
  status: SessionStatus.Idle,
  stopRequested: false,
  autoRoute: true,
  approvalMode: ApprovalMode.Dangerous,
  useClassifier: true,
  repoNames: [],
  skillNames: [],
  checkpointCount: 0,
  nextOrdinal: 0,
  facetCatalog: [],
  pendingApprovalIds: [],
  pendingQuestionIds: [],
  usage: { models: [] },
  sandboxState: SandboxState.Stopped,
  lastActivityAt: new Date().toISOString(),
  attachedNodes: [],
  subSessions: [],
  backgroundJobCount: 0,
};

let mockState: SessionState = base;
let mockItems: Item[] = [];

const mockSeam = {
  models: jest.fn(() => Promise.resolve([])),
  facets: jest.fn(() => Promise.resolve([])),
  slashCommands: jest.fn(() => Promise.resolve([])),
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));
jest.mock('../src/ui/TerminalSheet', () => ({ TerminalSheet: () => null }));
jest.mock('../src/ui/shake', () => ({ useShake: () => {} }));
jest.mock('../src/ui/keyboard', () => ({ useKeyboardOffset: () => 0 }));
jest.mock('../src/navigation/headers', () => ({
  useHeaderInset: () => 0,
  barButton: () => ({ headerRight: () => null, unstable_headerRightItems: () => [] }),
}));
jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) => select({ seam: mockSeam }),
}));
jest.mock('../src/state/hub', () => ({ useSessionHub: () => ({ hub: null, connected: true }) }));
jest.mock('../src/state/session', () => ({
  useSession: () => ({
    state: mockState,
    items: mockItems,
    live: null,
    loading: false,
    error: null,
    canLoadEarlier: false,
    loadEarlier: () => {},
  }),
}));

import { SessionDetailScreen } from '../src/screens/SessionDetail';

let mounted: ReturnType<typeof create> | undefined;

async function mount(navigation = { setOptions: jest.fn(), navigate: jest.fn(), push: jest.fn() }) {
  await act(async () => {
    mounted = create(<SessionDetailScreen route={{ params: { id: 's-1' } }} navigation={navigation} />);
  });
  return { tree: mounted!, navigation };
}

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

/** The header title is a component the screen hands the navigator; it says its own subtitle. */
function subtitle(navigation: { setOptions: jest.Mock }): string {
  const options = navigation.setOptions.mock.calls[navigation.setOptions.mock.calls.length - 1][0];
  return options.headerTitle().props.accessibilityLabel as string;
}

beforeEach(() => {
  mockState = base;
  mockItems = [];
});

afterEach(async () => {
  if (mounted) await act(async () => mounted?.unmount());
  mounted = undefined;
});

describe('an archived session', () => {
  it('has no composer, says why, and offers the way on', async () => {
    mockState = { ...base, archivedAt: '2026-11-01T12:00:00Z' };
    const { tree, navigation } = await mount();

    expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Message the session…')).toHaveLength(0);
    expect(text(tree)).toContain('read-only now');
    expect(subtitle(navigation)).toContain('archived · read-only');
    expect(subtitle(navigation)).not.toContain('idle');

    await act(async () =>
      tree.root.find(n => n.props.accessibilityLabel === 'Start a new session' && n.props.onPress).props.onPress(),
    );
    expect(navigation.navigate).toHaveBeenCalledWith('Tabs', { screen: 'SessionsTab' });
  });

  it('is not what a live session looks like', async () => {
    const { tree, navigation } = await mount();
    expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Message the session…').length).toBeGreaterThan(0);
    expect(subtitle(navigation)).not.toContain('archived');
  });
});

describe('a chat-room mention', () => {
  it('reads as the sender’s, not the user’s, and opens its room', async () => {
    mockItems = [
      {
        kind: 'chat-mention',
        key: '0:main',
        ordinal: 0,
        sub: null,
        room: 'relay',
        seq: 42,
        sender: 'brisk-comet-42',
        fromUser: false,
        text: '@quiet-otter-7 take the relay next?',
        interjected: true,
      },
    ];
    const { tree, navigation } = await mount();

    const rendered = text(tree);
    expect(rendered).toContain('@brisk-comet-42 · #relay · message 42 · mid-turn');
    expect(rendered).toContain('take the relay next?');
    // Nobody typed it: no 'you' card.
    expect(rendered).not.toMatch(/\byou\b/);

    await act(async () =>
      tree.root
        .find(n => n.props.accessibilityLabel === 'brisk-comet-42 mentioned this agent in #relay. Open the channel')
        .props.onPress(),
    );
    expect(navigation.navigate).toHaveBeenCalledWith('Room', { name: 'relay' });
  });
});

describe('the chat handle', () => {
  it('is in the session sheet, with the way to the rooms', async () => {
    mockState = { ...base, chatHandle: 'quiet-otter-7' };
    const { tree, navigation } = await mount();

    expect(text(tree)).toContain('@quiet-otter-7');
    await act(async () =>
      tree.root.find(n => n.props.accessibilityLabel === 'Open chat rooms' && n.props.onPress).props.onPress(),
    );
    expect(navigation.navigate).toHaveBeenCalledWith('Rooms');
  });
});
