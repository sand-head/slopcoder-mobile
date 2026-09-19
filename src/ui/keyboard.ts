/**
 * What a control that sits on the keyboard has to know.
 *
 * It used to be a height in React state: `keyboardWillShow` arrived, the
 * screen re-rendered with a new `bottom`, and a layout animation on the
 * keyboard's curve carried it there. That is a *replica* of the keyboard's
 * animation, started a commit late and run for the duration the event
 * reported — and the keyboard does not move on that duration any more. It
 * springs. A 250ms ease cannot land on a spring: the curves part company in
 * the middle, the composer arrives early and waits while the keyboard is
 * still settling, and the whole thing reads as slack. Worse, the transcript
 * scrolls with `keyboardDismissMode="interactive"`, and a keyboard dragged
 * down by a finger sends no event at all until it is let go — so the composer
 * could not follow it even in principle.
 *
 * `react-native-keyboard-controller` reads the real keyboard's frame on every
 * display frame and publishes it to the UI thread, so a view can ride the
 * position rather than animate towards it. `KeyboardStickyView` is that view;
 * this is the offset the three of them on the session screen share.
 *
 * The offset exists because the keyboard's frame includes the home
 * indicator's strip. With the keyboard down a control clears the indicator on
 * its own bottom padding; with it up that padding would hold the control a
 * strip's height off the keys, so the sticky view gives it back.
 */
import { useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * The gap a form keeps between the field being typed in and the keyboard's top
 * edge. A field flush against the keys reads as covered even when it is not,
 * and on a page whose next control is right under the field — a Save row, the
 * second half of a pair — that control is the thing you are about to reach for.
 */
export const KEYBOARD_GAP = 16;

export type KeyboardOffset = { closed: number; opened: number };

export function useKeyboardOffset(): KeyboardOffset {
  const insets = useSafeAreaInsets();

  return useMemo(() => ({ closed: 0, opened: insets.bottom }), [insets.bottom]);
}
