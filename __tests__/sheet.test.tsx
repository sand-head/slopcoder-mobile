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
import { Animated, Keyboard, Modal, PanResponder, ScrollView, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Sheet } from '../src/ui/Sheet';
import { clampDrag, detents, settleSheet, type SheetSize } from '../src/ui/sheetDrag';

describe('what a drag on the grip means', () => {
  const drag = (over: Partial<Parameters<typeof settleSheet>[0]>) =>
    settleSheet({ size: 'medium', dy: 0, vy: 0, canGrow: true, ...over });

  it('does nothing at all for a nudge', () => {
    expect(drag({ dy: 20 })).toBe('medium');
    expect(drag({ dy: -20 })).toBe('medium');
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
    expect(drag({ dy: -200, canGrow: false })).toBe('medium');
    expect(clampDrag(-60, false)).toBe(0);
    expect(clampDrag(-60, true)).toBe(-60);
  });

  /**
   * The detent the sheet opens at has to be visibly smaller than the one it can
   * be dragged to, or every upward gesture is a no-op and the grip is a lie.
   * This is the bug the first attempt shipped: both detents resolved to the
   * same cap, so the responder fired and nothing moved.
   */
  it('has somewhere to grow into', () => {
    const { medium, full } = detents(852 - 59);
    expect(full).toBeGreaterThan(medium + 100);
    // And leaves a strip of backdrop to tap, however long the content is.
    expect(full).toBeLessThan(852 - 59);
  });

  it('keeps the smaller detent usable on a short screen', () => {
    expect(detents(320).medium).toBeGreaterThanOrEqual(240);
  });

  /**
   * One rung at a time. A pull down from full returns to the natural height
   * rather than dismissing, so a fat-fingered drag never loses your place in a
   * list — which is how every other multi-detent sheet on the platform behaves.
   */
  it('steps down from full to medium before it closes', () => {
    expect(drag({ size: 'full', dy: 200 })).toBe('medium');
    expect(drag({ size: 'full', dy: 200, vy: 2 })).toBe('medium');
    expect(drag({ size: 'medium', dy: 200 })).toBe('closed');
  });

  it('always follows a finger downwards, wherever it is', () => {
    // That gesture ends in a dismissal, so there is nothing to hold it back.
    expect(clampDrag(300, false)).toBe(300);
  });

  it.each<SheetSize>(['medium', 'full'])('never leaves %s for nowhere', size => {
    expect(['medium', 'full', 'closed']).toContain(drag({ size, dy: 40, vy: 0.1 }));
  });
});

