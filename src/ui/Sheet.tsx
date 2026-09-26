/**
 * A bottom sheet of grouped rows.
 *
 * The web puts these choices in a dropdown menu, which is a pointer's idea of a
 * menu. On a phone the same content wants to come up from the bottom, inside
 * thumb reach, with rows big enough to hit — so the arrangement follows the
 * platform while the content follows `TurnSettings`.
 *
 * **The sheet itself is the platform's.** `TrueSheet` wraps
 * `UISheetPresentationController`, so the detents, the grabber, the rubber-band
 * at the top, the dismiss gesture, the keyboard avoidance and the
 * scroll-to-expand are all the ones every other app on the phone has. The
 * hand-rolled version that used to live here took five releases to get half of
 * that far: a `UIVisualEffectView` swallowed the drag, two detents resolved to
 * the same height, the box was resized per detent so a layout pass and a spring
 * disagreed about where the sheet was, and a pull in the body scrolled a
 * letterbox instead of opening the sheet. Every one of those is a solved
 * problem in UIKit and none of them was worth solving again.
 *
 * What is left here is the content: a header row and a list, which is all this
 * ever wanted to be.
 *
 * **Nothing below configures the sheet itself.** The first pass at this still
 * set four props the component already had opinions about, and one of them was
 * a real fault: `detents={['auto', 1]}` puts a *content-measured* detent at
 * rest, so the sheet settled, sat for a fifth of a second, then stepped 65px
 * when the list re-measured — and with a long list `auto` clamps to the
 * container, which is where `1` already is, leaving two detents at the same
 * height and nothing to drag between. The others were merely redundant:
 * `grabber` defaults to true, and `cornerRadius` and `backgroundColor` default
 * to the system's. A prop here has to earn itself.
 */
import React, { useEffect, useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { Body, Check, GitMark, Meta, Mono } from './kit';
import type { GitServiceKind } from '../api/contracts';
import { mix, radius, useTheme } from '../theme';

export interface SheetOption {
  key: string;
  label: string;
  /** The line underneath — what the choice means, not a restatement of it. */
  description?: string;
  /**
   * A repository row's forge mark, when the option is a repository. Undefined
   * on anything else (nodes, models) so those rows carry no icon slot at all.
   */
  kind?: GitServiceKind | null;
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
  const sheet = useRef<TrueSheet>(null);

  // The sheet stays mounted and the native presentation follows `visible`,
  // which keeps every call site the plain boolean it already was.
  useEffect(() => {
    if (visible) void sheet.current?.present().catch(() => {});
    else void sheet.current?.dismiss().catch(() => {});
  }, [visible]);

  return (
    <TrueSheet
      ref={sheet}
      // The two props here describe our content, not the sheet. `scrollable`
      // pins the list inside it, below the header, and is what makes a pull
      // anywhere in the body expand the sheet rather than scroll it.
      scrollable
      // Fires for a swipe down as well as for `dismiss()`, so the parent's
      // state clears however the sheet went away.
      onDidDismiss={onClose}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 10,
        }}>
        {/* Balances the close button so the title sits centred. */}
        <View style={{ width: 32 }} />
        <Body style={{ flex: 1, textAlign: 'center', fontSize: 16 }}>{title}</Body>
        {/* Trailing, where the platform's own round close control sits. */}
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close"
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
      </View>

      <ScrollView
        // A tap on a result while the keyboard is up must pick it, not spend
        // itself dismissing the keyboard.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 14 }}>
        {children}
      </ScrollView>
    </TrueSheet>
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
            {/* A repository row carries its forge's mark — the node rows in the
                same sheet carry none, which is why this slot is optional. */}
            {option.kind !== undefined ? (
              <GitMark kind={option.kind} color={option.kind == null ? c.mutedForeground : c.foreground} />
            ) : null}
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
