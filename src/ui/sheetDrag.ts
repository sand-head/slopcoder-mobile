/**
 * What a drag on a sheet's grip means.
 *
 * Kept apart from the sheet itself because it is the half worth arguing about
 * and the only half a test can reach: everything else in `Sheet` is layout that
 * has to be looked at on a phone.
 *
 * The sheet sits on a ladder — closed, natural, full — and a gesture moves it
 * one rung. Down from full returns to the natural height rather than dismissing
 * outright, which is how a multi-detent sheet behaves everywhere else on iOS
 * and means a fat-fingered drag never loses your place in a list.
 */

/** Where a sheet can rest. `natural` is as tall as its content, up to the cap. */
export type SheetSize = 'natural' | 'full';

/** How far a drag must travel to count, when it is not thrown. */
const STEP = 80;

/** Points per millisecond past which a flick counts however short it was. */
const FLICK = 0.6;

export interface Drag {
  size: SheetSize;
  /** Travel in points; positive is downwards, the way gesture state reports it. */
  dy: number;
  /** Velocity in points per millisecond, positive downwards. */
  vy: number;
  /**
   * Whether there is anything to reveal. A sheet already showing all of its
   * content has nothing to grow into, and stretching it would open a band of
   * empty glass under the last row.
   */
  canExpand: boolean;
}

export function settleSheet({ size, dy, vy, canExpand }: Drag): SheetSize | 'closed' {
  const down = vy > FLICK || dy > STEP;
  const up = vy < -FLICK || dy < -STEP;

  if (size === 'full') return down ? 'natural' : 'full';
  if (down) return 'closed';
  return up && canExpand ? 'full' : 'natural';
}

/**
 * How far the sheet may follow a finger.
 *
 * Downwards it is unbounded — that gesture ends in a dismissal. Upwards it
 * stops at nothing when there is nowhere to go, because a sheet that lifts off
 * the bottom of the screen and springs back looks like a bug rather than a
 * refusal.
 */
export function clampDrag(dy: number, canExpand: boolean): number {
  if (dy >= 0) return dy;
  return canExpand ? dy : 0;
}
