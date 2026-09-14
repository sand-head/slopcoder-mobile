/**
 * How tall the keyboard is right now, for a control that floats above it.
 *
 * `KeyboardAvoidingView` pads its own bottom, which moves its flow children
 * up and moves an absolutely positioned child not at all: Yoga, like the web,
 * places `bottom: 0` at the parent's edge and ignores its padding. The
 * cockpit's composer floats over the transcript, so the avoiding view lifted
 * the transcript and left the composer under the keyboard. This hands the
 * height to the caller, who puts it in the one style it belongs in.
 *
 * On iOS the reported frame includes the home indicator's strip, so a control
 * sitting on the keyboard needs no bottom inset while it is up. Android
 * resizes the window itself (`adjustResize`), which moves everything at once;
 * there the answer is always zero.
 */
import { useEffect, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform } from 'react-native';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const shown = Keyboard.addListener('keyboardWillShow', event => {
      // Move with the keyboard, on its curve, rather than jumping ahead of it.
      LayoutAnimation.configureNext(
        LayoutAnimation.create(event.duration || 250, 'keyboard', 'opacity'),
      );
      setHeight(event.endCoordinates.height);
    });
    const hidden = Keyboard.addListener('keyboardWillHide', event => {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(event.duration || 250, 'keyboard', 'opacity'),
      );
      setHeight(0);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return height;
}
