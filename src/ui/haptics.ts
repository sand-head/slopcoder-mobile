/**
 * The few moments that deserve a tap under the thumb.
 *
 * A native toggle vibrates on its own; the buttons this app draws do not, so
 * the ones that change something real — approve, deny, stop, delete — say so
 * through the glass. Nothing here fires for navigation or for reads: a haptic
 * on every press is the same as none.
 */
import { trigger } from 'react-native-haptic-feedback';

const options = { enableVibrateFallback: false, ignoreAndroidSystemSettings: false };

/** A choice was made: approve, answer, send. */
export function tapConfirm(): void {
  trigger('impactMedium', options);
}

/** Something was refused or stopped. */
export function tapRefuse(): void {
  trigger('impactHeavy', options);
}

/** Something finished well. */
export function tapSuccess(): void {
  trigger('notificationSuccess', options);
}

/** Something went wrong. */
export function tapError(): void {
  trigger('notificationError', options);
}

/** A selection changed: a segment, a row in a picker. */
export function tapSelect(): void {
  trigger('selection', options);
}
