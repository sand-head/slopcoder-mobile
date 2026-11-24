/**
 * The artifact screens, mounted — because nothing else here can be.
 *
 * Three things are worth holding still. The list has to say what an artifact
 * *is* without opening it; it has to *show* it, which is the whole point of a
 * card and the one part of it a screenshot would catch and a diff would not;
 * and the detail screen has to lead with the artifact itself. Metadata and the
 * sharing controls belong in its native menu, not in a pile of rows before the
 * content. HTML must use its sandboxed view, and a photo must be zoomable.
 */
import React from 'react';
import { Image, Linking, Platform, Share } from 'react-native';
import { act, create } from 'react-test-renderer';
import { createOnShouldStartLoadWithRequest } from 'react-native-webview/lib/WebViewShared';
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
  artifactViewUrl: (id: string) => `https://slop.example.com/artifacts/${id}/view`,
  shareUrl: (path: string) => `https://slop.example.com/${path}`,
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { WebView: (props: object) => React.createElement(View, props) };
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
  const React = require('react');
  const { View } = require('react-native');
  const gesture = (type: string) => {
    const value: Record<string, unknown> = { type };
    for (const method of ['onBegin', 'onUpdate', 'onEnd', 'minPointers', 'maxPointers', 'numberOfTaps']) {
      value[method] = () => value;
    }
    return value;
  };
  return {
    GestureHandlerRootView: (props: object) => React.createElement(View, props),
    GestureDetector: ({ children, gesture: value }: { children: React.ReactNode; gesture: object }) =>
      React.createElement(View, { testID: 'mock-gestures', gesture: value }, children),
    Gesture: {
      Pinch: () => gesture('pinch'),
      Pan: () => gesture('pan'),
      Tap: () => gesture('tap'),
      Simultaneous: (...gestures: object[]) => ({ type: 'simultaneous', gestures }),
    },
  };
});

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

type HeaderAction = { key: string; label: string; onPress: () => void };

function headerActions(navigation: ReturnType<typeof navigator>): HeaderAction[] {
  const options = navigation.setOptions.mock.calls
    .map(call => call[0])
    .filter(option => typeof option.unstable_headerRightItems === 'function')
    .at(-1) as any;
  return options.unstable_headerRightItems()[0].menu.items;
}

