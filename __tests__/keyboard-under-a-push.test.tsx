/**
 * A keyboard raised on the screen pushed over the session list is not the
 * list's keyboard.
 *
 * The native scroll view listens for every keyboard in the app, and with
 * `automaticallyAdjustKeyboardInsets` on it answers each one: it pads its
 * bottom, and when the first responder is a field outside it, it also moves
 * its offset by the keyboard's height. It did that under the session screen,
 * every time a message was typed there — so coming back, the list sat scrolled
 * past its own composer for a frame until layout clamped it home.
 *
 * So the flag follows focus. This mounts the list the way the navigator does,
 * pushes a screen over it, and reads the flag on the way in and the way out.
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

it('adjusts for the keyboard only while it is the page on screen', async () => {
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

  const flag = () => {
    const list = find(tree!.toJSON(), 'RCTScrollView') as Exclude<Node, string | null>;
    expect(list).not.toBeNull();
    return list.props.automaticallyAdjustKeyboardInsets;
  };

  try {
    expect(flag()).toBe(true);

    await act(async () => nav.navigate('Session'));
    // Still mounted underneath, no longer listening.
    expect(flag()).toBe(false);

    await act(async () => nav.goBack());
    expect(flag()).toBe(true);
  } finally {
    // A live navigator holds the safe-area provider open and the run never
    // ends — a failure above must still get here.
    await act(async () => tree!.unmount());
  }
});
