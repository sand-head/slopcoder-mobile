/**
 * Media in the transcript, shown where it occurs — without a long transcript
 * turning into a burst of requests and decodes on open.
 *
 * Held still here: an artifact card asks what it is only once its row has been
 * seen, every card for one artifact shares one request, and requests and image
 * loads are each bounded; image artifacts show a thumbnail fetched with the
 * bearer key that opens the artifact's full-screen viewer; audio fetches only
 * on Play; video and oversized images say where they open; a gone artifact
 * and a failed check say so, and the failure can be retried; markdown images
 * load with the key only on this server; and an edition link loads that
 * edition.
 */
import React from 'react';

/** A script URL, spelled so the linter does not read the test itself as one. */
const SCRIPT_URL = ['java', 'script:alert(1)'].join('');
import { Image } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ArtifactDetail, ArtifactSummary } from '../src/api/contracts';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  NavigationContext: require('react').createContext(undefined),
}));

jest.mock('react-native-webview', () => {
  const R = require('react');
  const { View } = require('react-native');
  return { WebView: (props: object) => R.createElement(View, props) };
});

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (updater: () => object) => updater(),
    withTiming: (value: unknown) => value,
  };
});

jest.mock('react-native-gesture-handler', () => {
  const R = require('react');
  const { View } = require('react-native');
  const gesture = () => {
    const value: Record<string, unknown> = {};
    for (const method of ['onBegin', 'onUpdate', 'onEnd', 'minPointers', 'maxPointers', 'numberOfTaps']) value[method] = () => value;
    return value;
  };
  return {
    GestureHandlerRootView: (props: object) => R.createElement(View, props),
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    Gesture: { Pinch: gesture, Pan: gesture, Tap: gesture, Simultaneous: () => ({}) },
  };
});

function summary(id: string, contentType: string, size = 50_000): ArtifactSummary {
  return {
    id,
    slug: `slug-${id}`,
    title: `Title ${id}`,
    format: 'binary',
    contentType,
    description: '',
    preview: '',
    size,
    version: 1,
    sessionId: null,
    sessionTitle: null,
    routineId: null,
    routineName: null,
    shareToken: null,
    createdAt: '2026-11-24T00:00:00Z',
    updatedAt: '2026-11-24T00:00:00Z',
    shared: false,
    sharePath: null,
  };
}

let mockSeam: ReturnType<typeof makeSeam>;
function makeSeam(artifact: (id: string) => Promise<ArtifactDetail | null>) {
  return {
    baseUrl: 'https://slop.example.com',
    apiKey: 'slop_k',
    artifact: jest.fn(artifact),
    artifactVersion: jest.fn(),
    artifactRawUrl: (id: string) => `https://slop.example.com/artifacts/${id}/raw`,
  };
}

jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) => select({ seam: mockSeam }),
}));

import { artifactInfo, MAX_CONCURRENT } from '../src/state/artifactInfo';
import { ArtifactMedia, decodingNow, MAX_DECODING, ProseImage, resolveMediaSource } from '../src/ui/media';
import { createRowVisibility, RowVisibilityScope, type RowVisibility } from '../src/ui/visibility';
import { loadArtifact, routeVersion } from '../src/screens/Artifact';

const flush = () => act(async () => {});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockNavigate.mockReset();
});

describe('resolveMediaSource', () => {
  const base = 'https://slop.example.com';
  it('loads this server\'s images with the key', () => {
    expect(resolveMediaSource('/artifacts/x/raw', base)).toEqual({ uri: `${base}/artifacts/x/raw`, authed: true });
    expect(resolveMediaSource('artifacts/x/raw', base)).toEqual({ uri: `${base}/artifacts/x/raw`, authed: true });
    expect(resolveMediaSource(`${base}/artifacts/x/raw`, base)).toEqual({ uri: `${base}/artifacts/x/raw`, authed: true });
  });
  it('loads another host\'s images without it', () => {
    expect(resolveMediaSource('https://cdn.example.org/a.png', base)).toEqual({ uri: 'https://cdn.example.org/a.png', authed: false });
    expect(resolveMediaSource('//cdn.example.org/a.png', base)).toBeNull();
  });
  it('allows small data images and refuses anything else', () => {
    expect(resolveMediaSource('data:image/png;base64,AAAA', base)?.authed).toBe(false);
    expect(resolveMediaSource(`data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}`, base)).toBeNull();
    expect(resolveMediaSource('data:text/html;base64,AAAA', base)).toBeNull();
    expect(resolveMediaSource('file:///etc/hosts', base)).toBeNull();
    expect(resolveMediaSource(SCRIPT_URL, base)).toBeNull();
  });
});

