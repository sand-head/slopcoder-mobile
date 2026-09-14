/**
 * Whether the reader is at the newest line of an inverted transcript.
 *
 * The list is inverted, so "the bottom" is offset zero and staying there as
 * lines arrive is the platform's job: `maintainVisibleContentPosition` with
 * `autoscrollToTopThreshold` keeps the newest line pinned while the reader is
 * near it and leaves the view alone once they have scrolled up to read. What
 * this hook adds is the one fact the platform does not hand back — whether
 * they are near it — which is what puts the jump-to-latest button up.
 *
 * This replaced a hundred lines that fought `scrollToEnd` on a forward list;
 * see the history of `stickBottom.ts` for what that cost.
 */
import type { RefObject } from 'react';
import { useCallback, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/** How close to the end still counts as being at the end. The web uses the same. */
export const THRESHOLD = 80;

export interface Scrollable {
  scrollToOffset(params: { offset: number; animated?: boolean }): void;
}

export function useAtBottom(list: RefObject<Scrollable | null>) {
  const [pinned, setPinned] = useState(true);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPinned(event.nativeEvent.contentOffset.y < THRESHOLD);
  }, []);

  const toBottom = useCallback(() => {
    list.current?.scrollToOffset({ offset: 0, animated: true });
    setPinned(true);
  }, [list]);

  return {
    pinned,
    toBottom,
    props: {
      onScroll,
      scrollEventThrottle: 32,
      maintainVisibleContentPosition: { minIndexForVisible: 0, autoscrollToTopThreshold: THRESHOLD },
    },
  };
}
