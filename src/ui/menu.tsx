/**
 * An overflow menu that is the platform's.
 *
 * `Alert.alert` was standing in for one, which on iOS is a centred dialog and
 * on Android is capped at three buttons — the fourth is silently dropped, and
 * the destructive style is ignored. `MenuView` is `UIMenu` on iOS, with SF
 * Symbols and a proper red for the dangerous row, and a `PopupMenu` on
 * Android. It opens on a tap of the child it wraps, and optionally on a long
 * press of it, which is how a whole row can carry a context menu without a
 * button of its own.
 */
import React from 'react';
import { Platform } from 'react-native';
import { MenuView, type MenuAction } from '@react-native-menu/menu';

export interface MenuItem {
  key: string;
  title: string;
  /** SF Symbol name; ignored on Android, which has no equivalent catalogue. */
  symbol?: string;
  destructive?: boolean;
  onPress: () => void;
}

export function OverflowMenu({
  title,
  items,
  longPress = false,
  children,
}: {
  /** The menu's own heading — on iOS a small grey line, on Android nothing. */
  title?: string;
  items: MenuItem[];
  /** Open on a long press of the child as well as a tap. */
  longPress?: boolean;
  children: React.ReactNode;
}) {
  const actions: MenuAction[] = items.map(item => ({
    id: item.key,
    title: item.title,
    image: Platform.OS === 'ios' ? item.symbol : undefined,
    attributes: item.destructive ? { destructive: true } : undefined,
  }));

  return (
    <MenuView
      title={title}
      actions={actions}
      shouldOpenOnLongPress={longPress}
      onPressAction={({ nativeEvent }) => {
        items.find(item => item.key === nativeEvent.event)?.onPress();
      }}>
      {children}
    </MenuView>
  );
}
