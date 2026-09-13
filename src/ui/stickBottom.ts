/**
 * Keeping a transcript's newest line on screen, which is harder than it sounds.
 *
 * **`FlatList.scrollToEnd` does not go to the end.** It works out its offset
 * from the last *cell* — `frame.offset + frame.length + footerLength -
 * visibleLength` — and a cell knows nothing about the content container's
 * padding. Ours has `paddingBottom: composerHeight + 16`, the whole point of
 * which is to keep the newest line clear of the composer floating over the
 * list, so `scrollToEnd` stops precisely one composer short and leaves the line
 * you wanted to read underneath it. (RN's own ScrollView has a native
 * `scrollToEnd` that gets this right; VirtualizedList does not call it. There
 * is a TODO in its source about that.)
 *
 * So: scroll past the end and let the platform clamp. Both `RCTScrollView` and
 * Android's `ReactScrollView` clamp a programmatic offset to
 * `contentSize - bounds`, which is the real bottom, padding and all. The
 * content height reported by `onContentSizeChange` overshoots it by exactly one
 * viewport, so it needs no fudge constant.
 *
 * The other half is knowing when to stop. A `FlatList` measures a row only once
 * it has rendered one, so its content height is part measurement and part
 * estimate, and a scroll to the estimated end renders more rows, which corrects
 * the estimate, which moves the end. Scrolling again on each content-size
 * change converges. The trap is that the list reports our scrolls back through
 * `onScroll`, and one that landed short is indistinguishable from a reader
 * scrolling up — so offsets only count once a finger has touched the glass.
 * Until then we are talking to ourselves.
 */
import type { RefObject } from 'react';
import { useCallback, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/** How close to the end still counts as being at the end. The web uses the same. */
const THRESHOLD = 80;

/**
 * How long after a scroll of our own to disregard the list's scroll events.
 * Generous next to a frame, short next to a reader deciding to look upwards.
 */
const SELF_SCROLL_MS = 300;

/** The sliver of a list this needs, so a test can stand in for one. */
export interface Scrollable {
  scrollToOffset(params: { offset: number; animated?: boolean }): void;
}

export interface StickBottom {
  /** Whether the newest line is on screen. False is what puts the button up. */
  pinned: boolean;
  /** Go to the bottom, and follow it from there. */
  toBottom: () => void;
  /** Spread onto the list. */
  props: {
    onScrollBeginDrag: () => void;
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    onContentSizeChange: (width: number, height: number) => void;
    scrollEventThrottle: number;
  };
}

export function useStickBottom(list: RefObject<Scrollable | null>): StickBottom {
  const [pinned, setPinned] = useState(true);
  // A ref as well as state: the content-size handler would otherwise close over
  // whatever `pinned` was when it was last rendered.
  const pinnedRef = useRef(true);
  const scrolledAt = useRef(0);
  const contentHeight = useRef(0);

  /**
   * Never animated. An animated scroll takes long enough that the rows it
   * renders on the way change the content size underneath it, so it lands
   * somewhere short of where it aimed. Jumping, then jumping again as the list
   * measures what it has drawn, arrives.
   */
  const toBottom = useCallback(() => {
    pinnedRef.current = true;
    setPinned(true);
    scrolledAt.current = Date.now();
    // Deliberately past the end — by one viewport, since this is the height of
    // the content rather than the largest offset. The platform clamps.
    list.current?.scrollToOffset({ offset: contentHeight.current, animated: false });
  }, [list]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    contentHeight.current = contentSize.height;

    if (Date.now() - scrolledAt.current < SELF_SCROLL_MS) return;

    const fromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    const next = fromBottom < THRESHOLD;

    pinnedRef.current = next;
    setPinned(next);
  }, []);

  const onScrollBeginDrag = useCallback(() => {
    // The reader has taken over. Every offset from here is theirs.
    scrolledAt.current = 0;
  }, []);

  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeight.current = height;
      if (pinnedRef.current) toBottom();
    },
    [toBottom],
  );

  return {
    pinned,
    toBottom,
    props: { onScrollBeginDrag, onScroll, onContentSizeChange, scrollEventThrottle: 16 },
  };
}
