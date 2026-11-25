/**
 * A picture a tool returned, in its card.
 *
 * Held still here: the card draws the kept image from `/tool-images/{id}`
 * with the device key, under a caption that says what it is; a tap opens it
 * full screen with pinch zoom; a scene render draws from its own route; and a
 * card built without the app's media (a test, a server older than kept images)
 * still says what the picture was rather than nothing.
 */
import React from 'react';
import { Image } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
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

const mockSeam = {
  baseUrl: 'https://slop.example.com',
  apiKey: 'slop_k',
  toolImageUrl: (id: string) => `https://slop.example.com/tool-images/${id}`,
  sceneRenderUrl: (id: string) => `https://slop.example.com/scenes/renders/${id}.png`,
};
jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) => select({ seam: mockSeam }),
}));

import { buildToolCard } from '../src/api/toolcard';
import { ToolCard } from '../src/ui/ToolCard';
import { transcriptMedia } from '../src/ui/transcriptMedia';
import { TranscriptServicesProvider } from '../src/ui/transcriptServices';
import { createRowVisibility, RowVisibilityScope } from '../src/ui/visibility';

const ID = '0199c0de-0000-7000-8000-00000000cafe';

async function render(element: React.ReactElement, media = true): Promise<ReactTestRenderer> {
  const store = createRowVisibility();
  store.show(['row']);
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(
      media ? (
        <TranscriptServicesProvider value={transcriptMedia}>
          <RowVisibilityScope store={store} rowKey="row">
            {element}
          </RowVisibilityScope>
        </TranscriptServicesProvider>
      ) : (
        element
      ),
    );
  });
  await act(async () => {});
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

const readCard = () =>
  buildToolCard('Read', JSON.stringify({ file_path: '/tmp/shot.png' }), '[image: image/png, 182 KB]', false, [
    { id: ID, mediaType: 'image/png', size: 186412 },
  ]);

describe('a kept image', () => {
  it('is drawn open, from its route, with the key', async () => {
    const tree = await render(<ToolCard card={readCard()} state="ok" />);
    const image = tree.root.findByType(Image);
    expect(image.props.source).toEqual({
      uri: `https://slop.example.com/tool-images/${ID}`,
      headers: { Authorization: 'Bearer slop_k' },
    });
    const text = allText(tree);
    expect(text).toContain('image/png · 182 KB');
    // The placeholder sentence is gone: the picture says it.
    expect(text).not.toContain('[image');
    act(() => tree.unmount());
  });

  it('opens full screen on a tap', async () => {
    const tree = await render(<ToolCard card={readCard()} state="ok" />);
    const button = tree.root.find(
      n => n.props.testID === 'tool-image' && n.props.accessibilityRole === 'imagebutton' && typeof n.type !== 'string',
    );
    expect(button.props.accessibilityLabel).toContain('Opens full screen');
    await act(async () => button.props.onPress());
    const viewer = tree.root.find(n => n.props.testID === 'image-viewer' && typeof n.type !== 'string');
    expect(viewer.props.source).toEqual({
      uri: `https://slop.example.com/tool-images/${ID}`,
      headers: { Authorization: 'Bearer slop_k' },
    });
    act(() => tree.unmount());
  });

  it("waits behind the chevron when it is a browser step's side effect", async () => {
    const card = buildToolCard('browser_click', JSON.stringify({ x: 1, y: 2 }), 'Clicked (1, 2).\n[screenshot attached]', false, [
      { id: ID, mediaType: 'image/webp', size: 48213 },
    ]);
    const tree = await render(<ToolCard card={card} state="ok" />);
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('still says what it was without the app media', async () => {
    const tree = await render(<ToolCard card={readCard()} state="ok" />, false);
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(allText(tree)).toContain('image/png · 182 KB');
    act(() => tree.unmount());
  });
});

describe('a scene render', () => {
  it('is drawn from the scene route', async () => {
    const card = buildToolCard(
      'scene_render',
      JSON.stringify({ scene: 'models/table' }),
      'Revision 2 of models/table.\nRender id: 0199C0DE-0000-7000-8000-00000000BEEF',
      false,
    );
    const tree = await render(<ToolCard card={card} state="ok" />);
    expect(tree.root.findByType(Image).props.source.uri).toBe(
      'https://slop.example.com/scenes/renders/0199c0de-0000-7000-8000-00000000beef.png',
    );
    expect(allText(tree)).toContain('models/table · rev 2');
    act(() => tree.unmount());
  });
});

describe('an older server', () => {
  it('reads as the sentence it always sent', () => {
    const card = buildToolCard('read_file', JSON.stringify({ path: 'a.png' }), '[read_file: a.png — image/png, 12 KB]', false);
    expect(card.blocks).toEqual([
      expect.objectContaining({ type: 'text', tone: 'muted', text: expect.stringContaining('(image/png, 12 KB)') }),
    ]);
  });
});
