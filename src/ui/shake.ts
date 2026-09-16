/**
 * Shake the phone.
 *
 * Shake is the right gesture for the terminal because the terminal is not part
 * of the screen it appears over. Everything the cockpit shows is the agent's
 * account of what it did; the terminal is the machine itself, wanted exactly
 * when that account stops being enough. A button for it would sit there being
 * ignored for whole sessions and taking up the only bar this screen has. A
 * shake costs nothing until you need it — which is also, on iOS, the argument
 * the system already makes for undo.
 *
 * The detection is native on both platforms and deliberately different on each:
 * `ShakeWindow.swift` takes UIKit's motion event, `ShakeModule.kt` watches the
 * accelerometer because Android offers nothing else. Both arrive here as one
 * `shake` event.
 *
 * The listener is registered only while a screen actually wants it. On Android
 * that is not a nicety — subscribing is what opens the sensor.
 */
import { useEffect, useRef } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

interface ShakeNative {
  start: () => void;
  stop: () => void;
}

const native: ShakeNative | undefined = NativeModules.ShakeDetector;

/**
 * Call `onShake` when the phone is shaken, while `enabled`.
 *
 * The callback is held in a ref so that a caller who passes a fresh closure
 * every render — which is every caller — does not tear the native listener down
 * and set it up again on each one. On Android that would be unregistering and
 * re-registering a sensor several times a second.
 */
export function useShake(enabled: boolean, onShake: () => void): void {
  const handler = useRef(onShake);
  handler.current = onShake;

  useEffect(() => {
    if (!enabled || !native) return;

    // A dev build without the native module rebuilt would otherwise throw here
    // rather than simply not having the gesture.
    const emitter = new NativeEventEmitter(
      // iOS routes through the module itself (RCTEventEmitter); Android emits on
      // the device-wide emitter, which takes no argument.
      Platform.OS === 'ios' ? (NativeModules.ShakeDetector as never) : undefined,
    );
    const subscription = emitter.addListener('shake', () => handler.current());
    native.start();

    return () => {
      native.stop();
      subscription.remove();
    };
  }, [enabled]);
}

/** Whether this build has the native side at all, for anything that must say so. */
export const shakeAvailable = native !== undefined;
