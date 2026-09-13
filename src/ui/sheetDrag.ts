/**
 * What a drag on a sheet's grip means.
 *
 * Kept apart from the sheet itself because it is the half worth arguing about
 * and the only half a test can reach: everything else in `Sheet` is layout that
 * has to be looked at on a phone.
 *
 * Two detents, and the sheet opens at the smaller one. That ordering is the
 * whole design: a sheet that opens at its largest size has nowhere to be
 * dragged, which is how the first attempt at this shipped a grip that responded
 * to every gesture and moved nothing. If a drag can have no visible effect, the
 * grip is a lie whatever the code does.
 *
 * Down always means out. An earlier version stepped from the tall detent to the
 * short one instead, on the theory that a fat-fingered drag should not lose
 * your place — but a sheet you cannot throw away from the size you are actually
 * looking at is a sheet that ignores you, and the Claude app dismisses straight
 * from its tallest detent in one gesture. Getting back to the short detent is
 * not worth a gesture nobody reaches for.
 */

/** Where a sheet can rest. Both are caps — a short sheet is its content, either way. */
export type SheetSize = 'medium' | 'full';

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
   * Whether anything is hidden below the fold at the current size. A sheet
   * already showing all of its content has nothing to grow into, and stretching
   * it would open a band of empty glass under the last row.
   */
  canGrow: boolean;
}

export function settleSheet({ size, dy, vy, canGrow }: Drag): SheetSize | 'closed' {
  const down = vy > FLICK || dy > STEP;
  const up = vy < -FLICK || dy < -STEP;

  if (down) return 'closed';
  return up && canGrow ? 'full' : size;
}

/**
 * How far the sheet may follow a finger, given the room it has above it.
 *
 * Downwards it is unbounded — that gesture ends in a dismissal. Upwards it
 * stops dead at the tallest detent. Letting it run past was worth a quarter of
 * the screen of overshoot on release, and the snap back from there is most of
 * what read as jank; the Claude app's sheet does not budge past its own ceiling
 * either.
 */
export function clampDrag(dy: number, headroom: number): number {
  const limit = Math.max(0, headroom);
  if (dy >= -limit) return dy;
  // Spelt out rather than `Math.max`, which answers `-0` here and leaves every
  // caller to know that `-0 !== 0` under `Object.is`.
  return limit === 0 ? 0 : -limit;
}

/**
 * The two detents, in points, given the room there is.
 *
 * `medium` has to be visibly smaller than `full` or the grip has nothing to do,
 * and `full` leaves a strip of dimmed backdrop above it — the tap target for
 * getting out, which must stay reachable however long the content is.
 */
export function detents(available: number): Record<SheetSize, number> {
  return {
    // Roomy enough that opening one is not a step backwards from the sheet that
    // filled the screen, and still a visible step short of `full`.
    medium: Math.max(240, available * 0.68),
    full: available * 0.94,
  };
}

/**
 * The spring the sheet settles on, shared by every detent change so they all
 * feel like the same object moving. Measured against the Claude app's sheet:
 * about 27 frames from one detent to the other, decelerating the whole way,
 * never overshooting.
 */
export const SETTLE = { stiffness: 260, damping: 28, mass: 1 } as const;
