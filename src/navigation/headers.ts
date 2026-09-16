/**
 * The header, as the platform draws it.
 *
 * Every screen used to paint its own bar: a 14px title, a `‹` typed in Geist
 * Mono, an inset guessed from the safe area. What that cost was everything a
 * native bar does for free — the large title that collapses as you scroll,
 * the blur at the scroll edge, the back button that names where it goes, the
 * search field that lives in the bar, a header that moves with the push.
 * These options hand all of it back to UIKit and to Material.
 */
import type React from 'react';
import { useContext } from 'react';
import { Platform } from 'react-native';
import { HeaderHeightContext } from '@react-navigation/elements';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { font, type Theme } from '../theme';

/** The major iOS version, or 0 where there is no iOS. */
const iosMajor = Platform.OS === 'ios' ? parseInt(String(Platform.Version), 10) || 0 : 0;

/**
 * What every stack shares: the app's type on the platform's bar.
 *
 * On iOS the bar is transparent and the page runs underneath it. That is
 * what iOS 26 draws for its own apps — no slab at all, the content showing
 * through, the scroll-edge effect keeping the title legible and the buttons
 * in glass — and it is the only setting under which the bar is not a colour
 * of someone else's choosing. Left to its defaults, the navigator paints a
 * bar with no large title in the navigation theme's card colour, and a bar
 * with one as transparent over a window that is black: the first is an
 * opaque bar where glass was asked for, the second a black band over a warm
 * page. Under 26 there is no scroll-edge effect, so the bar takes the system
 * chrome material instead — the blur every app had before glass.
 *
 * Android's Material bar has no such material and its default surface is not
 * this palette, so there it is painted.
 */
export function stackOptions({ c }: Theme): NativeStackNavigationOptions {
  return {
    headerTintColor: c.primary,
    headerTitleStyle: { fontFamily: font.sansMedium, color: c.foreground },
    headerLargeTitleStyle: { fontFamily: font.sansMedium, color: c.foreground },
    headerBackTitleStyle: { fontFamily: font.sans },
    ...(Platform.OS === 'ios'
      ? { headerTransparent: true, ...(iosMajor >= 26 ? {} : { headerBlurEffect: 'systemChromeMaterial' as const }) }
      : { headerStyle: { backgroundColor: c.background }, headerLargeStyle: { backgroundColor: c.background } }),
    headerShadowVisible: false,
    contentStyle: { backgroundColor: c.background },
    // Neither platform's default is "back title in Geist"; the chevron alone
    // reads the same everywhere and is what iOS 26 draws anyway.
    headerBackButtonDisplayMode: 'minimal',
  };
}

/**
 * How far a screen's own top content must start down, to clear the bar.
 *
 * Only on iOS, where the bar is transparent and the screen runs up under it.
 * A scroll view with `contentInsetAdjustmentBehavior="automatic"` takes care
 * of itself; this is for everything else — a banner, a message, an inverted
 * list that insets by hand. Android's bar sits above the screen in the layout
 * and needs no room made for it.
 */
export function useHeaderInset(): number {
  // The context, not `useHeaderHeight`: that throws outside a navigator,
  // and a screen with no bar over it simply has nothing to clear.
  const height = useContext(HeaderHeightContext) ?? 0;
  return Platform.OS === 'ios' ? height : 0;
}

/**
 * A tab's own page: the title is large, and collapses as the list scrolls.
 *
 * Nothing here about transparency — an explicit `headerTransparent: false`
 * on a large title made the bar non-translucent while its appearance stayed
 * transparent, which is how the window's black showed through it.
 *
 * The collapse is UIKit's, and UIKit only drives it against a scroll view it
 * has found, which it does by walking first children down from the screen. So
 * a page using this has two jobs, and the first is easy to get wrong: its
 * scroll view must *be* what the screen returns — not the first child of a view
 * the screen returns — and it must carry
 * `contentInsetAdjustmentBehavior="automatic"`.
 *
 * These three pages each wrapped theirs in a `Screen`, which is still a first
 * child and still one step too many: the bar never adopted the page, so the
 * title sat at full size pinned to the top, nothing reserved room for it, and
 * iOS 26's scroll-edge effect — same lookup — never appeared. It survived a
 * whole tab-bar migration before anyone found it, because nothing about it
 * looks wrong in a diff. `__tests__/large-title.test.tsx` walks the chain the
 * OS walks and fails if a view gets back in the way.
 */
export const rootPageOptions: NativeStackNavigationOptions = {
  headerLargeTitle: true,
  headerLargeTitleShadowVisible: false,
};

/**
 * A bar button. On iOS it is a real `UIBarButtonItem` with an SF Symbol, which
 * is what lets iOS 26 put it in glass; Android has no such item API through
 * this navigator yet, so there it is a text button in the bar's trailing slot.
 */
export function barButton(
  { label, symbol, onPress, disabled }: { label: string; symbol: string; onPress: () => void; disabled?: boolean },
  render: (props: { label: string; onPress: () => void; disabled?: boolean }) => React.ReactNode,
): Pick<NativeStackNavigationOptions, 'headerRight' | 'unstable_headerRightItems'> {
  return {
    headerRight: () => render({ label, onPress, disabled }),
    unstable_headerRightItems: () => [
      { type: 'button', label, icon: { type: 'sfSymbol', name: symbol as never }, onPress, disabled },
    ],
  };
}

/**
 * A bar menu: one `…` that opens a `UIMenu` on iOS. Android takes the same
 * items through {@link OverflowMenu} around a text button.
 */
export function barMenu(
  items: { key: string; label: string; symbol: string; destructive?: boolean; onPress: () => void }[],
  render: () => React.ReactNode,
): Pick<NativeStackNavigationOptions, 'headerRight' | 'unstable_headerRightItems'> {
  return {
    headerRight: render,
    unstable_headerRightItems: () => [
      {
        type: 'menu',
        label: 'More',
        icon: { type: 'sfSymbol', name: 'ellipsis.circle' as never },
        menu: {
          items: items.map(item => ({
            type: 'action',
            label: item.label,
            icon: { type: 'sfSymbol', name: item.symbol as never },
            destructive: item.destructive,
            onPress: item.onPress,
          })),
        },
      },
    ],
  };
}
