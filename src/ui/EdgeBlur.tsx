/**
 * The blur behind the session header, on iOS only.
 *
 * A native view of the app's own (ios/slopcoder_mobile/EdgeBlur): the system
 * material over whatever scrolls under it, masked to fade out toward its lower
 * edge — what iOS 26's scroll-edge effect looks like, which the system only
 * draws under its own navigation bar. Everywhere else — Android, iOS before
 * 26, Reduce Transparency — the header keeps its painted fade instead, and this
 * module never asks for the native view, so nothing on those paths depends on
 * it existing.
 */
import React from 'react';
import { Platform, requireNativeComponent, StyleSheet, type ViewProps } from 'react-native';

/** How far the blur runs below the header, so its soft edge falls past the capsules. */
export const EDGE_BLUR_OVERHANG = 18;

/**
 * Whether the header draws the native blur. The fade is the fallback in every
 * other case; the decision is pure so it can be tested on its own.
 */
export function edgeBlurEnabled({ os, glassAvailable }: { os: string; glassAvailable: boolean }): boolean {
  return os === 'ios' && glassAvailable;
}

// Resolved lazily and only on iOS: Android has no such view, and asking for an
// unregistered native component is an error there.
let NativeEdgeBlur: React.ComponentType<ViewProps> | null = null;
function native(): React.ComponentType<ViewProps> {
  if (!NativeEdgeBlur) NativeEdgeBlur = requireNativeComponent<ViewProps>('SlopEdgeBlur');
  return NativeEdgeBlur;
}

/** The backdrop itself: fills its parent and runs {@link EDGE_BLUR_OVERHANG} below it. */
export function EdgeBlurBackdrop() {
  if (Platform.OS !== 'ios') return null;
  const Native = native();
  return (
    <Native
      testID="edge-blur"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { bottom: -EDGE_BLUR_OVERHANG }]}
    />
  );
}
