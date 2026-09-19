/**
 * The artifact screens, mounted — because nothing else here can be.
 *
 * Three things are worth holding still. The list has to say what an artifact
 * *is* without opening it; it has to *show* it, which is the whole point of a
 * card and the one part of it a screenshot would catch and a diff would not;
 * and the detail screen has to be honest about the share switch in both states,
 * because an "Unlisted link" row that only explains itself once it is already
 * on is a switch people flip to find out what it does.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ArtifactDetail, ArtifactSummary } from '../src/api/contracts';

const report: ArtifactSummary = {
  id: 'a-1',
  slug: 'battery-landscape',
  title: 'Battery chemistry landscape',
  format: 'markdown',
  contentType: 'text/markdown; charset=utf-8',
  description: 'Where sodium-ion actually stands.',
  preview: '# Findings\n\nSodium-ion is shipping in grid storage, and the cell makers know it.',
  size: 4096,
  version: 3,
  sessionId: 's-1',
  sessionTitle: 'Battery research',
  routineId: null,
  routineName: null,
  shareToken: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-17T09:00:00Z',
  shared: false,
  sharePath: null,
};

const log: ArtifactSummary = {
  ...report,
  id: 'a-2',
  slug: 'overnight-build-log',
  title: 'Overnight build log',
  format: 'text',
  contentType: 'text/plain; charset=utf-8',
  description: '',
  preview: '04:12  build started\n04:19  bundle written',
  size: 700,
  version: 1,
  routineId: 'r-1',
  routineName: 'Morning digest',
  shareToken: 'tok',
  shared: true,
  sharePath: 'a/tok',
};

const detail: ArtifactDetail = { artifact: report, text: '# Findings\n\nShipping in grid storage.' };

const mockSeam = {
  baseUrl: 'https://slop.example.com',
  apiKey: 'slop_k',
  artifacts: jest.fn(() => Promise.resolve([report, log])),
  artifact: jest.fn(() => Promise.resolve(detail)),
  shareArtifact: jest.fn(() => Promise.resolve({ ...report, shareToken: 'fresh', shared: true, sharePath: 'a/fresh' })),
  deleteArtifact: jest.fn(() => Promise.resolve(true)),
  artifactRawUrl: (id: string) => `https://slop.example.com/artifacts/${id}/raw`,
  shareUrl: (path: string) => `https://slop.example.com/${path}`,
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));

jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) =>
    select({ seam: mockSeam, credential: { server: 'https://slop.example.com' } }),
}));

import { ArtifactsScreen } from '../src/screens/Artifacts';
import { ArtifactScreen } from '../src/screens/Artifact';

function navigator() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
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

describe('the artifacts list', () => {
  it('says what each one is without opening it', async () => {
    const { tree } = await mount(navigation => <ArtifactsScreen navigation={navigation} />);
    const shown = text(tree);

    expect(shown).toContain('Battery chemistry landscape');
    expect(shown).toContain('markdown · 4 KB · v3');
    // A version of 1 is the ordinary case and says nothing.
    expect(shown).toContain('text · 700 B ·');
    expect(shown).toContain('shared');
  });

  /**
   * The card's whole reason to exist. A preview that renders as its source, or
   * not at all, leaves a page of grey boxes that a passing screenshot would
   * catch and nothing else would.
   */
  it('shows the opening of each document, rendered', async () => {
    const { tree } = await mount(navigation => <ArtifactsScreen navigation={navigation} />);
    const shown = text(tree);

    expect(shown).toContain('Sodium-ion is shipping in grid storage');
    // Rendered, not printed: the hash belongs to the source.
    expect(shown).not.toContain('# Findings');
    // A format that is read as text keeps its own shape.
    expect(shown).toContain('04:12  build started');
  });

  it('draws the format when there is nothing to read', async () => {
    mockSeam.artifacts.mockResolvedValueOnce([
      { ...report, id: 'a-3', title: 'Chart', format: 'binary', preview: '', size: 21000 },
    ]);

    const { tree } = await mount(navigation => <ArtifactsScreen navigation={navigation} />);

    expect(text(tree)).toContain('binary');
  });

  it('opens one by id, so the screen can load it fresh', async () => {
    const { tree, navigation } = await mount(nav => <ArtifactsScreen navigation={nav} />);
    const row = tree.root.findAll(n => n.props?.accessibilityLabel?.startsWith?.('Battery chemistry landscape'))[0];

    await act(async () => row.props.onPress());

    expect(navigation.navigate).toHaveBeenCalledWith('Artifact', { id: 'a-1', title: 'Battery chemistry landscape' });
  });
});

describe('one artifact', () => {
  it('explains the unlisted link while it is still off', async () => {
    const { tree } = await mount(navigation => (
      <ArtifactScreen navigation={navigation} route={{ params: { id: 'a-1' } }} />
    ));

    expect(text(tree)).toContain('off — the artifact is visible only to you');
    expect(text(tree)).not.toContain('slop.example.com/a/');
  });

  it('shows the link the moment it is minted', async () => {
    const { tree } = await mount(navigation => (
      <ArtifactScreen navigation={navigation} route={{ params: { id: 'a-1' } }} />
    ));
    const toggle = tree.root.findAll(n => n.props?.accessibilityLabel === 'Unlisted link')[0];

    await act(async () => toggle.props.onValueChange(true));

    expect(mockSeam.shareArtifact).toHaveBeenCalledWith('a-1', true);
    expect(text(tree)).toContain('https://slop.example.com/a/fresh');
    expect(text(tree)).toContain('anyone with the link can read it');
  });

  it('renders a report as prose rather than as its source', async () => {
    const { tree } = await mount(navigation => (
      <ArtifactScreen navigation={navigation} route={{ params: { id: 'a-1' } }} />
    ));

    expect(text(tree)).toContain('Findings');
    expect(text(tree)).not.toContain('# Findings');
  });
});
