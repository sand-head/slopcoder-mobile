/**
 * A keyboard raised somewhere else is not this list's keyboard, and this
 * list's own composer never needs it to move.
 *
 * `automaticallyAdjustKeyboardInsets` asks the first responder where it is,
 * and it read every answer it could not get — a keyboard raised for the
 * session screen's composer, a field it failed to place inside this scroll
 * view — as "shift the content up by a whole keyboard". Gating it on focus
 * only covered the first of those. The second showed up as the page scrolling
 * its own composer off the top the moment it was tapped, and staying there,
 * because nothing puts the offset back when the keyboard goes down: open the
 * app later and the list is still sitting past its composer.
 *
 * The keyboard-aware scroll view answers both. It scrolls for the focused
 * field only when that field belongs to this scroll view and the keyboard
 * would actually cover it, and it restores the position afterwards. Neither
 * half can be exercised here — the package's stand-in draws it as a plain
 * `ScrollView` — so what is checked is that the list is that component, and
 * that the prop whose failure mode was the bug is gone.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));
jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) => select({ seam: null, credential: null }),
}));
jest.mock('../src/state/hub', () => ({ useSessionHub: () => ({ hub: null }) }));
jest.mock('../src/state/repos', () => ({ useOwnedRepos: () => ({ repos: [], loading: false }) }));

import { SessionsScreen } from '../src/screens/Sessions';
import { rootPageOptions, stackOptions } from '../src/navigation/headers';

const metrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 62, left: 0, right: 0, bottom: 34 },
};
const theme = {
  c: { primary: '#009966', foreground: '#f1eee9', background: '#181410' },
} as never;

type Node = { type: string; props: Record<string, unknown>; children?: unknown[] } | string | null;

function find(node: unknown, type: string): Node {
  if (node == null || typeof node === 'string') return null;
  const element = node as Exclude<Node, string | null>;
  if (element.type === type) return element;
  for (const child of element.children ?? []) {
    const hit = find(child, type);
    if (hit) return hit;
  }
  return null;
}

it('leaves the page where it is unless its own field is under the keyboard', async () => {
  const Stack = createNativeStackNavigator();
  const nav = createNavigationContainerRef<{ Sessions: undefined; Session: undefined }>();
  const Session = () => <Text>a session</Text>;

  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={metrics}>
        <NavigationContainer ref={nav}>
          <Stack.Navigator screenOptions={stackOptions(theme)}>
            <Stack.Screen name="Sessions" component={SessionsScreen} options={rootPageOptions} />
            <Stack.Screen name="Session" component={Session} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>,
    );
  });

  try {
    const list = find(tree!.toJSON(), 'RCTScrollView') as Exclude<Node, string | null>;
    expect(list).not.toBeNull();

    // The keyboard-aware scroll view, by the two props only it takes. Layout
    // mode because the alternative wraps the scroll view in a decorator, and a
    // wrapper is what hides this list from the large title.
    expect(list.props.mode).toBe('layout');
    expect(list.props.bottomOffset).toBeGreaterThan(0);

    // And not the prop that moved the page for a keyboard that was not its own.
    expect(list.props.automaticallyAdjustKeyboardInsets).toBeUndefined();

    // Still true on the way in and out of a pushed screen: nothing about this
    // is conditional on which page is on top any more.
    await act(async () => nav.navigate('Session'));
    expect(
      (find(tree!.toJSON(), 'RCTScrollView') as Exclude<Node, string | null>).props
        .automaticallyAdjustKeyboardInsets,
    ).toBeUndefined();
    await act(async () => nav.goBack());
  } finally {
    // A live navigator holds the safe-area provider open and the run never
    // ends — a failure above must still get here.
    await act(async () => tree!.unmount());
  }
});
