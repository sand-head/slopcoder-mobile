/**
 * A bottom sheet of grouped rows.
 *
 * The web puts these choices in a dropdown menu, which is a pointer's idea of a
 * menu. On a phone the same content wants to come up from the bottom, inside
 * thumb reach, with rows big enough to hit — so the arrangement follows the
 * platform while the content follows `TurnSettings`.
 *
 * **The drag target is outside the glass, and that is the point of it.**
 * `GlassSurface` is a `UIVisualEffectView` on iOS 26, and `UIGlassEffect`
 * reconfigures its `contentView` in ways that can leave
 * `isUserInteractionEnabled` off — @callstack/liquid-glass carries a workaround
 * for exactly that, forcing it back on, with a comment about children mounting
 * after the effect is applied. Taps on the close button survived it; drags did
 * not, through two releases. So the strip that listens for the drag is a
 * sibling of the glass rather than a child of it, painted over the grip, and it
 * claims the responder on touch-down rather than negotiating on the first move.
 *
 * **The animation is JS-driven on purpose.** Three values compose into one
 * transform — the entrance, the finger, the keyboard — and a graph that mixes
 * native and JS nodes fails by doing nothing rather than by raising anything.
 * One view moving is not the place to spend that risk.
 *
 * **It opens at the smaller detent.** A sheet that opens at its largest size
 * has nowhere to be dragged, which is how the first attempt shipped a grip that
 * answered every gesture and moved nothing.
 *
 * The scroll view's `flexShrink: 1` is a belt rather than a fix: React Native
 * defaults it to 0 where the web defaults to 1. This sheet measures correctly
 * either way — the bottom padding under a clipped row is exactly
 * `insets.bottom + 12` on a real device — but the constraint is written down so
 * it does not depend on which ancestor happens to bound the list.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Check, GlassSurface, Meta, Mono } from './kit';
import { clampDrag, detents, settleSheet, type SheetSize } from './sheetDrag';
import { mix, radius, useTheme } from '../theme';

export interface SheetOption {
  key: string;
  label: string;
  /** The line underneath — what the choice means, not a restatement of it. */
  description?: string;
}

/** How long the sheet takes to arrive, when the keyboard is not setting the pace. */
const TRAVEL_MS = 260;

/**
 * The drag strip: a thumb's worth of it, starting clear of the close button so
 * that tapping × still closes rather than starting a gesture that goes nowhere.
 * The button sits at x 16..48 and carries a 10pt hit slop, so 60 clears it.
 */
const GRIP_HEIGHT = 56;
const GRIP_CLEARANCE = 60;

/** What the keyboard is doing, so the sheet can do it at the same speed. */
interface KeyboardState {
  height: number;
  duration: number;
}

function useKeyboard(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({ height: 0, duration: TRAVEL_MS });

  useEffect(() => {
    // iOS reports the frame *before* the animation runs and says how long it
    // will take, which is what lets the sheet travel with the keyboard rather
    // than jump after it. Android only has the `Did` events.
    const ios = Platform.OS === 'ios';
    const shown = ios ? 'keyboardWillShow' : 'keyboardDidShow';
    const hidden = ios ? 'keyboardWillHide' : 'keyboardDidHide';

    const on = Keyboard.addListener(shown, event =>
      setState({ height: event.endCoordinates.height, duration: event.duration || TRAVEL_MS }),
    );
    const off = Keyboard.addListener(hidden, event =>
      setState({ height: 0, duration: event.duration || TRAVEL_MS }),
    );

    return () => {
      on.remove();
      off.remove();
    };
  }, []);

  return state;
}

