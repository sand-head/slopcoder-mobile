/**
 * The transcript has to end up at the bottom, and stay there until told not to.
 *
 * Every bug this covers shipped in the first TestFlight build and none of them
 * could be seen from a simulator screenshot: the list opened partway up its own
 * scrollback, and the jump-to-latest button landed short of the latest. Both
 * came from the same place — a `FlatList` reports the scrolls we ask for back
 * to us through `onScroll`, and one that landed short is indistinguishable from
 * a reader who scrolled up, so the follow turned itself off.
 *
 * A `FlatList` that has not laid out is what makes this untestable on device
 * and testable here: the hook only ever talks to the list through
 * `scrollToEnd`, so a counter stands in for one.
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
  let ends = 0;
  list.current = {
    scrollToEnd: () => {
      ends++;
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
      return ends;
    },
    toBottom: () => act(() => stick.toBottom()),
    grow: () => act(() => stick.props.onContentSizeChange()),
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
    view.grow();
    expect(view.scrolls).toBe(1);
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