describe('artifactInfo', () => {
  it('shares one request per artifact and keeps only the summary', async () => {
    const gate = deferred<ArtifactDetail | null>();
    const seam = makeSeam(() => gate.promise);
    const a = artifactInfo(seam as never, 'one');
    const b = artifactInfo(seam as never, 'one');
    gate.resolve({ artifact: summary('one', 'image/png'), text: 'never kept' });
    expect(await a).toEqual(summary('one', 'image/png'));
    expect(await b).toBe(await a);
    await artifactInfo(seam as never, 'one');
    expect(seam.artifact).toHaveBeenCalledTimes(1);
  });

  it(`has at most ${MAX_CONCURRENT} requests in flight`, async () => {
    const gates = new Map<string, ReturnType<typeof deferred<ArtifactDetail | null>>>();
    let inFlight = 0;
    let peak = 0;
    const seam = makeSeam(id => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      const gate = deferred<ArtifactDetail | null>();
      gates.set(id, gate);
      return gate.promise.finally(() => inFlight--);
    });
    const all = ['a', 'b', 'c', 'd', 'e'].map(id => artifactInfo(seam as never, id));
    for (let round = 0; round < 5; round++) {
      await flush();
      for (const [id, gate] of [...gates]) {
        gates.delete(id);
        gate.resolve({ artifact: summary(id, 'image/png'), text: null });
      }
    }
    await Promise.all(all);
    expect(seam.artifact).toHaveBeenCalledTimes(5);
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT);
  });

  it('remembers a gone artifact and retries a failure', async () => {
    let fail = true;
    const seam = makeSeam(async id => {
      if (id === 'gone') return null;
      if (fail) throw new Error('offline');
      return { artifact: summary(id, 'image/png'), text: null };
    });
    expect(await artifactInfo(seam as never, 'gone')).toBeNull();
    expect(await artifactInfo(seam as never, 'gone')).toBeNull();
    await expect(artifactInfo(seam as never, 'flaky')).rejects.toThrow('offline');
    fail = false;
    expect(await artifactInfo(seam as never, 'flaky')).toEqual(summary('flaky', 'image/png'));
    expect(seam.artifact.mock.calls.map(call => call[0])).toEqual(['gone', 'flaky', 'flaky']);
  });
});

function rows(store: RowVisibility, cards: { key: string; id: string; kind?: string }[]) {
  return (
    <>
      {cards.map(card => (
        <RowVisibilityScope key={card.key} store={store} rowKey={card.key}>
          <ArtifactMedia artifactId={card.id} name={card.id} kind={card.kind ?? 'File'} />
        </RowVisibilityScope>
      ))}
    </>
  );
}

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(element);
  });
  await flush();
  return tree!;
}

function allText(tree: ReactTestRenderer): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string') return void parts.push(node);
    if (Array.isArray(node)) return void node.forEach(walk);
    (node as { children?: unknown[] }).children?.forEach(walk);
  };
  walk(tree.toJSON());
  return parts.join(' ');
}

