/**
 * The document pages and the hub, mounted — because nothing else here can be.
 *
 * As with the routine editor: these screens only run on a phone after a
 * signed build, so the cheapest check is to mount each against what the
 * server would really send and read what it paints. What this catches is the
 * screen that fails to render at all, or reads a row wrongly.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import type { MemorySummary, UserFacetSummary, UserSkillSummary } from '../src/api/contracts';

const facet: UserFacetSummary = { id: 'f-1', name: 'docs-writer', content: '---\ndescription: docs\n---\nWrite docs.', updatedAt: '2026-09-01T12:00:00Z' };
const skill: UserSkillSummary = { id: 's-1', name: 'monthly-invoices', content: '---\nname: monthly-invoices\ndescription: Total the invoices\n---\nSteps', updatedAt: '2026-09-01T12:00:00Z' };
const pinned: MemorySummary = { id: 'm-1', repoKey: '', name: 'build-quirks', description: 'how the build breaks', content: 'x', pinned: true, updatedAt: '2026-09-01T12:00:00Z' };
const repoEntry: MemorySummary = { ...pinned, id: 'm-2', repoKey: 'git.example/o/r', name: 'deploy', description: '', pinned: false };

const mockSeam = {
  userFacets: jest.fn(() => Promise.resolve([facet])),
  skills: jest.fn(() => Promise.resolve([skill])),
  memories: jest.fn(() => Promise.resolve([repoEntry, pinned])),
  hooks: jest.fn(() => Promise.resolve('{"pre_tool_use":[{},{}]}')),
  permissions: jest.fn(() => Promise.resolve('rules:\n  - action: allow\n')),
  terminalDefaults: jest.fn(() => Promise.resolve({ shell: 'bash', packages: 'git curl' })),
  terminalPrefs: jest.fn(() => Promise.resolve({ shell: 'fish', packages: null })),
  saveTerminalPrefs: jest.fn(() => Promise.resolve()),
  apiKeys: jest.fn(() => Promise.resolve([{ id: 'k-1', name: 'CI', prefix: 'slop_ab12', createdAt: '2026-09-01T12:00:00Z', lastUsedAt: null }])),
  checkFacet: jest.fn(() => Promise.resolve({ name: 'docs-writer', toolsAllowed: 2, toolsDenied: 0, model: null, error: null })),
  saveFacet: jest.fn(() => Promise.resolve()),
  saveSkill: jest.fn(() => Promise.resolve('name must be a slug')),
  saveMemory: jest.fn(() => Promise.resolve()),
  saveHooks: jest.fn(() => Promise.resolve()),
  connections: jest.fn(() => Promise.resolve([{}, {}])),
  gitConnections: jest.fn(() => Promise.resolve([])),
  nodes: jest.fn(() => Promise.resolve([])),
  facets: jest.fn(() => Promise.resolve([{ name: 'execute' }])),
  channels: jest.fn(() => Promise.resolve([])),
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));
jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) =>
    select({ seam: mockSeam, credential: { server: 'https://slop.example.com', userName: 'jess' }, signOut: jest.fn() }),
}));

import { SettingsScreen } from '../src/screens/Settings';
import { FacetsScreen } from '../src/screens/settings/Facets';
import { SkillsScreen } from '../src/screens/settings/Skills';
import { MemoryScreen } from '../src/screens/settings/Memory';
import { HooksScreen } from '../src/screens/settings/Hooks';
import { TerminalScreen } from '../src/screens/settings/Terminal';
import { ApiKeysScreen } from '../src/screens/settings/ApiKeys';
import { DocEditorScreen } from '../src/screens/settings/DocEditor';

function navigator() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    dispatch: jest.fn(),
    setOptions: jest.fn(),
    addListener: () => () => {},
  };
}

async function mount(Screen: React.ComponentType<any>, params: Record<string, unknown> = {}) {
  const navigation = navigator();
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(<Screen route={{ params }} navigation={navigation} />);
  });
  await act(async () => {});
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

function bar(navigation: ReturnType<typeof navigator>) {
  const calls = navigation.setOptions.mock.calls;
  return calls[calls.length - 1][0] as {
    title: string;
    unstable_headerRightItems?: () => { label: string; disabled?: boolean; onPress: () => void }[];
  };
}

describe('the settings hub', () => {
  it('lists every web settings page and lands the counts', async () => {
    const { tree, navigation } = await mount(SettingsScreen);
    const rendered = text(tree);
    for (const label of ['Connections', 'MCP servers', 'Remote nodes', 'Terminal', 'Facets', 'Hooks', 'Memory', 'Skills', 'Channels', 'API keys']) {
      expect(rendered).toContain(label);
    }
    expect(rendered).toContain('jess');
    // Two connections, one facet, no channels.
    expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Connections, 2').length).toBeGreaterThan(0);
    expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Facets, 1').length).toBeGreaterThan(0);

    tree.root.findAll(n => n.props.accessibilityLabel === 'MCP servers')[0].props.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith('McpServers');
  });
});

describe('the document lists', () => {
  it('lists a facet, a skill by its description, and memory grouped with the pin first', async () => {
    const facets = await mount(FacetsScreen);
    expect(text(facets.tree)).toContain('docs-writer');

    const skills = await mount(SkillsScreen);
    expect(text(skills.tree)).toContain('Total the invoices');

    const memory = await mount(MemoryScreen);
    const rendered = text(memory.tree);
    expect(rendered.indexOf('User memory')).toBeLessThan(rendered.indexOf('git.example/o/r'));
    expect(rendered).toContain('pinned');

    memory.tree.root.findAll(n => n.props.accessibilityLabel === 'build-quirks, how the build breaks')[0].props.onPress();
    expect(memory.navigation.navigate).toHaveBeenCalledWith('DocEditor', { kind: 'memory', entry: pinned });
  });

  it('says on the hooks page what each document holds', async () => {
    const { tree } = await mount(HooksScreen);
    const rendered = text(tree);
    expect(rendered).toContain('valid JSON with 2 handlers');
    expect(rendered).toContain('2 lines');
  });
});

describe('the document editor', () => {
  it('validates a facet through the server before saving it', async () => {
    const { tree, navigation } = await mount(DocEditorScreen, { kind: 'facet', entry: facet });
    expect(bar(navigation).title).toBe('Edit ‘docs-writer’');
    await act(async () => {
      bar(navigation).unstable_headerRightItems!()[0].onPress();
    });
    await act(async () => {});
    expect(mockSeam.checkFacet).toHaveBeenCalledWith('docs-writer', facet.content);
    expect(mockSeam.saveFacet).toHaveBeenCalledWith('docs-writer', facet.content);
    expect(text(tree)).toContain('allows 2 tools');
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('shows a skill the server refuses, in place, and stays', async () => {
    const { tree, navigation } = await mount(DocEditorScreen, { kind: 'skill', entry: skill });
    await act(async () => {
      bar(navigation).unstable_headerRightItems!()[0].onPress();
    });
    await act(async () => {});
    expect(text(tree)).toContain('name must be a slug');
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('reads the hooks document when opened and refuses to save broken JSON', async () => {
    const { tree, navigation } = await mount(DocEditorScreen, { kind: 'hooks' });
    expect(bar(navigation).title).toBe('Hooks');
    const box = tree.root.find(n => n.props.accessibilityLabel === 'Content' && n.props.value !== undefined);
    expect(box.props.value).toBe('{"pre_tool_use":[{},{}]}');
    await act(async () => {
      box.props.onChangeText('{');
    });
    await act(async () => {
      bar(navigation).unstable_headerRightItems!()[0].onPress();
    });
    await act(async () => {});
    expect(mockSeam.saveHooks).not.toHaveBeenCalled();
    expect(text(tree)).toContain('Invalid JSON');
  });

  it('starts a new entry with Save disabled until it has a name and a body', async () => {
    const { navigation } = await mount(DocEditorScreen, { kind: 'memory' });
    expect(bar(navigation).title).toBe('New entry');
    expect(bar(navigation).unstable_headerRightItems!()[0].disabled).toBe(true);
  });
});

describe('terminal and api keys', () => {
  it('shows the stored shell with the instance default as the placeholder, and saves', async () => {
    const { tree, navigation } = await mount(TerminalScreen);
    const shell = tree.root.find(n => n.props.accessibilityLabel === 'preferred shell' && n.props.value !== undefined);
    expect(shell.props.value).toBe('fish');
    expect(shell.props.placeholder).toBe('bash');
    expect(bar(navigation).unstable_headerRightItems!()[0].disabled).toBe(true);
    await act(async () => {
      shell.props.onChangeText('zsh');
    });
    await act(async () => {
      bar(navigation).unstable_headerRightItems!()[0].onPress();
    });
    await act(async () => {});
    expect(mockSeam.saveTerminalPrefs).toHaveBeenCalledWith('', 'zsh');
    expect(text(tree)).toContain('saved');
  });

  it('lists a key by its prefix and never its value', async () => {
    const { tree } = await mount(ApiKeysScreen);
    const rendered = text(tree);
    expect(rendered).toContain('slop_ab12…');
    expect(rendered).toContain('last used never');
    expect(rendered).toContain('Show pairing code');
  });
});
