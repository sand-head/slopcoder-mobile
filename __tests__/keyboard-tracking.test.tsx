/**
 * The session screen rides the keyboard; it does not animate after it.
 *
 * Everything anchored to the bottom edge — the transcript, which is inverted
 * and therefore pinned to it, the composer, and the jump-to-latest button —
 * hangs on one `KeyboardStickyView` each, carrying one shared offset. That is
 * what makes them move as a single object on the keyboard's own frames: a
 * transform published to the UI thread, no re-render, no layout animation
 * racing a spring, and a finger dragging the keyboard down is followed
 * because there is no event to wait for.
 *
 * None of that is visible in a diff, and none of it can fail here — the
 * package's stand-in draws a sticky view as a plain `View`, so a test can
 * only check that the wiring is the wiring. It is checked because the old
 * shape (a height in React state, a `bottom` that moves with it) renders
 * identically and reads as slack on the phone.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));
jest.mock('../src/ui/shake', () => ({ useShake: () => {} }));
jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) => select({ seam: null, credential: null }),
}));
jest.mock('../src/state/hub', () => ({ useSessionHub: () => ({ hub: null }) }));
jest.mock('../src/state/session', () => ({
  useSession: () => ({
    state: null,
    items: [],
    live: null,
    loading: false,
    error: null,
    canLoadEarlier: false,
    loadEarlier: () => {},
  }),
}));

import { SessionDetailScreen } from '../src/screens/SessionDetail';

const metrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 62, left: 0, right: 0, bottom: 34 },
};

async function mount() {
  const Stack = createNativeStackNavigator();
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={metrics}>
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen
              name="Session"
              component={SessionDetailScreen}
              initialParams={{ id: 'a-session' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  return tree!;
}

it('hangs the transcript, the composer and the jump button on the keyboard', async () => {
  const tree = await mount();

  try {
    // Under the stand-in a sticky view *is* a `View`, so they are found by the
    // one prop only they take — and only the host half of each, or every one
    // of them is counted twice. Two while the transcript is at the newest
    // line: the transcript itself and the composer. The jump button is the
    // third, and it only exists once the reader has scrolled off that line.
    const offsets = tree.root
      .findAll(node => typeof node.type === 'string' && node.props?.offset !== undefined)
      .map(node => node.props.offset);
    expect(offsets).toHaveLength(2);

    // One offset, or they travel apart: the keyboard's frame covers the home
    // indicator's strip, and each of them hands that strip back.
    for (const offset of offsets) {
      expect(offset).toEqual({ closed: 0, opened: metrics.insets.bottom });
    }
  } finally {
    await act(async () => tree.unmount());
  }
});

/**
 * Two pieces of wiring with no visible failure: without the provider every
 * keyboard hook reports a keyboard that never moves, and the app looks exactly
 * as it did before this change; without the plugin the UI-thread functions are
 * never compiled and the app throws on the first frame it needs one.
 */
describe('the wiring under it', () => {
  const root = path.join(__dirname, '..');

  it('mounts the provider that publishes the keyboard frames', () => {
    const app = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');

    expect(app).toContain("from 'react-native-keyboard-controller'");
    expect(app).toContain('<KeyboardProvider>');
  });

  /**
   * Every scroll view with a field in it is the library's now. The prop they
   * all used asks the first responder where it is and reads any answer it
   * cannot get as "shift the content up by a whole keyboard" — which is how
   * the sessions page came to scroll its own composer off the top. Named in
   * prose above; this looks for it written as a prop.
   */
  it('has no page left adjusting its own keyboard insets', () => {
    const src = path.join(root, 'src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const lines = fs.readFileSync(full, 'utf8').split('\n');
          if (lines.some(line => /^\s*automaticallyAdjustKeyboardInsets\b/.test(line))) {
            offenders.push(path.relative(src, full));
          }
        }
      }
    };
    walk(src);

    expect(offenders).toEqual([]);
  });

  it('compiles the worklets the tracker runs on the UI thread', () => {
    const babel = fs.readFileSync(path.join(root, 'babel.config.js'), 'utf8');

    expect(babel).toContain('react-native-worklets/plugin');
  });
});