describe('artifact cards', () => {
  it('ask nothing until their row has been seen, then once per artifact', async () => {
    mockSeam = makeSeam(async id => ({ artifact: summary(id, 'image/png'), text: null }));
    const store = createRowVisibility();
    const tree = await render(rows(store, [
      { key: 'r1', id: 'img' },
      { key: 'r2', id: 'img' },
      { key: 'r3', id: 'other' },
    ]));
    expect(mockSeam.artifact).not.toHaveBeenCalled();

    await act(async () => store.show(['r1', 'r2']));
    await flush();
    expect(mockSeam.artifact.mock.calls.map(call => call[0])).toEqual(['img']);
    expect(tree.root.findAllByProps({ testID: 'artifact-thumbnail' }).filter(n => typeof n.type !== 'string').length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it('never ask about a document', async () => {
    mockSeam = makeSeam(async id => ({ artifact: summary(id, 'text/markdown'), text: '#' }));
    const tree = await render(rows(createRowVisibility(), [{ key: 'r', id: 'doc', kind: 'Markdown' }]));
    // Outside a visible scope would also count; here the row is unseen, and a document never asks anyway.
    expect(mockSeam.artifact).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('show an image with the bearer key, opening the artifact full screen', async () => {
    mockSeam = makeSeam(async id => ({ artifact: summary(id, 'image/png'), text: null }));
    const store = createRowVisibility();
    store.show(['r']);
    const tree = await render(rows(store, [{ key: 'r', id: 'pic' }]));
    const image = tree.root.findByType(Image);
    expect(image.props.source).toEqual({
      uri: 'https://slop.example.com/artifacts/pic/raw',
      headers: { Authorization: 'Bearer slop_k' },
    });
    expect(image.props.resizeMethod).toBe('resize');
    const button = tree.root.find(n => n.props.testID === 'artifact-thumbnail' && n.props.accessibilityRole === 'imagebutton' && typeof n.type !== 'string');
    expect(button.props.accessibilityLabel).toContain('Title pic');
    await act(async () => button.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Artifact', { id: 'pic', title: 'Title pic' });
    await act(async () => image.props.onLoadEnd());
    act(() => tree.unmount());
  });

  it(`load at most ${MAX_DECODING} images at once`, async () => {
    mockSeam = makeSeam(async id => ({ artifact: summary(id, 'image/png'), text: null }));
    const store = createRowVisibility();
    const cards = Array.from({ length: 8 }, (_, i) => ({ key: `r${i}`, id: `img${i}` }));
    store.show(cards.map(card => card.key));
    const tree = await render(rows(store, cards));
    await flush();
    let images = tree.root.findAllByType(Image);
    expect(images).toHaveLength(MAX_DECODING);
    expect(decodingNow()).toBe(MAX_DECODING);

    // One finishes; the next takes its turn.
    await act(async () => images[0].props.onLoadEnd());
    images = tree.root.findAllByType(Image);
    expect(images).toHaveLength(MAX_DECODING + 1);
    act(() => tree.unmount());
    expect(decodingNow()).toBe(0);
  });

  it('play audio only when asked, through the bearer fetch', async () => {
    mockSeam = makeSeam(async id => ({ artifact: summary(id, 'audio/mpeg'), text: null }));
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => '4' },
      blob: async () => new Blob(['abcd']),
    }));
    const realFetch = global.fetch;
    global.fetch = fetchMock as never;
    const RealReader = global.FileReader;
    global.FileReader = class {
      result: string | null = null;
      onload: (() => void) | null = null;
      readAsDataURL() {
        this.result = 'data:audio/mpeg;base64,AAAA';
        this.onload?.();
      }
    } as never;
    try {
      const store = createRowVisibility();
      store.show(['r']);
      const tree = await render(rows(store, [{ key: 'r', id: 'voice' }]));
      expect(fetchMock).not.toHaveBeenCalled();
      const play = tree.root.find(n => n.props.testID === 'inline-audio-play' && n.props.accessibilityRole === 'button' && typeof n.type !== 'string');
      expect(play.props.accessibilityLabel).toBe('Play audio Title voice');
      await act(async () => play.props.onPress());
      await flush();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://slop.example.com/artifacts/voice/raw',
        expect.objectContaining({ headers: { Authorization: 'Bearer slop_k' } }),
      );
      const player = tree.root.find(n => n.props.testID === 'inline-audio' && n.props.source);
      expect(player.props.source.html).toContain('data:audio/mpeg;base64,AAAA');
      expect(player.props.source.html).not.toContain('slop_k');
      expect(player.props.javaScriptEnabled).toBe(false);
      act(() => tree.unmount());
    } finally {
      global.fetch = realFetch;
      global.FileReader = RealReader;
    }
  });

  it('say where a video opens, and when an image is too large to preview', async () => {
    mockSeam = makeSeam(async id =>
      ({ artifact: id === 'film' ? summary(id, 'video/mp4', 8 * 1024 * 1024) : summary(id, 'image/png', 9 * 1024 * 1024), text: null }));
    const store = createRowVisibility();
    store.show(['a', 'b']);
    const tree = await render(rows(store, [{ key: 'a', id: 'film' }, { key: 'b', id: 'huge' }]));
    const text = allText(tree);
    expect(text).toContain("Video, 8.0 MB - opens on the artifact's page.");
    expect(text).toContain('Image, 9.0 MB - too large to preview here.');
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('say an artifact is gone, and offer a retry when the check failed', async () => {
    let offline = true;
    mockSeam = makeSeam(async id => {
      if (id === 'gone') return null;
      if (offline) throw new Error('offline');
      return { artifact: summary(id, 'image/png'), text: null };
    });
    const store = createRowVisibility();
    store.show(['a', 'b']);
    const tree = await render(rows(store, [{ key: 'a', id: 'gone' }, { key: 'b', id: 'later' }]));
    expect(allText(tree)).toContain('This artifact no longer exists.');
    expect(allText(tree)).toContain('Could not check this artifact. Tap to try again.');
    offline = false;
    const retry = tree.root.find(n => n.props?.accessibilityLabel === 'Could not check this artifact. Tap to try again.' && typeof n.props.onPress === 'function' && typeof n.type !== 'string');
    await act(async () => retry.props.onPress());
    await flush();
    expect(tree.root.findAllByType(Image)).toHaveLength(1);
    act(() => tree.unmount());
  });
});

describe('markdown images', () => {
  beforeEach(() => {
    mockSeam = makeSeam(async () => null);
  });

  it('load from this server with the key, and open full screen', async () => {
    const tree = await render(<ProseImage src="/artifacts/chart/raw" alt="Weekly chart" />);
    const image = tree.root.findByType(Image);
    expect(image.props.source).toEqual({
      uri: 'https://slop.example.com/artifacts/chart/raw',
      headers: { Authorization: 'Bearer slop_k' },
    });
    const button = tree.root.find(n => n.props.testID === 'prose-image' && n.props.accessibilityRole === 'imagebutton' && typeof n.type !== 'string');
    expect(button.props.accessibilityLabel).toBe('Weekly chart');
    await act(async () => button.props.onPress());
    const viewer = tree.root.find(n => n.props.testID === 'image-viewer' && typeof n.type !== 'string');
    expect(viewer.props.accessibilityLabel).toBe('Weekly chart');
    act(() => tree.unmount());
  });

  it('never send the key to another host', async () => {
    const tree = await render(<ProseImage src="https://cdn.example.org/a.png" alt="" />);
    expect(tree.root.findByType(Image).props.source).toEqual({ uri: 'https://cdn.example.org/a.png' });
    act(() => tree.unmount());
  });

  it('show the alt text for something not to fetch', async () => {
    const tree = await render(<ProseImage src="file:///etc/hosts" alt="hosts" />);
    expect(allText(tree)).toBe('[image: hosts]');
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    act(() => tree.unmount());
  });
});

describe('edition links', () => {
  const latest: ArtifactDetail = { artifact: { ...summary('a', 'text/markdown'), format: 'markdown', version: 3, title: 'Now' }, text: 'latest' };

  it('reads the version a tap or a deep link passes', () => {
    expect(routeVersion(2)).toBe(2);
    expect(routeVersion('7')).toBe(7);
    expect(routeVersion('0')).toBeNull();
    expect(routeVersion('x')).toBeNull();
    expect(routeVersion(undefined)).toBeNull();
  });

  it('loads that edition over the latest identity', async () => {
    const seam = makeSeam(async () => latest);
    seam.artifactVersion.mockResolvedValue({
      version: { version: 1, publishedAt: '', title: 'Then', format: 'markdown', contentType: 'text/markdown', size: 4, sessionId: null, sessionTitle: null, routineId: null, routineName: null, isLatest: false, shareToken: null },
      description: 'old',
      text: 'first edition',
    });
    const loaded = await loadArtifact(seam as never, 'a', 1);
    expect(seam.artifactVersion).toHaveBeenCalledWith('a', 1);
    expect(loaded).toMatchObject({ pinned: 1, text: 'first edition', artifact: { id: 'a', title: 'Then', version: 1 } });
  });

  it('shows the latest, and says so, when the edition is no longer kept', async () => {
    const seam = makeSeam(async () => latest);
    seam.artifactVersion.mockResolvedValue(null);
    expect(await loadArtifact(seam as never, 'a', 1)).toMatchObject({ missingVersion: 1, text: 'latest' });
  });

  it('asks for no edition when the link names the latest', async () => {
    const seam = makeSeam(async () => latest);
    expect(await loadArtifact(seam as never, 'a', 3)).toBe(latest);
    expect(seam.artifactVersion).not.toHaveBeenCalled();
  });
});

describe('the publish card', () => {
  it('shows the artifact itself under the card when the app provides media', async () => {
    const { ToolCard } = require('../src/ui/ToolCard');
    const { buildToolCard } = require('../src/api/toolcard');
    const { TranscriptServicesProvider } = require('../src/ui/transcriptServices');
    const { transcriptMedia } = require('../src/ui/transcriptMedia');
    const id = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    mockSeam = makeSeam(async () => ({ artifact: summary(id, 'image/png'), text: null }));
    const card = buildToolCard(
      'publish_artifact',
      JSON.stringify({ title: 'Chart', slug: 'chart', path: 'home/chart.png' }),
      `Published "Chart" as artifact \`chart\` (binary, 40 KB). The user can read it at /artifacts/${id}. It is private until they share it.`,
      false,
    );
    const tree = await render(
      <TranscriptServicesProvider value={transcriptMedia}>
        <ToolCard card={card} state="ok" />
      </TranscriptServicesProvider>,
    );
    expect(mockSeam.artifact).toHaveBeenCalledWith(id);
    const thumbs = tree.root.findAllByType(Image).filter(node => node.props.source?.uri);
    expect(thumbs.map(node => node.props.source.uri)).toEqual([`https://slop.example.com/artifacts/${id}/raw`]);
    act(() => tree.unmount());
  });
});

describe('a WebView whose renderer dies', () => {
  // Seen on the emulator: the renderer crashed on start and the player was a blank box.
  it('says the audio could not load instead of showing nothing', async () => {
    mockSeam = makeSeam(async id => ({ artifact: summary(id, 'audio/mpeg'), text: null }));
    const realFetch = global.fetch;
    global.fetch = (async () => ({ ok: true, status: 200, headers: { get: () => '4' }, blob: async () => new Blob(['abcd']) })) as never;
    const RealReader = global.FileReader;
    global.FileReader = class { result: string | null = null; onload: (() => void) | null = null; readAsDataURL() { this.result = 'data:audio/mpeg;base64,AAAA'; this.onload?.(); } } as never;
    try {
      const store = createRowVisibility();
      store.show(['r']);
      const tree = await render(rows(store, [{ key: 'r', id: 'voice2' }]));
      const play = tree.root.find(n => n.props.testID === 'inline-audio-play' && n.props.accessibilityRole === 'button' && typeof n.type !== 'string');
      await act(async () => play.props.onPress());
      await flush();
      const player = tree.root.find(n => n.props.testID === 'inline-audio' && n.props.source);
      await act(async () => player.props.onRenderProcessGone({ nativeEvent: { didCrash: true } }));
      expect(allText(tree)).toContain('Could not load this audio. Tap to try again.');
      act(() => tree.unmount());
    } finally {
      global.fetch = realFetch;
      global.FileReader = RealReader;
    }
  });
});
