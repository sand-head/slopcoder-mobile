/**
 * The bottom sheet: what its grip means, and the layout facts behind it.
 *
 * The layout half is asserted against the rendered tree rather than by eye,
 * because each is a single style property whose absence is invisible until you
 * are holding the thing — a sheet that does not move for the keyboard looks,
 * from a screenshot, exactly like one that does.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { Keyboard, ScrollView, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Sheet } from '../src/ui/Sheet';
import { clampDrag, settleSheet, type SheetSize } from '../src/ui/sheetDrag';

describe('what a drag on the grip means', () => {
  const drag = (over: Partial<Parameters<typeof settleSheet>[0]>) =>
    settleSheet({ size: 'natural', dy: 0, vy: 0, canExpand: true, ...over });

  it('does nothing at all for a nudge', () => {
    expect(drag({ dy: 20 })).toBe('natural');
    expect(drag({ dy: -20 })).toBe('natural');
  });

  it('dismisses on a long pull down, or a flick', () => {
    expect(drag({ dy: 200 })).toBe('closed');
    expect(drag({ dy: 10, vy: 1.4 })).toBe('closed');
  });

  it('grows on a pull up, or a flick', () => {
    expect(drag({ dy: -200 })).toBe('full');
    expect(drag({ dy: -10, vy: -1.4 })).toBe('full');
  });

  /** Stretching a sheet that is already showing everything opens empty glass. */
  it('refuses to grow when there is nothing hidden', () => {
    expect(drag({ dy: -200, canExpand: false })).toBe('natural');
    expect(clampDrag(-60, false)).toBe(0);
    expect(clampDrag(-60, true)).toBe(-60);
  });

  /**
   * One rung at a time. A pull down from full returns to the natural height
   * rather than dismissing, so a fat-fingered drag never loses your place in a
   * list — which is how every other multi-detent sheet on the platform behaves.
   */
  it('steps down from full to natural before it closes', () => {
    expect(drag({ size: 'full', dy: 200 })).toBe('natural');
    expect(drag({ size: 'full', dy: 200, vy: 2 })).toBe('natural');
    expect(drag({ size: 'natural', dy: 200 })).toBe('closed');
  });

  it('always follows a finger downwards, wherever it is', () => {
    // That gesture ends in a dismissal, so there is nothing to hold it back.
    expect(clampDrag(300, false)).toBe(300);
  });

  it.each<SheetSize>(['natural', 'full'])('never leaves %s for nowhere', size => {
    expect(['natural', 'full', 'closed']).toContain(drag({ size, dy: 40, vy: 0.1 }));
  });
});

describe('the sheet on screen', () => {
  /** A phone with a notch and a home indicator, which is what this ships to. */
  const METRICS = {
    frame: { x: 0, y: 0, width: 393, height: 852 },
    insets: { top: 59, left: 0, right: 0, bottom: 34 },
  };

  function render() {
    let tree: ReturnType<typeof create> | undefined;
    act(() => {
      tree = create(
        <SafeAreaProvider initialMetrics={METRICS}>
          <Sheet visible title="Attach" onClose={() => {}}>
            <Text>a repository</Text>
          </Sheet>
        </SafeAreaProvider>,
      );
    });
    return tree!;
  }

  const flatten = (style: unknown): Record<string, any> =>
    Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style ?? {};

  /**
   * React Native defaults `flexShrink` to 0 where the web defaults to 1, which
   * is the usual reason a `ScrollView` in a capped column lays out at its full
   * content height and overflows instead of scrolling. This sheet scrolls
   * either way today — the constraint is written down so that stays true of
   * whichever ancestor ends up bounding it.
   */
  it('lets the list shrink, whatever bounds it', () => {
    const scroll = render().root.findByType(ScrollView);
    expect(flatten(scroll.props.style).flexShrink).toBe(1);
  });

  /** Otherwise the first tap on a search result is spent closing the keyboard. */
  it('keeps taps alive while the keyboard is up', () => {
    const scroll = render().root.findByType(ScrollView);
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  });

  /**
   * The sheet is anchored to the bottom edge, which is exactly where the
   * keyboard arrives. Without this a sheet with a search field in it hides its
   * own results the moment you type in it.
   */
  it('sits above the keyboard', () => {
    const listeners = new Map<string, (event: any) => void>();
    jest.spyOn(Keyboard, 'addListener').mockImplementation((event, handler) => {
      listeners.set(event, handler);
      return { remove: () => listeners.delete(event) } as any;
    });

    const tree = render();
    const sheet = () =>
      tree.root
        .findAll(node => flatten(node.props?.style).maxHeight != null, { deep: true })
        .map(node => flatten(node.props.style))[0];

    // The `Will` events, not the `Did` ones: on iOS they carry the frame before
    // the animation runs, so the sheet travels with the keyboard instead of
    // catching up to it afterwards.
    expect([...listeners.keys()]).toEqual(['keyboardWillShow', 'keyboardWillHide']);

    expect(sheet().marginBottom).toBe(0);
    const before = sheet().maxHeight;

    act(() => listeners.get('keyboardWillShow')!({ endCoordinates: { height: 336 } }));

    expect(sheet().marginBottom).toBe(336);
    // And gives up the height the keyboard took, rather than growing under it.
    expect(sheet().maxHeight).toBeLessThan(before);

    act(() => listeners.get('keyboardWillHide')!({}));
    expect(sheet().marginBottom).toBe(0);

    jest.restoreAllMocks();
  });
});
