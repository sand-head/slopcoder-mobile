/**
 * A bottom sheet of grouped rows.
 *
 * The web puts these choices in a dropdown menu, which is a pointer's idea of a
 * menu. On a phone the same content wants to come up from the bottom, inside
 * thumb reach, with rows big enough to hit — so the arrangement follows the
 * platform while the content follows `TurnSettings`.
 *
 * Three things here are not decoration, and all three were broken on a phone:
 *
 * - **The sheet has to clear the keyboard.** It is anchored to the bottom edge,
 *   which is exactly where the keyboard goes, so a sheet with a search field in
 *   it hid its own results the moment you typed.
 * - **The grip has to do something.** It is the one part of a sheet that says
 *   "you may drag me", and it was a rounded rectangle.
 *
 * The scroll view's `flexShrink: 1` is a belt rather than a fix. React Native
 * defaults `flexShrink` to 0 where the web defaults to 1, which is the usual
 * reason a `ScrollView` in a capped column lays out at its full content height
 * and overflows instead of scrolling — but this sheet was scrolling fine, and
 * the frames I took for a clipped last row were a mid-scroll. Stated explicitly
 * so the constraint does not depend on which ancestor happens to bound it.
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
import { clampDrag, settleSheet, type SheetSize } from './sheetDrag';
import { mix, radius, useTheme } from '../theme';

export interface SheetOption {
  key: string;
  label: string;
  /** The line underneath — what the choice means, not a restatement of it. */
  description?: string;
}

/**
 * How much of the space above the keyboard a sheet may take. The remainder is
 * the strip of dimmed backdrop you tap to get out, which has to stay reachable
 * however long the content is.
 */
const MAX_FRACTION = 0.9;

/** How much room the keyboard is taking, tracked so the sheet can sit above it. */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS reports the frame before the animation runs, so the sheet moves with
    // the keyboard rather than after it. Android only has the `Did` events.
    const shown = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hidden = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const on = Keyboard.addListener(shown, event => setHeight(event.endCoordinates.height));
    const off = Keyboard.addListener(hidden, () => setHeight(0));

    return () => {
      on.remove();
      off.remove();
    };
  }, []);

  return height;
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
  const keyboard = useKeyboardHeight();

  const [size, setSize] = useState<SheetSize>('natural');
  // The pan responder is built once and has to read state that moves, so what
  // it reads lives in refs rather than in the closure it was created with.
  const sizeRef = useRef<SheetSize>('natural');
  sizeRef.current = size;

  /**
   * Whether anything is hidden below the fold, which is the only reason to
   * offer a taller sheet: content against viewport, both measured, so a sheet
   * showing all of itself refuses to grow into empty glass.
   */
  const canExpand = useRef(false);
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  const measure = () => {
    canExpand.current = contentHeight.current > viewportHeight.current + 1;
  };

  const sheetHeight = useRef(0);
  const drag = useRef(new Animated.Value(0)).current;

  const maxHeight = Math.max(240, (windowHeight - insets.top - keyboard) * MAX_FRACTION);

  // Every opening starts from the same place, however the last one ended.
  useEffect(() => {
    if (visible) {
      setSize('natural');
      drag.setValue(0);
    }
  }, [visible, drag]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Only once it is clearly a drag: a tap on the grip is not a gesture,
        // and the close button lives in the same row.
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 4,
        onPanResponderMove: (_event, gesture) =>
          drag.setValue(clampDrag(gesture.dy, canExpand.current)),
        onPanResponderRelease: (_event, gesture) => {
          const next = settleSheet({
            size: sizeRef.current,
            dy: gesture.dy,
            vy: gesture.vy,
            canExpand: canExpand.current,
          });

          if (next === 'closed') {
            // Out of the way first, so the modal's own slide-out has nothing
            // left to animate and the sheet does not jump back up on the way.
            Animated.timing(drag, {
              toValue: sheetHeight.current || windowHeight,
              duration: 160,
              useNativeDriver: true,
            }).start(() => {
              drag.setValue(0);
              onClose();
            });
            return;
          }

          setSize(next);
          Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        },
      }),
    [drag, onClose, windowHeight],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* A sibling rather than a parent: a backdrop wrapped around the sheet
            has to un-handle every touch the sheet wanted, and this one does
            not have to. */}
        <Pressable
          accessibilityLabel="Close"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
        />

        <Animated.View
          onLayout={event => {
            sheetHeight.current = event.nativeEvent.layout.height;
          }}
          style={{
            maxHeight,
            height: size === 'full' ? maxHeight : undefined,
            marginBottom: keyboard,
            transform: [{ translateY: drag }],
          }}>
          <GlassSurface
            cornerRadius={radius.xxl}
            style={{
              // Only the top corners round: the sheet is anchored to the edge.
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              // The keyboard covers the home indicator, so the inset it stands
              // clear of is gone while the keyboard is up.
              paddingBottom: keyboard > 0 ? 12 : insets.bottom + 12,
              flexShrink: 1,
            }}>
            <View {...pan.panHandlers}>
              <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}>
                <View
                  style={{
                    width: 36,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: c.mutedForeground,
                    opacity: 0.4,
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
            </View>

            <ScrollView
              // Explicit, not load-bearing today: see the note at the top of the
              // file about React Native's `flexShrink` default.
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
