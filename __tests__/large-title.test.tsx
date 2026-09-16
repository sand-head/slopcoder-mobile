/**
 * The one thing a large-title page has to get right, and the only way to check
 * it off a phone.
 *
 * UIKit collapses the big title against a scroll view it has *found*, and it
 * finds it by walking first children down from the screen — the same walk
 * `RNSScrollViewFinder` mirrors, and the reason React Navigation's own example
 * returns a `ScrollView` and nothing else. Wrap one view around it and the walk
 * stops short: the bar never adopts the page, so the title stays at full size
 * pinned to the top, no compact bar ever appears, and nothing insets the
 * content that then scrolls underneath it.
 *
 * Which is exactly what shipped, twice, because the mistake is invisible in
 * every other way — it renders, it scrolls, it looks right until you drag it.
 * So: mount each page the way the navigator does, walk the chain the OS walks,
 * and fail if a view got in the way.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));

// No seam: every page here renders its empty state without reaching a server,
// and the shape of the tree is the same either way.
jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) => select({ seam: null, credential: null }),
}));
jest.mock('../src/state/hub', () => ({ useSessionHub: () => ({ hub: null }) }));
jest.mock('../src/state/repos', () => ({ useOwnedRepos: () => ({ repos: [], loading: false }) }));

import { SettingsScreen } from '../src/screens/Settings';
import { UsageScreen } from '../src/screens/Usage';
import { SessionsScreen } from '../src/screens/Sessions';
import { rootPageOptions, stackOptions } from '../src/navigation/headers';

const metrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 62, left: 0, right: 0, bottom: 34 },
};

const theme = {
  c: { primary: '#009966', foreground: '#f1eee9', background: '#181410' },
} as never;

/** First child, all the way down — the chain the OS follows. */
function firstChildChain(node: unknown, out: string[] = []): string[] {
  if (node == null || typeof node === 'string') return out;
  const element = node as { type: string; children?: unknown[] };
  out.push(element.type);
  return firstChildChain((element.children ?? [])[0], out);
}

async function chainFor(name: string, component: React.ComponentType<any>) {
  const Stack = createNativeStackNavigator();
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={metrics}>
        <NavigationContainer>
          <Stack.Navigator screenOptions={stackOptions(theme)}>
            <Stack.Screen name={name} component={component} options={rootPageOptions} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  const chain = firstChildChain(tree!.toJSON());
  // A live navigator holds the safe-area provider open and the run never ends.
  await act(async () => tree!.unmount());
  return chain;
}

describe.each([
  ['Settings', SettingsScreen],
  ['Usage', UsageScreen],
  // Sessions is the shape most likely to regress: it has a sibling after the
  // list, so it returns a fragment rather than the scroll view itself, and a
  // fragment is one keystroke from being a view again.
  ['Sessions', SessionsScreen],
])('%s, as a large-title page', (name, component) => {
  it('hands its scroll view to the bar by being the screen, not by being inside one', async () => {
    const chain = await chainFor(name, component);
    const screen = chain.indexOf('RNSScreen');
    const scrollView = chain.indexOf('RCTScrollView');

    expect(screen).toBeGreaterThan(-1);
    // Found at all: a view wrapped around the scroll view drops it off this
    // chain entirely, which is the failure this test exists for.
    expect(scrollView).toBeGreaterThan(-1);
    // And reached through the content wrapper alone — the navigator's own view,
    // which the OS already accounts for. Anything else is ours, and is one step
    // too many.
    expect(chain.slice(screen, scrollView + 1)).toEqual([
      'RNSScreen',
      'RNSScreenContentWrapper',
      'RCTScrollView',
    ]);
  });
});