describe('the sheet on screen', () => {
  /** A phone with a notch and a home indicator, which is what this ships to. */
  const METRICS = {
    frame: { x: 0, y: 0, width: 393, height: 852 },
    insets: { top: 59, left: 0, right: 0, bottom: 34 },
  };

  /**
   * Opening a sheet starts an animation, and a JS-driven one is a real timer.
   * Left running past the test that made it, it fires into a torn-down renderer
   * and takes the whole worker process with it.
   */
  const open: ReturnType<typeof create>[] = [];

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    for (const tree of open) act(() => tree.unmount());
    open.length = 0;
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function mount(onClose: () => void = () => {}) {
    let tree: ReturnType<typeof create> | undefined;
    act(() => {
      tree = create(
        <SafeAreaProvider initialMetrics={METRICS}>
          <Sheet visible title="Attach" onClose={onClose}>
            <Text>a repository</Text>
          </Sheet>
        </SafeAreaProvider>,
      );
    });
    open.push(tree!);
    return tree!;
  }

  const render = () => mount();

  const flatten = (style: unknown): Record<string, any> =>
    Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style ?? {};

  /** The sheet itself: the one box with a height cap on it. */
  const sheetStyle = (tree: ReturnType<typeof create>) =>
    tree.root
      .findAll(node => flatten(node.props?.style).maxHeight != null, { deep: true })
      .map(node => flatten(node.props.style))[0];

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
  it('rises with the keyboard, at the keyboard\'s speed', () => {
    const listeners = new Map<string, (event: any) => void>();
    jest.spyOn(Keyboard, 'addListener').mockImplementation((event, handler) => {
      listeners.set(event, handler);
      return { remove: () => listeners.delete(event) } as any;
    });
    const timing = jest.spyOn(Animated, 'timing');

    const tree = render();

    // The `Will` events, not the `Did` ones: on iOS they carry the frame and
    // the duration before the animation runs, so the sheet travels with the
    // keyboard instead of catching up to it afterwards.
    expect([...listeners.keys()]).toEqual(['keyboardWillShow', 'keyboardWillHide']);

    const before = sheetStyle(tree).maxHeight;
    timing.mockClear();

    act(() => listeners.get('keyboardWillShow')!({ endCoordinates: { height: 336 }, duration: 310 }));

    // Lifted by exactly the keyboard's height, over exactly its duration.
    expect(timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: -336, duration: 310 }),
    );
    // And gives up the height the keyboard took, rather than growing under it.
    expect(sheetStyle(tree).maxHeight).toBeLessThan(before);

    act(() => listeners.get('keyboardWillHide')!({ duration: 310 }));
    expect(timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: -0, duration: 310 }),
    );

    jest.restoreAllMocks();
  });

  /**
   * `animationType="slide"` slides the whole modal, and the modal is the
   * backdrop too — so every sheet opened behind a rectangle of dimming rising
   * up the screen with a hard horizontal edge. The sheet travels on its own
   * now and the backdrop fades where it stands.
   */
  it('does not let the modal slide its own backdrop', () => {
    const tree = render();
    const modal = tree.root.findByType(Modal);

    expect(modal.props.animationType).toBe('none');
    expect(modal.props.transparent).toBe(true);

    // The dimming is a fade, which means an animated opacity and no transform.
    const backdrop = tree.root
      .findAll(node => flatten(node.props?.style).opacity != null, { deep: true })
      .map(node => flatten(node.props.style))
      .find(style => style.position === 'absolute');

    expect(backdrop?.opacity).toBeInstanceOf(Animated.Value);
    expect(backdrop?.transform).toBeUndefined();
  });

  /**
   * The one that has now been wrong twice, and could not be caught by reading
   * either half on its own: the responder fires, the ladder answers, and the
   * sheet is a different size afterwards. The first version dragged fine and
   * resolved both detents to the same cap; the second opened at the larger one,
   * so up had nowhere to go.
   *
   * Driven through the config the component hands to `PanResponder`, because
   * gesture state is accumulated from touch histories that a test cannot
   * plausibly fake — and the assertion is on the rendered height, not on the
   * state, so a wiring that stops short still fails.
   */
  it('grows and shrinks the sheet when the grip is dragged', () => {
    let config: any;
    jest.spyOn(PanResponder, 'create').mockImplementation(created => {
      config = created;
      return { panHandlers: {} } as any;
    });

    const closed = jest.fn();
    const tree = mount(closed);

    // A list far longer than the space it has, so there is something to reveal.
    const scroll = tree.root.findByType(ScrollView);
    act(() => scroll.props.onLayout({ nativeEvent: { layout: { height: 300 } } }));
    act(() => scroll.props.onContentSizeChange(393, 2_000));

    const medium = sheetStyle(tree).maxHeight;

    act(() => config.onPanResponderRelease({}, { dy: -200, vy: -1 }));
    const full = sheetStyle(tree).maxHeight;
    expect(full).toBeGreaterThan(medium);

    act(() => config.onPanResponderRelease({}, { dy: 200, vy: 1 }));
    expect(sheetStyle(tree).maxHeight).toBe(medium);
    expect(closed).not.toHaveBeenCalled();

    // And from there, down again gets out.
    act(() => config.onPanResponderRelease({}, { dy: 200, vy: 1 }));
    expect(closed).toHaveBeenCalled();

    jest.restoreAllMocks();
  });

  /**
   * The drag strip must be a *sibling* of the glass, painted after it.
   *
   * `GlassSurface` is a `UIVisualEffectView` on iOS 26, and `UIGlassEffect` can
   * leave its `contentView` with `isUserInteractionEnabled` off; the package
   * ships a workaround for it. Taps on the close button survived that. Drags
   * did not, through two releases. Anything inside the glass is at the mercy of
   * it, so the strip lives outside — and last, so it is on top.
   */
  it('listens for the drag outside the glass, and over it', () => {
    const tree = render();

    const dragging = tree.root.find(
      // Host nodes only: the test renderer reports the component and the view
      // it renders, and only one of them has a place among its siblings.
      node => typeof node.type === 'string' && node.props?.accessibilityLabel === 'Resize',
    );

    // Nothing scrollable underneath it: it is a strip, not a wrapper.
    expect(dragging.findAllByType(ScrollView)).toHaveLength(0);

    // The glass is the box holding the list. The strip must not be inside it.
    const glass = tree.root.find(
      node =>
        typeof node.type === 'string' &&
        flatten(node.props?.style).paddingBottom != null &&
        node.findAllByType(ScrollView).length > 0,
    );
    expect(glass.findAll(node => node.props?.accessibilityLabel === 'Resize')).toHaveLength(0);

    // And it paints after the glass, so it is on top of it.
    const sheet = tree.root.find(
      node => typeof node.type === 'string' && flatten(node.props?.style).maxHeight != null,
    );
    const order = sheet.children.filter(child => typeof child !== 'string') as any[];
    expect(order[0].findAllByType(ScrollView).length).toBeGreaterThan(0);
    expect(
      order[order.length - 1].findAll((node: any) => node.props?.accessibilityLabel === 'Resize')
        .length,
    ).toBeGreaterThan(0);
  });

  /** A thumb's worth of target, starting clear of the close button. */
  it('gives the drag a real target that does not cover the close button', () => {
    const tree = render();
    const strip = flatten(
      tree.root.find(
        node => typeof node.type === 'string' && node.props?.accessibilityLabel === 'Resize',
      ).props.style,
    );

    expect(strip.height).toBeGreaterThanOrEqual(44);
    // The close button sits at x 16..48 with a 10pt hit slop around it.
    expect(strip.left).toBeGreaterThanOrEqual(58);
  });

  /**
   * A graph that mixes native and JS animated nodes fails by doing nothing
   * rather than by raising anything, and three values compose into this one
   * transform. One view moving is not the place to spend that risk.
   */
  it('animates on one driver', () => {
    const timing = jest.spyOn(Animated, 'timing');
    render();

    expect(timing).toHaveBeenCalled();
    for (const [, config] of timing.mock.calls) {
      expect((config as any).useNativeDriver).toBe(false);
    }

    jest.restoreAllMocks();
  });
});
