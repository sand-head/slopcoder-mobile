/**
 * The MCP and node screens, mounted — because nothing else here can be.
 *
 * These only ever run on a phone after a signed build, so the cheapest check
 * is to mount each against rows the server could really send and prove the
 * list paints what the row says, and the editor refuses what the web's form
 * refuses, before anything reaches the seam.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import {
  McpTransportKind,
  NodeKeyKind,
  type McpServerSummary,
  type RemoteNodeSummary,
} from '../src/api/contracts';

const stdio: McpServerSummary = {
  id: 'm-1',
  displayName: 'files',
  kind: McpTransportKind.Stdio,
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
  url: null,
  hasSecrets: true,
  enabled: true,
  createdAt: '2026-09-01T00:00:00Z',
};

const http: McpServerSummary = {
  id: 'm-2',
  displayName: 'remote',
  kind: McpTransportKind.Http,
  command: '',
  args: [],
  url: 'https://mcp.example.com/sse',
  hasSecrets: false,
  enabled: false,
  createdAt: '2026-09-01T00:00:00Z',
};

const pi: RemoteNodeSummary = {
  id: 'n-1',
  name: 'pi-media',
  host: '192.168.1.20',
  port: 22,
  username: 'pi',
  keyKind: NodeKeyKind.Generated,
  publicKey: 'ssh-ed25519 AAAA pi-media',
  hostKeyFingerprint: null,
  enabled: true,
  lastConnectedAt: null,
  lastError: null,
  createdAt: '2026-09-01T00:00:00Z',
};

const mockSeam = {
  mcpServers: jest.fn(() => Promise.resolve([stdio, http])),
  updateMcpServer: jest.fn(() => Promise.resolve(null)),
  createMcpServer: jest.fn(() => Promise.resolve({ id: 'm-3', error: null })),
  nodes: jest.fn(() => Promise.resolve([pi])),
  createNode: jest.fn(() => Promise.resolve({ id: 'n-2', error: null, authorizedKeysLine: 'ssh-ed25519 BBBB' })),
  updateNode: jest.fn(() => Promise.resolve(null)),
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));

jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) =>
    select({ seam: mockSeam, credential: { server: 'https://slop.example.com' } }),
}));

import { McpServersScreen } from '../src/screens/settings/McpServers';
import { McpServerEditorScreen } from '../src/screens/settings/McpServerEditor';
import { RemoteNodesScreen } from '../src/screens/settings/RemoteNodes';
import { NodeEditorScreen } from '../src/screens/settings/NodeEditor';

function navigator() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    dispatch: jest.fn(),
    setOptions: jest.fn(),
    setParams: jest.fn(),
    addListener: () => () => {},
  };
}

async function mount(element: (navigation: ReturnType<typeof navigator>) => React.ReactElement) {
  const navigation = navigator();
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(element(navigation));
  });
  await act(async () => {});
  return { tree: tree!, navigation };
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
    unstable_headerRightItems: () => { label: string; disabled?: boolean; onPress: () => void }[];
    unstable_headerLeftItems: () => { label: string }[];
  };
}

function typeInto(tree: ReturnType<typeof create>, label: string, value: string) {
  const field = tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function')[0];
  act(() => field.props.onChangeText(value));
}

describe('the MCP servers list', () => {
  it("paints a stdio server's command line and an HTTP server's URL", async () => {
    const { tree } = await mount(navigation => <McpServersScreen navigation={navigation} />);
    const rendered = text(tree);
    expect(rendered).toContain('npx -y @modelcontextprotocol/server-filesystem /workspace');
    expect(rendered).toContain('https://mcp.example.com/sse');
    expect(rendered).toContain('servers · 2');
  });
});

describe('the MCP server editor', () => {
  beforeEach(() => mockSeam.updateMcpServer.mockClear());

  it('opens a stored server with its name filled and offers Save changes', async () => {
    const { tree, navigation } = await mount(nav => (
      <McpServerEditorScreen route={{ params: { server: stdio } }} navigation={nav} />
    ));
    expect(bar(navigation).title).toBe('Edit "files"');
    expect(bar(navigation).unstable_headerRightItems()[0]).toMatchObject({ label: 'Save changes', disabled: false });
    expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Name' && n.props.value === 'files').length).toBeGreaterThan(0);
    // A server with stored secrets offers to clear them.
    expect(text(tree)).toContain('Clear stored values');
  });

  it('refuses a secrets line that is not KEY=value before anything reaches the seam', async () => {
    const { tree, navigation } = await mount(nav => (
      <McpServerEditorScreen route={{ params: { server: stdio } }} navigation={nav} />
    ));
    typeInto(tree, 'Secrets', 'NOTAPAIR');
    await act(async () => {
      bar(navigation).unstable_headerRightItems()[0].onPress();
    });
    expect(text(tree)).toContain('"NOTAPAIR" isn\'t KEY=value.');
    expect(mockSeam.updateMcpServer).not.toHaveBeenCalled();
  });
});

describe('the remote nodes list', () => {
  it('paints the target and the pin state', async () => {
    const { tree } = await mount(navigation => <RemoteNodesScreen route={{ params: {} }} navigation={navigation} />);
    const rendered = text(tree);
    expect(rendered).toContain('pi@192.168.1.20');
    expect(rendered).toContain('unpinned');
    expect(rendered).toContain('seen never');
  });
});

describe('the node editor', () => {
  beforeEach(() => mockSeam.createNode.mockClear());

  it('refuses to register with a pasted key that was never pasted', async () => {
    const { tree, navigation } = await mount(nav => (
      <NodeEditorScreen route={{ params: {} }} navigation={nav} />
    ));
    expect(bar(navigation).title).toBe('Register a node');
    typeInto(tree, 'Name', 'pi-media');
    typeInto(tree, 'Host', '192.168.1.20');
    typeInto(tree, 'Username', 'pi');
    // Choose "paste" on the segment control: the label's nearest pressable
    // ancestor is the segment.
    let segment = tree.root.findAll(n => n.children.includes('Paste a private key'))[0];
    while (segment && typeof segment.props.onPress !== 'function') segment = segment.parent!;
    act(() => segment.props.onPress());
    await act(async () => {
      bar(navigation).unstable_headerRightItems()[0].onPress();
    });
    expect(text(tree)).toContain('Paste the private key, or switch to a generated one.');
    expect(mockSeam.createNode).not.toHaveBeenCalled();
  });
});