export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboard = useKeyboard();

  // Held open through the closing animation: with the modal doing none of its
  // own, unmounting on `visible` would cut the exit off at the first frame.
  const [mounted, setMounted] = useState(visible);
  const [size, setSize] = useState<SheetSize>('medium');
  /** Whether a finger is on the grip. Visible, so the affordance answers. */
  const [held, setHeld] = useState(false);

  const cap = detents(windowHeight - insets.top - keyboard.height)[size];

  /** 0 closed, 1 open. Drives the travel and the backdrop together. */
  const enter = useRef(new Animated.Value(0)).current;
  /** Where the finger has the sheet, relative to where it rests. */
  const drag = useRef(new Animated.Value(0)).current;
  /** How far up the keyboard is holding it. */
  const lift = useRef(new Animated.Value(0)).current;

  // Read by the pan responder, which is built once and cannot see state move.
  const sizeRef = useRef<SheetSize>('medium');
  sizeRef.current = size;
  const canGrow = useRef(false);
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  const measure = () => {
    canGrow.current = contentHeight.current > viewportHeight.current + 1;
  };

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setSize('medium');
      drag.setValue(0);
      Animated.timing(enter, {
        toValue: 1,
        duration: TRAVEL_MS,
        useNativeDriver: false,
      }).start();
      return;
    }

    Animated.timing(enter, { toValue: 0, duration: TRAVEL_MS, useNativeDriver: false }).start(
      ({ finished }) => {
        if (finished) setMounted(false);
      },
    );
  }, [visible, enter, drag]);

  useEffect(() => {
    Animated.timing(lift, {
      toValue: -keyboard.height,
      duration: keyboard.duration,
      useNativeDriver: false,
    }).start();
  }, [keyboard, lift]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claimed on touch-down, not negotiated on the first move. The strip
        // exists only to be dragged, so there is nothing to hand it to, and
        // move-negotiation is one more thing that has to work.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => setHeld(true),
        onPanResponderMove: (_event, gesture) =>
          drag.setValue(clampDrag(gesture.dy, canGrow.current || sizeRef.current === 'full')),
        onPanResponderRelease: (_event, gesture) => {
          setHeld(false);

          const next = settleSheet({
            size: sizeRef.current,
            dy: gesture.dy,
            vy: gesture.vy,
            canGrow: canGrow.current,
          });

          if (next === 'closed') {
            // `onClose` runs the exit animation from wherever the finger left
            // the sheet, so there is nothing to animate here.
            onCloseRef.current();
            return;
          }

          setSize(next);
          Animated.spring(drag, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
        },
        onPanResponderTerminate: () => setHeld(false),
      }),
    [drag],
  );

  const travel = Animated.add(
    enter.interpolate({ inputRange: [0, 1], outputRange: [windowHeight, 0] }),
    Animated.add(drag, lift),
  );

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* Fades in place. Sliding it is what put a moving horizontal edge
            across the screen every time a sheet opened. */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: enter }]}>
          <Pressable
            accessibilityLabel="Close"
            onPress={onClose}
            style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
          />
        </Animated.View>

        <Animated.View style={{ maxHeight: cap, transform: [{ translateY: travel }] }}>
          <GlassSurface
            cornerRadius={radius.xxl}
            style={{
              // Only the top corners round: the sheet is anchored to the edge.
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              // The keyboard covers the home indicator, so the inset it stands
              // clear of is gone while the keyboard is up.
              paddingBottom: keyboard.height > 0 ? 12 : insets.bottom + 12,
              flexShrink: 1,
            }}>
            <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}>
              <View
                style={{
                  width: held ? 52 : 36,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: c.mutedForeground,
                  opacity: held ? 0.9 : 0.4,
                }}
              />
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 10,
              }}>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                style={({ pressed }) => ({
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: mix(c.mutedForeground, 15),
                  opacity: pressed ? 0.6 : 1,
                })}>
                <Body style={{ color: c.foreground, fontSize: 15 }}>×</Body>
              </Pressable>
              <Body style={{ flex: 1, textAlign: 'center', fontSize: 16 }}>{title}</Body>
              {/* Balances the close button so the title sits centred. */}
              <View style={{ width: 32 }} />
            </View>

            <ScrollView
              // Explicit, not load-bearing: see the note at the top of the file
              // about React Native's `flexShrink` default.
              style={{ flexShrink: 1 }}
              // A tap on a result while the keyboard is up must pick it, not
              // spend itself dismissing the keyboard.
              keyboardShouldPersistTaps="handled"
              onLayout={event => {
                viewportHeight.current = event.nativeEvent.layout.height;
                measure();
              }}
              onContentSizeChange={(_width, height) => {
                contentHeight.current = height;
                measure();
              }}
              contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 14 }}>
              {children}
            </ScrollView>
          </GlassSurface>

          {/* Last child, so it paints over the glass rather than inside it —
              see the note at the top of the file. Starts clear of the close
              button, and covers only the title, which nothing taps. */}
          <View
            {...pan.panHandlers}
            accessibilityLabel="Resize"
            style={{
              position: 'absolute',
              top: 0,
              left: GRIP_CLEARANCE,
              right: GRIP_CLEARANCE,
              height: GRIP_HEIGHT,
            }}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * A scale, laid out as one. Six full rows for thinking pushed approvals below
 * the fold and left facet barely on screen — and the options are not unrelated
 * choices, they are one dial from off to max, which reads better along an axis
 * than down a list.
 */
