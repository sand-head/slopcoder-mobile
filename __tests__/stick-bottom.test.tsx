/**
 * The transcript has to end up at the bottom, and stay there until told not to.
 *
 * The list opened partway up its own scrollback and the jump-to-latest button
 * landed short of the latest, neither of which is visible in a simulator
 * screenshot. The cause is in RN's own source: `VirtualizedList.scrollToEnd`
 * aims at the last *cell*, so the content container's `paddingBottom` — the
 * space held for the composer floating over the list — is left below the fold.
 *
 * The hook only ever talks to the list through `scrollToOffset`, which is what
 * makes it testable here: a recorder stands in for the list, and the assertion
 * that matters is that the offset asked for is past the end, because clamping
 * it to the real end is the platform's job and it does it right.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { useStickBottom, type Scrollable, type StickBottom } from '../src/ui/stickBottom';

/** A screenful of transcript, and content taller than it. */
const VIEWPORT = 800;

function scrollEvent(offset: number, content: number): any {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y: offset },
      contentSize: { height: content, width: 400 },
      layoutMeasurement: { height: VIEWPORT, width: 400 },
    },
  };
}

/** Mounts the hook and hands back a handle on it, plus the list it scrolled. */
function mount() {
  const list: { current: Scrollable | null } = { current: null };
  const offsets: number[] = [];
  list.current = {
    scrollToOffset: ({ offset, animated }) => {
      // An animated scroll renders rows on the way, which moves the end it was
      // aiming at. There is never a reason for one here.
      expect(animated).toBe(false);
      offsets.push(offset);
    },
  };

  let stick!: StickBottom;
  function Probe() {
    stick = useStickBottom(list);
    return <Text>{String(stick.pinned)}</Text>;
  }

  act(() => {
    create(<Probe />);
  });

  return {
    get pinned() {
      return stick.pinned;
    },
    get scrolls() {
      return offsets.length;
    },
    get lastOffset() {
      return offsets[offsets.length - 1];
    },
    toBottom: () => act(() => stick.toBottom()),
    /** The list re-measured, and is now this tall. */
    grow: (height = 2_000) => act(() => stick.props.onContentSizeChange(400, height)),
    drag: () => act(() => stick.props.onScrollBeginDrag()),
    scroll: (offset: number, content: number) =>
      act(() => stick.props.onScroll(scrollEvent(offset, content))),
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('sticking to the bottom', () => {
  it('starts pinned, so opening a session lands at the newest line', () => {
    const view = mount();
    expect(view.pinned).toBe(true);

    // The transcript arrives after the screen does.
    view.grow(2_000);
    expect(view.scrolls).toBe(1);
  });

  /**
   * The one that was actually broken on the phone. `scrollToEnd` would have
   * aimed at `lastCell.offset + lastCell.length - viewport`, leaving the
   * container's bottom padding — a composer's worth of it — below the fold.
   * Asking for the content height instead overshoots the largest legal offset
   * by a viewport, and the platform clamps it to the real end.
   */
  it('asks for an offset past the end, not the last row', () => {
    const view = mount();
    view.grow(2_000);

    const furthestLegal = 2_000 - VIEWPORT;
    expect(view.lastOffset).toBeGreaterThan(furthestLegal);
    expect(view.lastOffset).toBeGreaterThanOrEqual(2_000);
  });

  it('aims at the height it was last told about', () => {
    const view = mount();
    view.grow(2_000);
    view.drag();
    view.scroll(500, 3_400);

    view.toBottom();
    expect(view.lastOffset).toBe(3_400);
  });

  it('keeps scrolling while the list keeps measuring', () => {
    const view = mount();

    // One scroll lands at the end the list *estimated*; rendering the rows it
    // scrolled past corrects the estimate, which changes the content size,
    // which is the only signal that we are not there yet.
    for (let i = 0; i < 4; i++) view.grow();

    expect(view.scrolls).toBe(4);
    expect(view.pinned).toBe(true);
  });

  it('does not mistake its own short landing for the reader scrolling up', () => {
    const view = mount();
    view.grow();

    // The list says we are 400px from the bottom — because it just grew, not
    // because anyone moved. Unpinning here is the bug that broke the button.
    view.scroll(1_000, 2_200);

    expect(view.pinned).toBe(true);
  });

  it('lets go once a finger is on the glass', () => {
    const view = mount();
    view.grow();

    view.drag();
    view.scroll(1_000, 2_200);

    expect(view.pinned).toBe(false);

    // And having let go, it stays let go: a streaming turn must not drag the
    // view back down while the reader is looking at something earlier.
    const before = view.scrolls;
    view.grow();
    expect(view.scrolls).toBe(before);
  });

  it('re-pins when the reader scrolls back down themselves', () => {
    const view = mount();
    view.drag();
    view.scroll(1_000, 2_200);
    expect(view.pinned).toBe(false);

    view.scroll(1_400, 2_200);
    expect(view.pinned).toBe(true);
  });

  it('follows again after the jump-to-latest button', () => {
    const view = mount();
    view.drag();
    view.scroll(1_000, 2_200);
    expect(view.pinned).toBe(false);

    view.toBottom();
    expect(view.pinned).toBe(true);

    // The scroll it just asked for lands short, and reports so.
    view.scroll(1_300, 2_400);
    expect(view.pinned).toBe(true);

    // Which the next measurement corrects.
    const before = view.scrolls;
    view.grow();
    expect(view.scrolls).toBe(before + 1);
  });

  it('stops ignoring the list once our own scroll is old news', () => {
    const view = mount();
    view.toBottom();

    jest.advanceTimersByTime(1_000);
    view.scroll(1_000, 2_200);

    expect(view.pinned).toBe(false);
  });
});
