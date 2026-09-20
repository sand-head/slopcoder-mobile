/**
 * The three rules that decide whether the terminal can be typed into.
 *
 * All three are invisible from JS and were all wrong at once: the field the
 * keyboard hangs off was at zero alpha, which on iOS is a view that cannot
 * become first responder and since React Native 0.76 cannot be hit-tested
 * either — so `focus()` did nothing; there was nothing to tap to call it but a
 * small `abc` key nobody looks for; and with the keyboard up it would have
 * covered the bottom half of the grid, because the sheet's box was a fixed
 * fraction of the screen.
 *
 * Every one of those renders, lays out and screenshots correctly.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { useKeyboardState } from 'react-native-keyboard-controller';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

import { TerminalSheet } from '../src/ui/TerminalSheet';
import { TERMINAL_BACKGROUND } from '../src/term/palette';

const keyboard = useKeyboardState as unknown as jest.Mock;

function mount() {
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(
      // No server: the socket never opens, and none of this depends on it.
      <TerminalSheet visible onClose={() => {}} baseUrl={null} apiKey={null} sessionId="s-1" />,
    );
  });
  return tree!;
}

function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return (style ?? {}) as Record<string, unknown>;
}

/** The sheet's own box: the dark panel the whole terminal is laid out in. */
function boxHeight(tree: ReturnType<typeof create>): number {
  const box = tree.root.findAll(node => {
    if (typeof node.type !== 'string') return false;
    const style = flatten(node.props?.style);
    return style.backgroundColor === TERMINAL_BACKGROUND && typeof style.height === 'number';
  })[0];
  return flatten(box.props.style).height as number;
}

describe('the terminal sheet', () => {
  beforeEach(() => {
    keyboard.mockImplementation((select: (state: { height: number }) => unknown) =>
      select({ height: 0 }),
    );
  });

  it('keeps the field the keyboard hangs off out of zero alpha', () => {
    const tree = mount();
    const input = tree.root.findAll(
      node => typeof node.type === 'string' && node.props?.accessibilityLabel === 'Terminal input',
    )[0];

    const opacity = flatten(input.props.style).opacity as number;
    expect(opacity).toBeGreaterThan(0.01);
  });

  it('gives the output itself something to do with a tap', () => {
    const tree = mount();
    const scroll = tree.root.findAll(node => node.props?.keyboardShouldPersistTaps === 'always')[0];

    // Some ancestor of the grid takes a press — that is the keyboard's way up.
    let node = scroll.parent;
    let pressable = false;
    while (node && !pressable) {
      pressable = typeof node.props?.onPress === 'function';
      node = node.parent;
    }
    expect(pressable).toBe(true);
  });

  it('takes the keyboard out of the grid rather than drawing under it', () => {
    const closed = boxHeight(mount());

    keyboard.mockImplementation((select: (state: { height: number }) => unknown) =>
      select({ height: 300 }),
    );

    expect(boxHeight(mount())).toBe(closed - 300);
  });
});