export function SheetSegments({
  label,
  options,
  selected,
  onSelect,
}: {
  label?: string;
  options: SheetOption[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  const { c } = useTheme();

  return (
    <View style={{ gap: 6 }}>
      {label ? <Meta>{label}</Meta> : null}
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: mix(c.mutedForeground, 12),
          borderRadius: radius.md,
          padding: 3,
          gap: 3,
        }}>
        {options.map(option => {
          const on = selected === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => onSelect(option.key)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 34,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.sm,
                backgroundColor: on ? c.card : pressed ? mix(c.mutedForeground, 10) : 'transparent',
                borderWidth: on ? 1 : 0,
                borderColor: c.border,
              })}>
              <Mono
                numberOfLines={1}
                style={{ fontSize: 11.5, color: on ? c.foreground : c.mutedForeground }}>
                {option.label}
              </Mono>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The same card, but choices that stack rather than replace each other —
 * repositories and nodes, where picking one does not unpick the last.
 */
export function SheetMultiGroup({
  label,
  options,
  selected,
  onToggle,
  empty,
}: {
  label?: string;
  options: SheetOption[];
  selected: string[];
  onToggle: (key: string) => void;
  empty?: string;
}) {
  const { c } = useTheme();

  if (options.length === 0) {
    return empty ? (
      <View style={{ gap: 6 }}>
        {label ? <Meta>{label}</Meta> : null}
        <Mono>{empty}</Mono>
      </View>
    ) : null;
  }

  return (
    <View style={{ gap: 6 }}>
      {label ? <Meta>{label}</Meta> : null}
      <View
        style={{
          backgroundColor: c.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: c.border,
          overflow: 'hidden',
        }}>
        {options.map((option, index) => (
          <Pressable
            key={option.key}
            onPress={() => onToggle(option.key)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              minHeight: 52,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: c.border,
              backgroundColor: pressed ? mix(c.mutedForeground, 10) : 'transparent',
            })}>
            <View style={{ flex: 1, gap: 2 }}>
              <Body numberOfLines={1} style={{ fontSize: 14.5 }}>
                {option.label}
              </Body>
              {option.description ? (
                <Mono numberOfLines={1} style={{ fontSize: 11.5 }}>
                  {option.description}
                </Mono>
              ) : null}
            </View>
            {selected.includes(option.key) ? <Check color={c.primary} /> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** One grouped card of choices, hairline-separated, with a tick on the current one. */
export function SheetGroup({
  label,
  options,
  selected,
  onSelect,
}: {
  label?: string;
  options: SheetOption[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  const { c } = useTheme();

  return (
    <View style={{ gap: 6 }}>
      {label ? <Meta>{label}</Meta> : null}
      <View
        style={{
          backgroundColor: c.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: c.border,
          overflow: 'hidden',
        }}>
        {options.map((option, index) => (
          <Pressable
            key={option.key}
            onPress={() => onSelect(option.key)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              minHeight: 56,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: c.border,
              backgroundColor: pressed ? mix(c.mutedForeground, 10) : 'transparent',
            })}>
            <View style={{ flex: 1, gap: 2 }}>
              <Body style={{ fontSize: 15 }}>{option.label}</Body>
              {option.description ? (
                <Mono numberOfLines={2} style={{ fontSize: 12 }}>
                  {option.description}
                </Mono>
              ) : null}
            </View>
            {selected === option.key ? <Check color={c.primary} /> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
