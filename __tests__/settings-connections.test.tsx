/**
 * The connections pages, mounted — because nothing else here can be.
 *
 * As with the routine editor: the screens only ever run on a phone after a
 * signed build, so the cheapest check is to mount each against summaries
 * the server could really send and prove it paints them, refuses what the
 * web refuses, and polls what the web polls. Smoke tests, not layout ones.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import {
  CodexPollStatus,
  GitServiceKind,
  ProviderKind,
  type ConnectionSummary,
  type GitConnectionSummary,
} from '../src/api/contracts';

const anthropic: ConnectionSummary = {
  id: 'c-1',
  kind: ProviderKind.Anthropic,
  displayName: 'Personal Anthropic',
  baseUrl: null,
  createdAt: '2026-09-01T12:00:00Z',
  lastValidatedAt: null,
  accountLabel: null,
  enabled: true,
};

const github: GitConnectionSummary = {
  id: 'g-1',
  kind: GitServiceKind.GitHub,
  displayName: 'GitHub',
  baseUrl: null,
  username: 'sand-head',
  createdAt: '2026-09-02T12:00:00Z',
  lastValidatedAt: null,
};

const mockSeam = {
  connections: jest.fn(() => Promise.resolve([anthropic])),
  gitConnections: jest.fn(() => Promise.resolve([github])),
  gitApps: jest.fn(() => Promise.resolve([])),
  createConnection: jest.fn(() => Promise.resolve({ id: 'c-2', error: null })),
  codexStart: jest.fn(() =>
    Promise.resolve({
      deviceAuthId: 'da-1',
      userCode: 'ABCD-EFGH',
      interval: '00:00:01',
      verificationUrl: 'https://chatgpt.com/device',
      error: null,
    }),
  ),
  codexPoll: jest.fn(() => Promise.resolve({ status: CodexPollStatus.Pending, error: null })),
  codexImport: jest.fn(() => Promise.resolve(null)),
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));

jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) =>
    select({ seam: mockSeam, credential: { server: 'https://slop.example.com' } }),
}));

import { ConnectionsScreen } from '../src/screens/settings/Connections';
import { ProviderEditorScreen } from '../src/screens/settings/ProviderEditor';
import { CodexConnectScreen } from '../src/screens/settings/CodexConnect';

function navigator() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    dispatch: jest.fn(),
    setOptions: jest.fn(),
    addListener: () => () => {},
  };
}

async function mount(element: React.ReactElement) {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(element);
  });
  await act(async () => {});
  await act(async () => {});
  return tree!;
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

/** The bar's options, as the screen last set them. */
function bar(navigation: ReturnType<typeof navigator>) {
  const calls = navigation.setOptions.mock.calls;
  return calls[calls.length - 1][0] as {
    title: string;
    unstable_headerRightItems: () => { type: string; label: string; disabled?: boolean; onPress?: () => void; menu?: { items: { label: string }[] } }[];
  };
}

beforeEach(() => {
  for (const fn of Object.values(mockSeam)) fn.mockClear();
});

describe('the connections page', () => {
  it('lists a provider with its meta line, the git account, and four ways to add', async () => {
    const navigation = navigator();
    const tree = await mount(<ConnectionsScreen navigation={navigation} />);
    const rendered = text(tree);

    expect(rendered).toContain('Personal Anthropic');
    expect(rendered).toContain('Anthropic · default · added 2026-09-01');
    expect(rendered).toContain('sand-head');
    expect(rendered).toContain('GitHub · github.com · connected 2026-09-02');
    // No apps registered: the foot says who can fix that.
    expect(rendered).toContain('Ask an administrator');

    const [menu] = bar(navigation).unstable_headerRightItems();
    expect(menu.type).toBe('menu');
    expect(menu.menu!.items.map(i => i.label)).toEqual([
      'Anthropic API · api key',
      'OpenAI-compatible · endpoint',
      'Claude Code · subscription',
      'ChatGPT · Codex · subscription',
    ]);
  });
});

describe('the provider editor', () => {
  it('offers presets for an OpenAI-compatible endpoint and refuses an empty key', async () => {
    const navigation = navigator();
    const tree = await mount(
      <ProviderEditorScreen route={{ params: { kind: ProviderKind.OpenAICompatible } }} navigation={navigation} />,
    );

    expect(bar(navigation).title).toBe('Connect an OpenAI-compatible endpoint');
    expect(text(tree)).toContain('preset');

    // A name alone is not a connection.
    const nameField = tree.root.findAll(n => n.props.accessibilityLabel === 'Name' && typeof n.props.onChangeText === 'function')[0];
    await act(async () => {
      nameField.props.onChangeText('Local vLLM');
    });
    await act(async () => {
      bar(navigation).unstable_headerRightItems()[0].onPress!();
    });

    expect(text(tree)).toContain('A name and an API key are both required.');
    expect(mockSeam.createConnection).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});

describe('the codex sign-in', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows the user code once the flow starts, and polls the server for the approval', async () => {
    const navigation = navigator();
    const tree = await mount(<CodexConnectScreen navigation={navigation} />);

    const signIn = tree.root.findAll(n => n.props.accessibilityLabel === 'Sign in with ChatGPT' && typeof n.props.onPress === 'function')[0];
    await act(async () => {
      signIn.props.onPress();
    });
    await act(async () => {});

    expect(mockSeam.codexStart).toHaveBeenCalledTimes(1);
    expect(text(tree)).toContain('ABCD-EFGH');
    expect(text(tree)).toContain('Waiting for you to approve…');

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });
    await act(async () => {});

    expect(mockSeam.codexPoll).toHaveBeenCalledWith('da-1', 'ABCD-EFGH', expect.anything());
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});
