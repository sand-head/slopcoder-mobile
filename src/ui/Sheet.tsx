/**
 * A bottom sheet of grouped rows.
 *
 * The web puts these choices in a dropdown menu, which is a pointer's idea of a
 * menu. On a phone the same content wants to come up from the bottom, inside
 * thumb reach, with rows big enough to hit — so the arrangement follows the
 * platform while the content follows `TurnSettings`.
 *
 * **Detents move the sheet; they never resize it.** The box is laid out once at
 * its tallest and pushed down to show less, so changing detent is one transform
 * and no layout at all. Capping the height per detent instead — which is the
 * obvious way to write this — meant every release did a layout pass and a
 * spring at the same time, and the two disagreed: measured off a recording, the
 * sheet overshot a quarter of the screen past its target, sat still for eight
 * frames, then crawled back. The bottom of the sheet hangs off the screen at
 * the shorter detent, which is exactly what the Claude app's sheets do.
 *
 * **The drag target is outside the glass, and that is the point of it.**
 * `GlassSurface` is a `UIVisualEffectView` on iOS 26, and `UIGlassEffect`
 * reconfigures its `contentView` in ways that can leave
 * `isUserInteractionEnabled` off — @callstack/liquid-glass carries a workaround
 * for exactly that, with a comment about children mounting after the effect is
 * applied. Taps on the close button survived it; drags did not, through two
 * releases. So the strip that listens is a sibling of the glass rather than a
 * child, painted over the grip, and it claims the responder on touch-down
 * rather than negotiating on the first move.
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
import { clampDrag, detents, SETTLE, settleSheet, type SheetSize } from './sheetDrag';
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
  /** The sheet as laid out, which is what the detents are measured against. */
  const [height, setHeight] = useState(0);

  const room = detents(windowHeight - insets.top - keyboard.height);
  /** How far down the sheet sits to show the shorter detent. */
  const lowered = Math.max(0, Math.min(height, room.full) - room.medium);
  const restingAt = size === 'medium' ? lowered : 0;

  /** 0 closed, 1 open. Drives the travel and the backdrop together. */
  const enter = useRef(new Animated.Value(0)).current;
  /** Where the sheet is, resting or dragged. One value: a gesture folds into it. */
  const offset = useRef(new Animated.Value(0)).current;
  /** How far up the keyboard is holding it. */
  const lift = useRef(new Animated.Value(0)).current;

  // Read by the pan responder, which is built once and cannot see state move.
  const sizeRef = useRef<SheetSize>('medium');
  sizeRef.current = size;
  const restingRef = useRef(0);
  const loweredRef = useRef(0);
  loweredRef.current = lowered;
  /** When the sheet started arriving, so its first placement is not animated. */
  const openedAt = useRef(0);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setSize('medium');
      openedAt.current = Date.now();
      Animated.timing(enter, {
        toValue: 1,
        duration: TRAVEL_MS,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(enter, { toValue: 0, duration: TRAVEL_MS, useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) setMounted(false);
      },
    );
  }, [visible, enter]);

  // Where the sheet rests, and how it gets there. While it is still arriving it
  // is *placed* rather than moved — the first detent is decided by a layout
  // pass that lands mid-entrance, and springing to it would be an animation
  // nobody asked for, layered under the one they did.
  useEffect(() => {
    restingRef.current = restingAt;

    if (Date.now() - openedAt.current < TRAVEL_MS) {
      offset.setValue(restingAt);
      return;
    }

    Animated.spring(offset, { toValue: restingAt, useNativeDriver: true, ...SETTLE }).start();
  }, [restingAt, offset]);

  useEffect(() => {
    Animated.timing(lift, {
      toValue: -keyboard.height,
      duration: keyboard.duration,
      useNativeDriver: true,
    }).start();
  }, [keyboard, lift]);

  /** The gesture itself, wherever it started. */
  const dragging = useMemo(
    () => ({
      move: (dy: number) => offset.setValue(restingRef.current + clampDrag(dy, restingRef.current)),
      release: (dy: number, vy: number) => {
        const next = settleSheet({
          size: sizeRef.current,
          dy,
          vy,
          canGrow: loweredRef.current > 1,
        });

        if (next === 'closed') {
          // The exit runs from wherever the finger left the sheet, because
          // `offset` is where the finger left it.
          onCloseRef.current();
          return;
        }

        if (next === sizeRef.current) {
          // Same detent, so nothing re-renders and nothing else will put it back.
          Animated.spring(offset, {
            toValue: restingRef.current,
            useNativeDriver: true,
            ...SETTLE,
          }).start();
          return;
        }

        setSize(next);
      },
    }),
    [offset],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claimed on touch-down, not negotiated on the first move. The strip
        // exists only to be dragged, so there is nothing to hand it to, and
        // move-negotiation is one more thing that has to work.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => setHeld(true),
        onPanResponderMove: (_event, gesture) => dragging.move(gesture.dy),
        onPanResponderRelease: (_event, gesture) => {
          setHeld(false);
          dragging.release(gesture.dy, gesture.vy);
        },
        onPanResponderTerminate: () => setHeld(false),
      }),
    [dragging],
  );

  /**
   * The same drag, started anywhere in the body.
   *
   * A native sheet at its short detent does not scroll its content — a pull
   * anywhere opens it, and only once it is open does the list start to move.
   * The list is told not to scroll at the short detent, so it declines the
   * gesture and this ancestor picks it up; on start it declines too, which is
   * what leaves taps on the rows to the rows.
   */
  const body = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          sizeRef.current === 'medium' && Math.abs(gesture.dy) > 4,
        onPanResponderMove: (_event, gesture) => dragging.move(gesture.dy),
        onPanResponderRelease: (_event, gesture) => dragging.release(gesture.dy, gesture.vy),
      }),
    [dragging],
  );

  const travel = Animated.add(
    enter.interpolate({ inputRange: [0, 1], outputRange: [windowHeight, 0] }),
    Animated.add(offset, lift),
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

        <Animated.View
          {...body.panHandlers}
          onLayout={event => setHeight(event.nativeEvent.layout.height)}
          style={{ maxHeight: room.full, transform: [{ translateY: travel }] }}>
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
              // At the short detent the sheet moves instead of the list, which
              // is what a native sheet does and is the difference between
              // opening a panel and scrolling a letterbox.
              scrollEnabled={size === 'full'}
              // Explicit, not load-bearing: see the note at the top of the file
              // about React Native's `flexShrink` default.
              style={{ flexShrink: 1 }}
              // A tap on a result while the keyboard is up must pick it, not
              // spend itself dismissing the keyboard.
              keyboardShouldPersistTaps="handled"
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
