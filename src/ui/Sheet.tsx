/**
 * A bottom sheet of grouped rows.
 *
 * The web puts these choices in a dropdown menu, which is a pointer's idea of a
 * menu. On a phone the same content wants to come up from the bottom, inside
 * thumb reach, with rows big enough to hit — so the arrangement follows the
 * platform while the content follows `TurnSettings`.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Check, GlassSurface, Meta, Mono } from './kit';
import { mix, radius, useTheme } from '../theme';

export interface SheetOption {
  key: string;
  label: string;
  /** The line underneath — what the choice means, not a restatement of it. */
  description?: string;
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Tapping the dimmed area closes; tapping the sheet must not. */}
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <Pressable style={{ maxHeight: '85%' }}>
          <GlassSurface
            cornerRadius={radius.xxl}
            style={{
              // Only the top corners round: the sheet is anchored to the edge.
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              paddingBottom: insets.bottom + 12,
            }}>
          <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}>
            <View
              style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.mutedForeground, opacity: 0.4 }}
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

            <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 14 }}>
              {children}
            </ScrollView>
          </GlassSurface>
        </Pressable>
      </Pressable>
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
