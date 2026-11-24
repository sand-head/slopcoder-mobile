/**
 * The transcript's lines are one column and one rhythm.
 *
 * A status note, a tool call, a thinking row and a group of calls each drew
 * their own row: the note had no inset, so its dot sat six points left of the
 * tool's; it had no minimum height, so the gap above a tool call was not the
 * gap below it; and three different disclosure marks (`>`, `›`, a drawn ⌄)
 * sat in three different places. These pin the shared geometry in `ROW`.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, create } from 'react-test-renderer';
import { ApprovalMode, SandboxState, SessionStatus, type SessionState } from '../src/api/contracts';
import type { Item } from '../src/api/transcript';
import { Brain, ROW } from '../src/ui/kit';

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


beforeEach(() => {
  mockState = base;
  mockLive = null;
  const at = (n: number) => ({ key: `${n}:main`, ordinal: n, sub: null });
  mockItems = [
    { kind: 'note', ...at(0), text: 'Claude Code connected.', tone: 'muted' },
    { kind: 'tool', ...at(1), name: 'Bash', running: false, isError: false, result: 'exit code: 0\nok',
      input: JSON.stringify({ command: 'cd /repo; sed -n 1,130p a.cs', description: 'Check the signatures', timeout: 120000 }) },
    { kind: 'think', ...at(2), text: 'hmm', durationMs: 1200 },
    { kind: 'tool', ...at(3), name: 'Bash', running: false, isError: false, result: 'ok', input: JSON.stringify({ command: 'ls' }) },
    { kind: 'tool', ...at(4), name: 'Bash', running: false, isError: false, result: 'ok', input: JSON.stringify({ command: 'pwd' }) },
    { kind: 'note', ...at(5), text: 'Classifier reviews tool calls.', tone: 'muted' },
  ] as Item[];
});

afterEach(async () => {
  if (mounted) await act(async () => mounted?.unmount());
  mounted = undefined;
});

/** Every host view laid out as a transcript line. */
function lines(tree: ReturnType<typeof create>) {
  return tree.root
    .findAll(n => typeof n.type === 'string' && StyleSheet.flatten(n.props.style)?.minHeight === ROW.minHeight)
    .map(n => ({ node: n, style: StyleSheet.flatten(n.props.style) }));
}

it('puts every line\'s mark in one column, at one height', async () => {
  const { tree } = await mount();
  const found = lines(tree);
  // Two notes, the described call, the thinking row, the group of two.
  expect(found.length).toBeGreaterThanOrEqual(5);
  for (const { node, style } of found) {
    expect(style).toMatchObject({
      flexDirection: 'row',
      paddingHorizontal: ROW.paddingHorizontal,
      paddingVertical: ROW.paddingVertical,
      gap: ROW.gap,
    });
    const gutter = node.children[0];
    expect(typeof gutter === 'string' ? null : StyleSheet.flatten(gutter.props.style)?.width).toBe(ROW.gutter);
  }
});

it('uses one disclosure mark, and never a typed arrow', async () => {
  const { tree } = await mount();
  expect(text(tree)).not.toMatch(/[>›]/);
});

it('heads a described command with what it is for', async () => {
  const { tree } = await mount();
  expect(text(tree)).toContain('Check the signatures');
  expect(text(tree)).not.toContain('timeout');
  expect(text(tree)).not.toContain('sed -n');
});

it('marks a thinking row with the brain, in the gutter every row\'s mark sits in', async () => {
  const { tree } = await mount();
  // One thinking row in the fixture, so one brain — and it is a line's gutter mark.
  expect(tree.root.findAllByType(Brain)).toHaveLength(1);
  const marked = lines(tree).filter(({ node }) => {
    const gutter = node.children[0];
    return typeof gutter !== 'string' && gutter.findAllByType(Brain).length > 0;
  });
  expect(marked).toHaveLength(1);
});
