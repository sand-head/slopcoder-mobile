/**
 * Keeping a transcript's newest line on screen, which is harder than it sounds.
 *
 * A `FlatList` measures a row only once it has rendered one, so its idea of
 * where the content ends is an estimate until you get there. One `scrollToEnd`
 * therefore lands short of the real bottom whenever the rows below the fold
 * turn out taller than the estimate — which, in a transcript full of diffs and
 * command output, is most of the time. The fix is to scroll again every time
 * the content size changes, and stop when the reader says so.
 *
 * That leaves one trap, and it is the one that made the jump-to-latest button
 * look broken: the list reports our own scrolls back through `onScroll`, and a
 * scroll that landed short reads exactly like a reader who has scrolled up. So
 * offsets only count once a finger has touched the glass. Until then we are
 * talking to ourselves.
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
  scrollToEnd(options?: { animated?: boolean }): void;
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
    onContentSizeChange: () => void;
    scrollEventThrottle: number;
  };
}

export function useStickBottom(list: RefObject<Scrollable | null>): StickBottom {
  const [pinned, setPinned] = useState(true);
  // A ref as well as state: the content-size handler would otherwise close over
  // whatever `pinned` was when it was last rendered.
  const pinnedRef = useRef(true);
  const scrolledAt = useRef(0);

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
    list.current?.scrollToEnd({ animated: false });
  }, [list]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (Date.now() - scrolledAt.current < SELF_SCROLL_MS) return;

    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const fromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    const next = fromBottom < THRESHOLD;

    pinnedRef.current = next;
    setPinned(next);
  }, []);

  const onScrollBeginDrag = useCallback(() => {
    // The reader has taken over. Every offset from here is theirs.
    scrolledAt.current = 0;
  }, []);

  const onContentSizeChange = useCallback(() => {
    if (pinnedRef.current) toBottom();
  }, [toBottom]);

  return {
    pinned,
    toBottom,
    props: { onScrollBeginDrag, onScroll, onContentSizeChange, scrollEventThrottle: 16 },
  };
}
