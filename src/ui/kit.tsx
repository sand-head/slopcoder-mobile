/**
 * The primitives the cockpit's look is made of, as React Native components.
 *
 * Two rules carried over from the web UI, because between them they are most of
 * what makes it recognisable:
 *
 * - Names and prose in Geist sans; **everything else** — labels, counts,
 *   timestamps, status strips — in Geist Mono at 11-12px, uppercase, tracked.
 * - Anything the web hides until hover is permanently visible here. The web
 *   stylesheet already branches on `@media (hover: hover)`; this is that branch.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { mix, radius, font, useTheme } from '../theme';

export function Meta({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  return (
    <Text
      style={[
        {
          fontFamily: font.mono,
          fontSize: 11,
          letterSpacing: 0.66,
          textTransform: 'uppercase',
          color: c.mutedForeground,
        },
        style,
      ]}>
      {children}
    </Text>
  );
}

/** Mono, but not shouted — timestamps and model names read as written. */
export function Mono({
  children,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const { c } = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ fontFamily: font.mono, fontSize: 11, color: c.mutedForeground }, style]}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const { c } = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ fontFamily: font.sans, fontSize: 14.5, color: c.foreground }, style]}>
      {children}
    </Text>
  );
}

/** 8px; emerald and pulsing when running, a bare ring when idle. */
export function StatusDot({ running, size = 8 }: { running: boolean; size?: number }) {
  const { c, status } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: running ? status.ok : 'transparent',
        borderWidth: running ? 0 : 1,
        borderColor: c.border,
      }}
    />
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: c.border,
          padding: 12,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'destructive';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const off = disabled || busy;

  const background =
    variant === 'primary' ? c.primary : variant === 'destructive' ? c.destructive : 'transparent';
  const foreground =
    variant === 'primary' || variant === 'destructive'
      ? c.primaryForeground
      : variant === 'ghost'
        ? c.mutedForeground
        : c.foreground;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height: 40, // 2rem on the web; a thumb wants more.
          minWidth: 64,
          paddingHorizontal: 14,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background,
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor: c.border,
          opacity: off ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={foreground} size="small" />
      ) : (
        <Text style={{ fontFamily: font.sans, fontSize: 14, fontWeight: '500', color: foreground }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  value,
  onChangeText,
  placeholder,
  secure,
  autoCapitalize = 'none',
  keyboardType,
  style,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  secure?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'url' | 'email-address';
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={c.mutedForeground}
      secureTextEntry={secure}
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      keyboardType={keyboardType}
      style={[
        {
          height: 44,
          borderWidth: 1,
          borderColor: c.input,
          borderRadius: radius.md,
          paddingHorizontal: 12,
          // 16px or iOS zooms the page on focus.
          fontSize: 16,
          fontFamily: font.sans,
          color: c.foreground,
          backgroundColor: c.background,
        },
        style,
      ]}
    />
  );
}

/** The hub row grammar: a section label, then hairline-separated 44px rows. */
export function SectionLabel({ label, count }: { label: string; count?: number }) {
  return (
    <Meta style={{ paddingBottom: 6 }}>
      {label}
      {count === undefined ? '' : ` · ${count}`}
    </Meta>
  );
}

export function Row({
  children,
  onPress,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 12,
          borderTopWidth: 1,
          borderTopColor: c.border,
          backgroundColor: pressed ? mix(c.mutedForeground, 8) : 'transparent',
        },
        style,
      ]}>
      {children}
    </Pressable>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <Text style={{ fontFamily: font.mono, fontSize: 12, color: c.mutedForeground, lineHeight: 18 }}>
      {children}
    </Text>
  );
}

export function Screen({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return <View style={[styles.screen, { backgroundColor: c.background }]}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});

/** "7/10/2026 5:24 PM" — the stamp the web rows show. */
export function stamp(iso: string): string {
  const at = new Date(iso);
  const date = at.toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' });
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} ${time}`;
}