describe('one artifact', () => {
  // A link to a deleted artifact used to leave the loading skeleton up for good:
  // the seam answers a 404 as null, which read as "not loaded yet".
  it('says so when the artifact is gone, instead of loading forever', async () => {
    mockSeam.artifact.mockResolvedValueOnce(null as never);
    const { tree } = await mount(navigation => (
      <ArtifactScreen navigation={navigation} route={{ params: { id: 'gone' } }} />
    ));
    expect(text(tree)).toContain('This artifact no longer exists, or is not yours.');
  });

  it('opens the document itself, with metadata and actions out of the body', async () => {
    const { tree, navigation } = await mount(nav => (
      <ArtifactScreen navigation={nav} route={{ params: { id: 'a-1' } }} />
    ));
    const shown = text(tree);

    expect(shown).toContain('Findings');
    expect(shown).not.toContain('# Findings');
    expect(shown).not.toContain('Where sodium-ion actually stands.');
    expect(shown).not.toContain('battery-landscape');
    expect(headerActions(navigation).map(item => item.label)).toEqual(['Share…', 'Details', 'Delete']);
  });

  it('mints an unlisted link and presents the share sheet from the menu', async () => {
    const shareSheet = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    const { navigation } = await mount(nav => (
      <ArtifactScreen navigation={nav} route={{ params: { id: 'a-1' } }} />
    ));

    await act(async () => headerActions(navigation).find(item => item.label === 'Share…')!.onPress());

    expect(mockSeam.shareArtifact).toHaveBeenCalledWith('a-1', true);
    expect(shareSheet).toHaveBeenCalledWith({
      message: 'https://slop.example.com/a/fresh',
      url: 'https://slop.example.com/a/fresh',
    });
    expect(headerActions(navigation).map(item => item.label)).toContain('Stop sharing');
  });

  it('can revoke a shared artifact without putting a switch over its content', async () => {
    mockSeam.artifact.mockResolvedValueOnce({ artifact: log, text: '04:12  build started' });
    const { navigation } = await mount(nav => (
      <ArtifactScreen navigation={nav} route={{ params: { id: 'a-2' } }} />
    ));

    await act(async () => headerActions(navigation).find(item => item.label === 'Stop sharing')!.onPress());

    expect(mockSeam.shareArtifact).toHaveBeenCalledWith('a-2', false);
  });

  it('runs HTML from its sandboxed owner route, never as printed source', async () => {
    mockSeam.artifact.mockResolvedValueOnce({
      artifact: { ...report, title: 'Revenue dashboard', format: 'html' },
      text: '<!doctype html><button>Quarter</button><script>runDashboard()</script>',
    });
    const { tree } = await mount(nav => (
      <ArtifactScreen navigation={nav} route={{ params: { id: 'a-1' } }} />
    ));

    const webview = tree.root.findAllByProps({ testID: 'artifact-webview' })[0];
    expect(webview.props.source).toEqual({
      uri: 'https://slop.example.com/artifacts/a-1/view',
      headers: { Authorization: 'Bearer slop_k' },
    });
    expect(webview.props.javaScriptEnabled).toBe(true);
    expect(webview.props.incognito).toBe(true);
    expect(webview.props.sharedCookiesEnabled).toBe(false);
    expect(webview.props.allowFileAccess).toBe(false);
    expect(webview.props.setSupportMultipleWindows).toBe(true);
    expect(webview.props.javaScriptCanOpenWindowsAutomatically).toBe(false);
    expect(text(tree)).not.toContain('runDashboard()');
  });

  it('opens only deliberate top-frame external links, without the device key', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    mockSeam.artifact.mockResolvedValueOnce({
      artifact: { ...report, format: 'html' },
      text: '<a href="https://example.com/source">source</a>',
    });
    const { tree } = await mount(nav => (
      <ArtifactScreen navigation={nav} route={{ params: { id: 'a-1' } }} />
    ));
    const webview = tree.root.findAllByProps({ testID: 'artifact-webview' })[0];
    const own = 'https://slop.example.com/artifacts/a-1/view';
    const request = (url: string, extra: object = {}) => ({
      url,
      isTopFrame: true,
      navigationType: 'other',
      ...extra,
    });

    expect(webview.props.onShouldStartLoadWithRequest(request(own))).toBe(true);
    expect(webview.props.onShouldStartLoadWithRequest(request(`${own}#quarter`))).toBe(true);
    // On iOS a programmatic redirect and an iframe are not a link the user tapped.
    expect(webview.props.onShouldStartLoadWithRequest(request('https://example.com/redirect'))).toBe(false);
    expect(webview.props.onShouldStartLoadWithRequest(
      request('https://example.com/frame', { isTopFrame: false, navigationType: 'click' }),
    )).toBe(false);
    expect(openURL).not.toHaveBeenCalled();

    expect(webview.props.onShouldStartLoadWithRequest(
      request('https://example.com/source', { navigationType: 'click' }),
    )).toBe(false);
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenLastCalledWith('https://example.com/source');

    // Android's native new-window event covers target=_blank/window.open.
    webview.props.onOpenWindow({ nativeEvent: { targetUrl: 'https://example.com/window' } });
    expect(openURL).toHaveBeenCalledTimes(2);
    expect(openURL).toHaveBeenLastCalledWith('https://example.com/window');

    // Android needs WebResourceRequest.hasGesture(), not navigationType.
    const platform = Object.getOwnPropertyDescriptor(Platform, 'OS');
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    try {
      expect(webview.props.onShouldStartLoadWithRequest(request('https://example.com/script'))).toBe(false);
      expect(webview.props.onShouldStartLoadWithRequest(
        request('https://example.com/no-gesture', { hasGesture: false }),
      )).toBe(false);
      expect(openURL).toHaveBeenCalledTimes(2);
      expect(webview.props.onShouldStartLoadWithRequest(
        request('https://example.com/tapped', { hasGesture: true }),
      )).toBe(false);
      expect(openURL).toHaveBeenCalledTimes(3);
      expect(openURL).toHaveBeenLastCalledWith('https://example.com/tapped');
    } finally {
      if (platform) Object.defineProperty(Platform, 'OS', platform);
    }

    // Exercise the library's real wrapper: '*' keeps non-http schemes away
    // from its built-in Linking fallback, so our callback is the whole policy.
    const loadRequest = jest.fn();
    const wrapped = createOnShouldStartLoadWithRequest(
      loadRequest,
      webview.props.originWhitelist,
      webview.props.onShouldStartLoadWithRequest,
    );
    wrapped({ nativeEvent: { ...request('file:///private/passwd', { navigationType: 'click' }), lockIdentifier: 7 } } as any);
    expect(loadRequest).toHaveBeenCalledWith(false, 'file:///private/passwd', 7);
    expect(openURL).toHaveBeenCalledTimes(3);
    expect(openURL).not.toHaveBeenCalledWith('file:///private/passwd');
  });

  it('plays a private audio artifact through an authenticated bounded fetch', async () => {
    const originalFileReader = (global as any).FileReader;
    (global as any).FileReader = class {
      result = 'data:audio/mpeg;base64,AAAA';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      readAsDataURL() { this.onload?.(); }
    };
    const fetchAudio = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: { get: () => '4' },
      blob: async () => new Blob(['audio']),
    } as unknown as Response);
    mockSeam.artifact.mockResolvedValueOnce({
      artifact: {
        ...report,
        title: 'Field recording',
        format: 'binary',
        contentType: 'audio/mpeg; charset=binary',
        preview: '',
      },
      text: null,
    });
    const { tree } = await mount(nav => (
      <ArtifactScreen navigation={nav} route={{ params: { id: 'a-1' } }} />
    ));

    const audio = tree.root.findByProps({ testID: 'artifact-audio' });
    expect(fetchAudio).toHaveBeenCalledWith(
      'https://slop.example.com/artifacts/a-1/raw',
      expect.objectContaining({ headers: { Authorization: 'Bearer slop_k' }, signal: expect.any(AbortSignal) }),
    );
    expect(audio.props.source.html).toContain('data:audio/mpeg;base64,');
    expect(audio.props.source.html).not.toContain('slop_k');
    expect(audio.props.javaScriptEnabled).toBe(false);
    expect(audio.props.mediaPlaybackRequiresUserAction).toBe(true);
    expect(audio.props.onShouldStartLoadWithRequest({ url: 'data:text/html,escape' })).toBe(false);
    expect(audio.props.onShouldStartLoadWithRequest({ url: 'about:blank' })).toBe(true);
    fetchAudio.mockRestore();
    (global as any).FileReader = originalFileReader;
  });

  it('opens a private photo full-screen with zoom and pan gestures', async () => {
    mockSeam.artifact.mockResolvedValueOnce({
      artifact: { ...report, title: 'Factory floor', format: 'binary', contentType: 'image/png', preview: '' },
      text: null,
    });
    const { tree } = await mount(nav => (
      <ArtifactScreen navigation={nav} route={{ params: { id: 'a-1' } }} />
    ));

    const image = tree.root.findByType(Image);
    expect(image.props.source).toEqual({
      uri: 'https://slop.example.com/artifacts/a-1/raw',
      headers: { Authorization: 'Bearer slop_k' },
    });
    expect(image.props.resizeMode).toBe('contain');
    expect(image.props.style).not.toHaveProperty('aspectRatio');
    expect(tree.root.findAllByProps({ testID: 'artifact-photo' }).length).toBeGreaterThan(0);
    const gestures = tree.root.findAllByProps({ testID: 'mock-gestures' })[0].props.gesture;
    expect(gestures.gestures.map((item: { type: string }) => item.type)).toEqual(['pinch', 'pan', 'tap']);
  });
});
