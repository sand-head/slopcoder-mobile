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
let mockLive: { thinking: string; text: string } | null = null;
let mockCanLoadEarlier = false;
const mockLoadEarlier = jest.fn();

const mockSeam = {
  models: jest.fn(() => Promise.resolve([])),
  facets: jest.fn(() => Promise.resolve([])),
  slashCommands: jest.fn(() => Promise.resolve([])),
  get: jest.fn(() => Promise.resolve([] as { repo: string; branch?: string; detached?: boolean }[])),
  addSessionRepository: jest.fn(async (_id: string, _url: string): Promise<string | null> => null),
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
    live: mockLive,
    loading: false,
    error: null,
    canLoadEarlier: mockCanLoadEarlier,
    loadEarlier: mockLoadEarlier,
  }),
}));

import { SessionDetailScreen, insertDateMarkers } from '../src/screens/SessionDetail';

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

/** The screen hands the navigator its own header; these are the props it draws from. */
function header(navigation: { setOptions: jest.Mock }) {
  const options = navigation.setOptions.mock.calls[navigation.setOptions.mock.calls.length - 1][0];
  return options.header().props as {
    title: string;
    subtitle: string;
    accessibilityNote?: string;
    onOpenContext: () => void;
    menuItems: { key: string; title: string }[];
  };
}

/** What the header says after the title: its subtitle and any note, as a reader hears it. */
function subtitle(navigation: { setOptions: jest.Mock }): string {
  const props = header(navigation);
  return `${props.subtitle}. ${props.accessibilityNote ?? ''}`;
}

beforeEach(() => {
  mockState = base;
  mockItems = [];
  mockLive = null;
  mockCanLoadEarlier = false;
  mockLoadEarlier.mockReset();
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
  it('preserves historical sender and text without a dead room link', async () => {
    mockItems = [{ kind: 'chat-mention', key: '0:main', ordinal: 0, sub: null,
      room: 'relay', seq: 42, sender: 'brisk-comet-42', fromUser: false,
      text: 'take the relay next?', interjected: true }];
    const { tree, navigation } = await mount();
    expect(text(tree)).toContain('@brisk-comet-42 · #relay · message 42 · mid-turn');
    expect(text(tree)).toContain('take the relay next?');
    expect(tree.root.findAll(n => n.props.accessibilityRole === 'button' && String(n.props.accessibilityLabel).includes('former room'))).toHaveLength(0);
    expect(navigation.navigate).not.toHaveBeenCalledWith('Room', expect.anything());
  });
});

test('keeps the agent handle without a retired room navigation action', async () => {
  mockState = { ...base, chatHandle: 'quiet-otter-7' };
  const { tree } = await mount();
  expect(text(tree)).toContain('@quiet-otter-7');
  expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Open chat rooms')).toHaveLength(0);
});

describe('a direct agent message', () => {
  it.each(['sender-id', null])('attributes text and only links the sender when the session id is %s', async senderSessionId => {
    mockItems = [{ kind: 'direct-message', key: '1:main', ordinal: 1, sub: null,
      messageId: 'm-1', senderSessionId, sender: 'amber', text: '<script>unsafe</script>', interjected: true }];
    const { tree, navigation } = await mount();
    expect(text(tree)).toContain('@amber · direct agent message · mid-turn');
    expect(text(tree)).toContain('<script>unsafe</script>');
    expect(text(tree)).not.toContain('#relay');
    const links = tree.root.findAll(n => n.props.accessibilityLabel === 'Open agent session for amber' && n.props.onPress);
    if (senderSessionId) {
      expect(links).toHaveLength(1);
      await act(async () => links[0].props.onPress());
      expect(navigation.push).toHaveBeenCalledWith('Session', { id: senderSessionId });
    } else expect(links).toHaveLength(0);
  });
});


test('repository context treats absent branch metadata as unknown and labels detached commits', async () => {
  mockSeam.get.mockResolvedValueOnce([{ repo: 'old' }, { repo: 'second', branch: 'abc123', detached: true }]);
  const { tree, navigation } = await mount();
  await act(async () => { header(navigation).onOpenContext(); await Promise.resolve(); });
  expect(mockSeam.get).toHaveBeenCalledWith('api/seam/sessions/s-1/workspace/changes');
  expect(text(tree)).toContain('Branch unknown');
  expect(text(tree)).toContain('Detached · abc123');
});

test('adjacent tool calls and plans are collapsible without inventing evidence', async () => {
  mockItems = [
    { kind: 'tool', key: 'a', ordinal: 1, sub: null, name: 'read_file', input: '{}', result: 'one', isError: false, running: false },
    { kind: 'tool', key: 'b', ordinal: 2, sub: null, name: 'read_file', input: '{}', result: 'two', isError: false, running: false },
    { kind: 'plan', key: 'c', ordinal: 3, sub: null, steps: [{ text: 'Real step', status: 'pending' }] },
  ];
  const { tree } = await mount();
  // The web's captions: a sentence for the run, progress for the plan.
  expect(text(tree)).toContain('Read 2 files');
  expect(text(tree)).toContain('0 of 1 steps complete');
  expect(text(tree)).not.toContain('Real step');
  expect(tree.root.findAll(n => n.props.accessibilityState?.expanded === false && n.props.onPress).length).toBeGreaterThanOrEqual(2);
});


