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
import { Body, Check, Meta, Mono } from './kit';
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
        <Pressable
          style={{
            backgroundColor: c.background,
            borderTopLeftRadius: radius.xxl,
            borderTopRightRadius: radius.xxl,
            paddingBottom: insets.bottom + 12,
            maxHeight: '85%',
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
        </Pressable>
      </Pressable>
    </Modal>
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
