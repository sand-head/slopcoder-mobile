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
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { font, type Theme } from '../theme';

/** What every stack shares: the app's type on the platform's bar. */
export function stackOptions({ c }: Theme): NativeStackNavigationOptions {
  return {
    headerTintColor: c.primary,
    headerTitleStyle: { fontFamily: font.sansMedium, color: c.foreground },
    headerLargeTitleStyle: { fontFamily: font.sansMedium, color: c.foreground },
    headerBackTitleStyle: { fontFamily: font.sans },
    headerStyle: { backgroundColor: c.background },
    headerLargeStyle: { backgroundColor: c.background },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: c.background },
    // Neither platform's default is "back title in Geist"; the chevron alone
    // reads the same everywhere and is what iOS 26 draws anyway.
    headerBackButtonDisplayMode: 'minimal',
  };
}

/** A tab's own page: the title is large, and collapses as the list scrolls. */
export const rootPageOptions: NativeStackNavigationOptions = {
  headerLargeTitle: true,
  headerLargeTitleShadowVisible: false,
  headerTransparent: false,
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