test('status search stops after three pages and explains how to continue', async () => {
  mockState = { ...base, pendingApprovalIds: ['old-request'] };
  mockCanLoadEarlier = true;
  mockLoadEarlier.mockResolvedValue({ progress: true, hasMore: true, items: [] });
  const { tree } = await mount();
  await act(async () => {
    tree.root.find(n => n.props.accessibilityLabel === 'Waiting for permission. Jump to current request' && n.props.onPress).props.onPress();
    await Promise.resolve();
  });
  expect(mockLoadEarlier).toHaveBeenCalledTimes(3);
  expect(text(tree)).toContain('Request not found in three earlier pages');
});

test('status search explains a paging error rather than pretending to jump', async () => {
  mockState = { ...base, pendingQuestionIds: ['old-question'] };
  mockCanLoadEarlier = true;
  mockLoadEarlier.mockResolvedValue({ progress: false, hasMore: true, error: 'offline' });
  const { tree } = await mount();
  await act(async () => {
    tree.root.find(n => n.props.accessibilityLabel === 'Waiting for an answer. Jump to current request' && n.props.onPress).props.onPress();
    await Promise.resolve();
  });
  expect(text(tree)).toContain('Could not load earlier messages: offline');
});


test('repository add displays the real server rejection without claiming success', async () => {
  mockSeam.addSessionRepository.mockResolvedValueOnce('Repository URL is invalid.');
  const { tree, navigation } = await mount();
  await act(async () => { header(navigation).onOpenContext(); await Promise.resolve(); });
  const field = tree.root.find(n => n.props.accessibilityLabel === 'Repository URL' && n.props.onChangeText);
  await act(async () => { field.props.onChangeText('invalid'); });
  const button = tree.root.find(n => n.props.accessibilityLabel === 'Add repository' && n.props.onPress);
  await act(async () => { await button.props.onPress(); });
  expect(mockSeam.addSessionRepository).toHaveBeenCalledWith('s-1', 'invalid');
  expect(text(tree)).toContain('Repository URL is invalid.');
  expect(text(tree)).not.toContain('Repository added.');
});

test('status search finds a genuinely pending request in an earlier page', async () => {
  mockState = { ...base, pendingApprovalIds: ['old-request'] };
  mockCanLoadEarlier = true;
  const target: Item = { kind: 'approval', key: 'old', ordinal: 0, sub: null, requestId: 'old-request', toolName: 'read_file', input: '{}', reason: '', refused: false, approved: null, preview: null };
  mockLoadEarlier.mockImplementationOnce(async () => { mockItems = [target]; return { progress: true, hasMore: false, items: [target] }; });
  const { tree } = await mount();
  await act(async () => {
    tree.root.find(n => n.props.accessibilityLabel === 'Waiting for permission. Jump to current request' && n.props.onPress).props.onPress();
    await Promise.resolve();
  });
  expect(mockLoadEarlier).toHaveBeenCalledTimes(1);
  expect(text(tree)).not.toContain('Request not found');
});


test('date separators use actual valid local event dates only', () => {
  const first = new Date(2026, 0, 1, 12).toISOString();
  const second = new Date(2026, 0, 2, 12).toISOString();
  const row = (key: string, at?: string): Item => ({ kind: 'text', key, ordinal: 1, sub: null, text: key, at });
  const rows = insertDateMarkers([row('missing'), row('one', first), row('one-again', first), row('bad', 'invalid'), row('two', second)]);
  const markers = rows.filter(item => item.kind === 'date-marker');
  expect(markers).toHaveLength(2);
  expect(markers.map(item => item.at)).toEqual([first, second]);
  expect(rows[0].key).toBe('missing');
});

test('live thinking starts collapsed and exposes its actual text when opened', async () => {
  mockLive = { thinking: 'actual thinking', text: '' };
  const { tree } = await mount();
  expect(text(tree)).not.toContain('actual thinking');
  const disclosure = tree.root.findAll(n => n.props.accessibilityState?.expanded === false && n.props.onPress)[0];
  expect(disclosure).toBeDefined();
  await act(async () => disclosure!.props.onPress());
  expect(text(tree)).toContain('actual thinking');
});


test('terminal remains in session options only for non-archived sessions', async () => {
  const { navigation } = await mount();
  expect(header(navigation).menuItems.map(item => item.title)).toContain('Open terminal');
  expect(header(navigation).menuItems.map(item => item.title)).toEqual(expect.arrayContaining(['Session context', 'Switch session', 'Session usage']));
  mockState = { ...base, archivedAt: '2026-11-01T12:00:00Z' };
  await act(async () => mounted!.update(<SessionDetailScreen route={{ params: { id: 's-1' } }} navigation={navigation} />));
  expect(header(navigation).menuItems.map(item => item.title)).not.toContain('Open terminal');
});
