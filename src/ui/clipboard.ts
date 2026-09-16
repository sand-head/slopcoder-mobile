/**
 * Copying, with the tap you feel when it lands.
 *
 * A phone has no console and no mouse, so a transcript you cannot get text out
 * of is a transcript you have to retype. Everything that holds text worth
 * carrying elsewhere — a prompt, a reply, a command in a fence, a tool's output
 * — goes through here.
 *
 * `Clipboard` comes from React Native's core, where it is deprecated and still
 * shipped: `RCTClipboard.mm` and `ClipboardModule.kt` are both in 0.87, so it
 * works today and costs no native dependency, which was the point — the
 * alternative is another pod on a build that has been fragile enough lately.
 * When it does go, this is the one file that changes: swap the import for
 * `@react-native-clipboard/clipboard`, which has the same two methods.
 */
import { Clipboard } from 'react-native';
import { tapSelect } from './haptics';

/**
 * Put text on the pasteboard, and say so with the selection tap.
 *
 * iOS does not toast a copy and neither should we; the haptic is the whole
 * acknowledgement, and it is the one the platform's own copy gestures give.
 * Empty text is not an error, it is nothing to copy — silently doing nothing
 * beats clearing whatever the pasteboard already held.
 */
export function copyText(text: string | null | undefined): void {
  const value = text?.trim();
  if (!value) return;
  Clipboard.setString(value);
  tapSelect();
}
