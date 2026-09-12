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
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { LiquidGlassView, isLiquidGlassSupported } from '@callstack/liquid-glass';
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

/**
 * The real mark, not a letter in a box.
 *
 * The web app ships two theme-fixed SVGs — the frame takes the foreground and
 * the slop takes the primary, and in dark the primary is swapped for the
 * brighter sidebar-primary because the button green disappears against a dark
 * ground. Those are rasterized rather than drawn with react-native-svg: the
 * mark is the only vector in the app, and a whole native module to render one
 * image is not a trade worth making.
 */
export function LogoMark({ size = 18 }: { size?: number }) {
  const { isDark } = useTheme();
  return (
    <Image
      source={isDark ? require('../../assets/images/logo-dark.png') : require('../../assets/images/logo-light.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}

/**
 * The wordmark. "slop" is the one goofy word in the whole product — bigger,
 * heavier, rounder and tilted, against the light mono "coder" beside it.
 */
export function Brand({ size = 15 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <LogoMark size={size * 1.2} />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text
          style={{
            fontFamily: font.display,
            fontSize: size * 1.15,
            lineHeight: size * 1.15,
            color: c.foreground,
            transform: [{ rotate: '-2deg' }],
          }}>
          slop
        </Text>
        <Text
          style={{
            fontFamily: font.mono,
            fontSize: size,
            letterSpacing: -0.375,
            color: c.foreground,
          }}>
          coder
        </Text>
      </View>
    </View>
  );
}

/**
 * Transcript marks, drawn rather than typed.
 *
 * The web stylesheet says these are "geometry, not emoji" and backs Geist Mono
 * with a full system stack, so a missing glyph falls through to something
 * sensible. React Native has no such stack — and Geist Mono turns out to carry
 * none of ✓ ✗ ◐ ☰ ∴ ⑂ ◈. Typing them would render whatever the OS happened to
 * substitute, differently on each platform, or tofu.
 *
 * So the ones with no glyph are shapes. `glyphCoverage` in the tests pins the
 * ones that are still characters.
 */
export const GLYPHS = {
  running: '●',
  done: '●',
  error: '×',
  thinking: '…',
  more: '…',
} as const;

export function Dot({ color, filled = true, size = 9 }: { color: string; filled?: boolean; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: filled ? color : 'transparent',
        borderWidth: filled ? 0 : 1.5,
        borderColor: color,
      }}
    />
  );
}

/** ◐ — a step under way. */
export function HalfDot({ color, size = 9 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: color,
        overflow: 'hidden',
      }}>
      <View style={{ width: size / 2, height: size, backgroundColor: color }} />
    </View>
  );
}

/** ◈ — an approval gate. */
export function Diamond({ color, size = 9 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        transform: [{ rotate: '45deg' }],
      }}
    />
  );
}

/**
 * The web's sliders icon, which opens the turn's settings. An ellipsis was
 * standing in for it and read as "more actions" rather than "the dials".
 */
export function Sliders({ color, size = 14 }: { color: string; size?: number }) {
  const rows = [
    { y: 0.16, knob: 0.62 },
    { y: 0.5, knob: 0.3 },
    { y: 0.84, knob: 0.72 },
  ];

  return (
    <View style={{ width: size, height: size }}>
      {rows.map(row => (
        <React.Fragment key={row.y}>
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: size * row.y - 0.75,
              height: 1.5,
              borderRadius: 1,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: size * row.knob - 2,
              top: size * row.y - 2.5,
              width: 5,
              height: 5,
              borderRadius: 2.5,
              backgroundColor: color,
            }}
          />
        </React.Fragment>
      ))}
    </View>
  );
}

/** A tick. Neither font has one, and a sheet without it shows no selection. */
export function Check({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          left: size * 0.06,
          top: size * 0.52,
          width: size * 0.42,
          height: 2,
          borderRadius: 1,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: size * 0.3,
          top: size * 0.42,
          width: size * 0.72,
          height: 2,
          borderRadius: 1,
          backgroundColor: color,
          transform: [{ rotate: '-50deg' }],
        }}
      />
    </View>
  );
}

/** ☰ — a plan. */
export function Bars({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, justifyContent: 'space-between', paddingVertical: 1 }}>
      {[0, 1, 2].map(i => (
        <View key={i} style={{ height: 1.5, backgroundColor: color, borderRadius: 1 }} />
      ))}
    </View>
  );
}

/** ⑂ — a subagent thread branching off the main one. */
export function Fork({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: 'absolute', left: 1, top: 0, bottom: 0, width: 1.5, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: 1, top: size / 2, height: 1.5, width: size - 3, backgroundColor: color }} />
      <View
        style={{
          position: 'absolute',
          right: 0,
          top: size / 2 - 2,
          width: 5,
          height: 5,
          borderRadius: 2.5,
          backgroundColor: color,
        }}
      />
    </View>
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

/**
 * A surface that is glass where the OS has it, and the card we already had
 * everywhere else.
 *
 * `isLiquidGlassSupported` is false on Android and below iOS 26, and our
 * deployment target is 16 — so the fallback is not an edge case, it is what most
 * of the matrix renders. It has to look finished on its own.
 *
 * Worth knowing when placing one: glass refracts what is *behind* it. Over a
 * plain background it reads as a flat tint and is not worth the native view, so
 * only surfaces that actually float over content use this.
 */
export function GlassSurface({
  children,
  style,
  cornerRadius = radius.xl,
  tint,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  cornerRadius?: number;
  tint?: string;
}) {
  const { c } = useTheme();

  if (!isLiquidGlassSupported) {
    return (
      <View
        style={[
          {
            backgroundColor: c.card,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: cornerRadius,
          },
          style,
        ]}>
        {children}
      </View>
    );
  }

  return (
    <LiquidGlassView
      effect="regular"
      tintColor={tint}
      style={[{ borderRadius: cornerRadius, overflow: 'hidden' }, style]}>
      {children}
    </LiquidGlassView>
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

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'destructive' | 'link-destructive';

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
        : variant === 'link-destructive'
          ? c.destructive
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
          ...(variant === 'link-destructive'
            ? { minWidth: 0, paddingHorizontal: 0, height: 32, alignItems: 'flex-start' as const }
            : null),
        },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={foreground} size="small" />
      ) : (
        <Text
          style={{
            fontFamily: variant === 'link-destructive' ? font.mono : font.sansMedium,
            fontSize: variant === 'link-destructive' ? 13 : 14,
            color: foreground,
            textDecorationLine: variant === 'link-destructive' ? 'underline' : 'none',
          }}>
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
