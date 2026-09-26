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
  hasModelCatalog: false,
};

const github: GitConnectionSummary = {
  id: 'g-1',
  kind: GitServiceKind.GitHub,
  displayName: 'GitHub',
  baseUrl: null,
  username: 'sand-head',
  createdAt: '2026-09-02T12:00:00Z',
  lastValidatedAt: null,
  trouble: null,
};

const mockSeam = {
  connections: jest.fn((): Promise<ConnectionSummary[]> => Promise.resolve([anthropic])),
  gitConnections: jest.fn(() => Promise.resolve([github])),
  gitApps: jest.fn(() => Promise.resolve([])),
  createConnection: jest.fn((): Promise<{ id: string | null; error: string | null; needsModelCatalog?: boolean }> =>
    Promise.resolve({ id: 'c-2', error: null }),
  ),
  connectionModels: jest.fn((): Promise<{ id: string; displayName: string }[]> => Promise.resolve([])),
  disabledModels: jest.fn((): Promise<string[]> => Promise.resolve([])),
  connectionTiers: jest.fn((): Promise<Record<string, never>> => Promise.resolve({})),
  modelCatalog: jest.fn((): Promise<string | null> => Promise.resolve(null)),
  setModelCatalog: jest.fn((): Promise<string | null> => Promise.resolve(null)),
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
    // A healthy account says nothing about reconnecting.
    expect(rendered).not.toContain('reconnect');

    const [menu] = bar(navigation).unstable_headerRightItems();
    expect(menu.type).toBe('menu');
    expect(menu.menu!.items.map(i => i.label)).toEqual([
      'Anthropic API · api key',
      'OpenAI-compatible · endpoint',
      'Claude Code · subscription',
      'ChatGPT · Codex · subscription',
    ]);
  });

  /**
   * The failure this replaced was silent everywhere: an expired Forgejo
   * sign-in made the repository picker come up empty, with no error, on the
   * phone and in the cockpit alike. The server now names it, and this is the
   * end of that wire.
   */
  it('says when a git account needs reconnecting, in the words the server used', async () => {
    mockSeam.gitConnections.mockImplementationOnce(() =>
      Promise.resolve([
        { ...github, trouble: "Sign-in expired and couldn't be renewed — reconnect it." },
      ]),
    );

    const rendered = text(await mount(<ConnectionsScreen navigation={navigator()} />));

    expect(rendered).toContain('reconnect');
    expect(rendered).toContain("Sign-in expired and couldn't be renewed — reconnect it.");
  });

  /**
   * A catalog-fed connection says so where its models are listed, and the
   * catalog itself opens from there: loaded from the server, saved back with
   * the same PUT the web makes. The remedy lives where the empty list is seen.
   */
  it('edits a model catalog from the models sheet', async () => {
    const local = { ...anthropic, id: 'c-9', kind: ProviderKind.OpenAICompatible, displayName: 'Local vLLM', baseUrl: 'http://localhost:11434/v1', hasModelCatalog: true };
    mockSeam.connections.mockImplementationOnce(() => Promise.resolve([local]));
    mockSeam.connectionModels.mockImplementationOnce(() => Promise.resolve([{ id: 'm-1', displayName: 'm' }]));
    mockSeam.modelCatalog.mockImplementationOnce(() => Promise.resolve('{"models":[{"slug":"m"}]}'));

    const tree = await mount(<ConnectionsScreen navigation={navigator()} />);
    await act(async () => {
      // The row's label is its title + subtitle; the models sheet opens from it.
      const row = tree.root.findAll(
        n => n.props.accessibilityRole === 'button' && String(n.props.accessibilityLabel ?? '').startsWith('Local vLLM'),
      )[0];
      row.props.onPress();
    });
    await act(async () => {});

    expect(text(tree)).toContain('from your catalog · ungraded route as medium');

    // Open the editor; the stored draft loads into it.
    const open = tree.root.findAll(
      n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Edit model catalog',
    )[0];
    await act(async () => {
      open.props.onPress();
    });
    await act(async () => {});
    expect(mockSeam.modelCatalog).toHaveBeenCalledWith('c-9');

    const box = tree.root.findAll(
      n => typeof n.props.onChangeText === 'function' && n.props.accessibilityLabel === 'Model catalog',
    )[0];
    expect(box).toBeDefined();

    // Saving sends the PUT and re-reads the connection list.
    await act(async () => {
      tree.root.findAll(n => n.props.accessibilityLabel === 'Save catalog' && typeof n.props.onPress === 'function')[0].props.onPress();
    });
    await act(async () => {});
    expect(mockSeam.setModelCatalog).toHaveBeenCalledWith('c-9', '{"models":[{"slug":"m"}]}');
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

  /**
   * The catalog field is the remedy for an endpoint that won't answer
   * GET /models — hidden until asked for, and sent only when filled. The
   * failure it fixes otherwise reads as a bad key, on the phone as on the web.
   */
  it('keeps the catalog hidden until asked, sends it when filled, and opens it when the endpoint asks for one', async () => {
    const navigation = navigator();
    const tree = await mount(
      <ProviderEditorScreen route={{ params: { kind: ProviderKind.OpenAICompatible } }} navigation={navigation} />,
    );

    // Hidden by default: a JSON textarea over the key field is noise until it isn't.
    expect(text(tree)).not.toContain('model catalog');

    const reveal = tree.root.findAll(
      n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === "this endpoint doesn't list its models",
    )[0];
    await act(async () => {
      reveal.props.onPress();
    });
    expect(text(tree)).toContain('model catalog');

    // A form the server will take, so the failure under test is the catalog one.
    for (const [label, value] of [['Name', 'Local vLLM'], ['API key', 'sk-test']] as const) {
      const field = tree.root.findAll(n => typeof n.props.onChangeText === 'function' && n.props.accessibilityLabel === label);
      await act(async () => {
        field[field.length - 1].props.onChangeText(value);
      });
    }

    // The box itself and the TextInput under it both carry the props; the
    // input is the one whose onChangeText updates the draft.
    const fields = tree.root.findAll(
      n => typeof n.type === 'function' && n.props.accessibilityLabel === 'Model catalog' && typeof n.props.onChangeText === 'function',
    );
    expect(fields.length).toBeGreaterThanOrEqual(1);
    await act(async () => {
      fields[fields.length - 1].props.onChangeText('{"models":[{"slug":"m"}]}');
    });

    mockSeam.createConnection.mockImplementationOnce(() =>
      Promise.resolve({ id: null, error: 'Connected, but no models came back.', needsModelCatalog: true }),
    );
    await act(async () => {
      bar(navigation).unstable_headerRightItems()[0].onPress!();
    });
    await act(async () => {});

    // The catalog stays open with the server's sentence, not a dead end.
    expect(text(tree)).toContain('Paste a model catalog below and try again.');
    expect(navigation.goBack).not.toHaveBeenCalled();

    // And a successful create carries the catalog the user typed.
    await act(async () => {
      bar(navigation).unstable_headerRightItems()[0].onPress!();
    });
    await act(async () => {});
    expect(mockSeam.createConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({ modelCatalogJson: '{"models":[{"slug":"m"}]}' }),
    );
    expect(navigation.goBack).toHaveBeenCalled();
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
