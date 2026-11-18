/**
 * A private image artifact at full size, with the gestures a photo viewer is
 * expected to have. Reanimated keeps every frame on the UI thread; the image's
 * bearer-authenticated request is the same one the old fixed thumbnail made.
 */
import React from 'react';
import { Image, type ImageSourcePropType } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const MAX_SCALE = 5;

function clamp(value: number, low: number, high: number): number {
  'worklet';
  return Math.min(high, Math.max(low, value));
}

export function ZoomableImage({
  source,
  accessibilityLabel,
  testID,
}: {
  source: ImageSourcePropType;
  accessibilityLabel: string;
  testID?: string;
}) {
  const scale = useSharedValue(1);
  const settledScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const settledX = useSharedValue(0);
  const settledY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const intrinsicWidth = useSharedValue(0);
  const intrinsicHeight = useSharedValue(0);

  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    settledScale.value = 1;
    x.value = withTiming(0);
    y.value = withTiming(0);
    settledX.value = 0;
    settledY.value = 0;
  };

  const fittedWidth = () => {
    'worklet';
    if (width.value === 0 || height.value === 0 || intrinsicWidth.value === 0 || intrinsicHeight.value === 0) return 0;
    const fit = Math.min(width.value / intrinsicWidth.value, height.value / intrinsicHeight.value);
    return intrinsicWidth.value * fit;
  };

  const fittedHeight = () => {
    'worklet';
    if (width.value === 0 || height.value === 0 || intrinsicWidth.value === 0 || intrinsicHeight.value === 0) return 0;
    const fit = Math.min(width.value / intrinsicWidth.value, height.value / intrinsicHeight.value);
    return intrinsicHeight.value * fit;
  };

  const constrain = () => {
    'worklet';
    // Bound the contain-fitted image, not its letterboxed container: a wide
    // photo must not acquire vertical pan room that is only black background.
    const maxX = Math.max(0, (fittedWidth() * scale.value - width.value) / 2);
    const maxY = Math.max(0, (fittedHeight() * scale.value - height.value) / 2);
    x.value = clamp(x.value, -maxX, maxX);
    y.value = clamp(y.value, -maxY, maxY);
    settledX.value = x.value;
    settledY.value = y.value;
  };

  const pinch = Gesture.Pinch()
    .onUpdate(event => {
      scale.value = clamp(settledScale.value * event.scale, 1, MAX_SCALE);
      constrain();
    })
    .onEnd(() => {
      settledScale.value = scale.value;
      if (scale.value < 1.05) reset();
      else constrain();
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .onBegin(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate(event => {
      if (scale.value <= 1) return;
      const maxX = Math.max(0, (fittedWidth() * scale.value - width.value) / 2);
      const maxY = Math.max(0, (fittedHeight() * scale.value - height.value) / 2);
      x.value = clamp(startX.value + event.translationX, -maxX, maxX);
      y.value = clamp(startY.value + event.translationY, -maxY, maxY);
    })
    .onEnd(() => {
      settledX.value = x.value;
      settledY.value = y.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (settledScale.value > 1 || scale.value > 1) {
        reset();
      } else {
        settledScale.value = 2;
        scale.value = withTiming(2);
        x.value = 0;
        y.value = 0;
        settledX.value = 0;
        settledY.value = 0;
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <GestureHandlerRootView
      testID={testID}
      style={{ flex: 1, overflow: 'hidden', backgroundColor: '#000' }}
      onLayout={event => {
        width.value = event.nativeEvent.layout.width;
        height.value = event.nativeEvent.layout.height;
        constrain();
      }}>
      <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
        <Animated.View style={[{ flex: 1 }, animatedStyle]}>
          <Image
            source={source}
            accessibilityLabel={accessibilityLabel}
            accessibilityHint="Pinch or double tap to zoom. Drag to pan when zoomed."
            onLoad={event => {
              intrinsicWidth.value = event.nativeEvent.source.width;
              intrinsicHeight.value = event.nativeEvent.source.height;
              constrain();
            }}
            resizeMode="contain"
            style={{ width: '100%', height: '100%' }}
          />
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}
