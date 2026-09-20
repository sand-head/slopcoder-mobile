/**
 * An overflow menu that is the platform's.
 *
 * `Alert.alert` was standing in for one, which on iOS is a centred dialog and
 * on Android is capped at three buttons — the fourth is silently dropped, and
 * the destructive style is ignored. `MenuView` is `UIMenu` on iOS, with SF
 * Symbols and a proper red for the dangerous row, and a `PopupMenu` on
 * Android. It opens on a tap of the child it wraps.
 *
 * **Nothing that has its own tap may be put inside it.** On iOS `MenuView` is a
 * `UIButton` holding the child, and the button takes the tap: a `Pressable`
 * under one is pressed and never fires. Rows and cards were wrapped this way
 * with `shouldOpenOnLongPress`, on the theory that the long press went to the
 * menu and the tap through to the row — and the tap went nowhere at all, so
 * every row and card with a menu could only be opened *through* the menu. So
 * this wraps the trigger and nothing else, and a row that both opens and has a
 * menu carries the two as siblings: the row is the tap, {@link RowMenuButton}
 * is the menu.
 */
import React from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
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
  style,
  children,
}: {
  /** The menu's own heading — on iOS a small grey line, on Android nothing. */
  title?: string;
  items: MenuItem[];
  /**
   * The native wrapper is a view of its own with no size of its own. Wrapped
   * around a flex row's child it must carry that child's flex, or the child
   * lays out in zero width — a session row rendered as a dot and a `…` with
   * nothing between them.
   */
  style?: StyleProp<ViewStyle>;
  /** The trigger, and only the trigger. See the note above. */
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
      style={style}
      title={title}
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        items.find(item => item.key === nativeEvent.event)?.onPress();
      }}>
      {children}
    </MenuView>
  );
}
