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

  // One rung at a time: down from full returns to medium rather than
  // dismissing, so a fat-fingered drag never loses your place in a list.
  if (size === 'full') return down ? 'medium' : 'full';
  if (down) return 'closed';
  return up && canGrow ? 'full' : 'medium';
}

/**
 * How far the sheet may follow a finger.
 *
 * Downwards it is unbounded — that gesture ends in a dismissal. Upwards it
 * stops at nothing when there is nowhere to go, because a sheet that lifts off
 * the bottom of the screen and springs back looks like a bug rather than a
 * refusal.
 */
export function clampDrag(dy: number, canGrow: boolean): number {
  if (dy >= 0) return dy;
  return canGrow ? dy : 0;
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
