/**
 * The primitives the cockpit's look is made of, as React Native components.
 *
 * Two rules carried over from the web UI, because between them they are most of
 * what makes it recognisable:
 *
 * - Names and prose in Allo; labels, counts,
 *   timestamps, status strips — in Geist Mono at 11-12px, uppercase, tracked.
 * - Anything the web hides until hover is permanently visible here. The web
 *   stylesheet already branches on `@media (hover: hover)`; this is that branch.
 */
import React, { forwardRef, useEffect, useMemo, useRef } from 'react';
import {
  AccessibilityInfo,
  Platform,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {
  LiquidGlassView,
  isLiquidGlassSupported,
} from '@callstack/liquid-glass';
import Markdown, {
  type RenderRules,
} from '@ronradtke/react-native-markdown-display';
import { copyText } from './clipboard';
import { useReducedMotion } from './motion';
import { mix, radius, font, reading, tintFor, useTheme, type Palette } from '../theme';
import { splitMentions, type SubSessionMention } from '../api/mentions';
import { GitServiceKind } from '../api/contracts';
import { useTranscriptServices } from './transcriptServices';

/**
 * Markdown images, drawn by the transcript's own media view: bounded, loaded
 * with the bearer key when they live on this server, and opened full screen
 * on a tap. The library's default would fetch unauthenticated and at any size.
 */
function imageRules(ProseImage: React.ComponentType<{ src: string; alt: string }>): RenderRules {
  return {
    image: node => (
      <ProseImage
        key={node.key}
        src={String(node.attributes?.src ?? '')}
        alt={String(node.attributes?.alt ?? '')}
      />
    ),
  };
}

/**
 * How far the mono grammar may grow under Dynamic Type. Body text scales
 * freely — that is what the setting is for — but an 11px uppercase label at
 * the largest accessibility size is three lines of shouting inside a row that
 * was drawn for one, so it stops here.
 */
export const META_SCALE_CAP = 1.3;

export function Meta({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const { c } = useTheme();
  return (
    <Text
      maxFontSizeMultiplier={META_SCALE_CAP}
      style={[
        {
          fontFamily: font.mono,
          fontSize: 11,
          letterSpacing: 0.66,
          textTransform: 'uppercase',
          color: c.mutedForeground,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Mono, but not shouted — timestamps and model names read as written. */
export function Mono({
  children,
  style,
  numberOfLines,
  ellipsizeMode,
  selectable,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /** Which end to cut. A file path is worth more from its tail, so it takes 'head'. */
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip';
  /** A URL or a path the reader may want to long-press and copy. */
  selectable?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      ellipsizeMode={ellipsizeMode}
      selectable={selectable}
      maxFontSizeMultiplier={META_SCALE_CAP}
      style={[
        { fontFamily: font.mono, fontSize: 11.5, color: c.mutedForeground },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  style,
  numberOfLines,
  accessibilityLiveRegion,
  selectable,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /** 'polite' for an error that appears in place, so a screen reader says it. */
  accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
  /** Long-press to select and copy, for text worth taking off the phone. */
  selectable?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      accessibilityLiveRegion={accessibilityLiveRegion}
      selectable={selectable}
      style={[
        { fontFamily: font.sans, fontSize: 15, color: c.foreground },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Brown Fold, with independently lit day/night cutouts. */
export function LogoMark({ size = 18 }: { size?: number }) {
  const { isDark } = useTheme();
  return (
    <Image
      source={isDark ? require('../../assets/images/fold-pile-night.png') : require('../../assets/images/fold-pile-day.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessible={false}
      accessibilityIgnoresInvertColors
    />
  );
}

/** One baked optical lockup keeps the loop-to-c alignment on both platforms. */
export function Brand({ size = 15 }: { size?: number }) {
  const { isDark } = useTheme();
  const width = size * 7.5;
  return (
    <Image
      source={isDark ? require('../../assets/images/fold-wordmark-night.png') : require('../../assets/images/fold-wordmark-day.png')}
      style={{ width, aspectRatio: 1957 / 427 }}
      resizeMode="contain"
      accessible
      accessibilityRole="image"
      accessibilityLabel="slopcoder"
      accessibilityIgnoresInvertColors
    />
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

export function Dot({
  color,
  filled = true,
  size = 9,
}: {
  color: string;
  filled?: boolean;
  size?: number;
}) {
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
      }}
    >
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
export function Sliders({
  color,
  size = 14,
}: {
  color: string;
  size?: number;
}) {
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
    <View
      style={{
        width: size,
        height: size,
        justifyContent: 'space-between',
        paddingVertical: 1,
      }}
    >
      {[0, 1, 2].map(i => (
        <View
          key={i}
          style={{ height: 1.5, backgroundColor: color, borderRadius: 1 }}
        />
      ))}
    </View>
  );
}

/** ⑂ — a subagent thread branching off the main one. */
export function Fork({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          left: 1,
          top: 0,
          bottom: 0,
          width: 1.5,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 1,
          top: size / 2,
          height: 1.5,
          width: size - 3,
          backgroundColor: color,
        }}
      />
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

/**
 * The mark of a git hosting service — GitHub's, a Forgejo's, or the generic
 * Git one when no connection recognizes the host. The web draws these from
 * simple-icons paths (`GitServiceIcon.razor`); these bitmaps are the same
 * paths rendered once, tinted at render the way the tab bar's icons are.
 */
export function GitMark({
  kind,
  color,
  size = 14,
}: {
  kind?: GitServiceKind | null;
  color: string;
  size?: number;
}) {
  const source =
    kind === GitServiceKind.GitHub
      ? require('../../assets/icons/github.png')
      : kind === GitServiceKind.Forgejo
        ? require('../../assets/icons/forgejo.png')
        : require('../../assets/icons/git.png');
  return (
    <Image
      source={source}
      resizeMode="contain"
      style={{ width: size, height: size, tintColor: color }}
    />
  );
}

/** 8px; emerald and breathing when running, a bare ring when idle. */
export function StatusDot({
  running,
  size = 8,}: {
  running: boolean;
  size?: number;
}) {
  const { c, status } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!running || reducedMotion) {
      pulse.setValue(1);
      return;
    }
    // Opacity only, on the native driver, so it keeps time while JS is busy
    // folding a transcript.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [running, pulse, reducedMotion]);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: running ? status.ok : 'transparent',
        borderWidth: running ? 0 : 1,
        borderColor: c.border,
        opacity: pulse,
      }}
    />
  );
}

/**
 * Where a row will be once the server has answered.
 *
 * Only for data that is genuinely unknown — a session list, a run log. Chrome
 * paints for real; a heading does not need a placeholder for itself.
 */
export function Skeleton({
  rows = 3,
  height = 44,
}: {
  rows?: number;
  height?: number;
}) {
  const { c } = useTheme();
  const shimmer = useRef(new Animated.Value(0.5)).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) { shimmer.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0.5,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer, reducedMotion]);

  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: rows }, (_, i) => (
        <Animated.View
          key={i}
          style={{
            minHeight: height,
            paddingVertical: 12,
            gap: 8,
            borderTopWidth: 1,
            borderTopColor: c.border,
            opacity: shimmer,
          }}
        >
          <View
            style={{
              height: 12,
              width: `${55 + ((i * 17) % 30)}%`,
              borderRadius: 4,
              backgroundColor: mix(c.mutedForeground, 22),
            }}
          />
          <View
            style={{
              height: 9,
              width: '38%',
              borderRadius: 4,
              backgroundColor: mix(c.mutedForeground, 14),
            }}
          />
        </Animated.View>
      ))}
    </View>
  );
}

/**
 * The bar over a pushed page, in glass: the whole strip the platform's
 * navigation bar occupies, status bar included, refracting whatever scrolls
 * under it. Handed to the navigator as `headerBackground`, which lays it
 * under the native title and buttons and over the page.
 *
 * A transparent bar alone was not this. iOS 26 keeps a title legible over a
 * scrolling page with a scroll-edge effect the scroll view draws itself, and
 * the cockpit's inverted list — flipped by a transform — never drew one, so
 * the transcript ran straight through the title. Glass is what was asked
 * for anyway.
 */
export function GlassBar() {
  const { c } = useTheme();
  return (
    <GlassSurface
      cornerRadius={0}
      style={[
        StyleSheet.absoluteFill,
        { borderWidth: 0, borderBottomWidth: 1, borderBottomColor: c.border },
      ]}
    >
      <View />
    </GlassSurface>
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
  // Start opaque until the OS accessibility preference is known. A late
  // promise must not reverse a more recent live settings-change event.
  const [reduceTransparency, setReduceTransparency] = React.useState(true);
  useEffect(() => {
    if (Platform.OS !== 'ios' || !isLiquidGlassSupported) return;
    let active = true;
    let changed = false;
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', value => {
      changed = true;
      if (active) setReduceTransparency(value);
    });
    AccessibilityInfo.isReduceTransparencyEnabled().then(value => {
      if (active && !changed) setReduceTransparency(value);
    }).catch(() => { /* Keep the safe opaque surface. */ });
    return () => { active = false; sub.remove(); };
  }, []);

  if (!isLiquidGlassSupported || reduceTransparency) {
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
        ]}
      >
        {children}
      </View>
    );
  }

  return (
    <LiquidGlassView
      effect="regular"
      tintColor={tint}
      style={[{ borderRadius: cornerRadius, overflow: 'hidden' }, style]}
    >
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
      ]}
    >
      {children}
    </View>
  );
}

type ButtonVariant =
  | 'primary'
  | 'outline'
  | 'ghost'
  | 'destructive'
  | 'link-destructive';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  accessibilityLabel,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, isDark } = useTheme();
  const off = disabled || busy;

  const background =
    variant === 'primary'
      ? c.primary
      : variant === 'destructive'
      ? c.destructive
      : 'transparent';
  const foreground =
    variant === 'primary'
      ? c.primaryForeground
      : variant === 'destructive'
      ? (isDark ? '#201012' : '#ffffff')
      : variant === 'ghost'
      ? c.mutedForeground
      : variant === 'link-destructive'
      ? c.destructive
      : c.foreground;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 40, // 2rem on the web; a thumb wants more.
          minWidth: 64,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background,
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor: c.border,
          opacity: off ? 0.45 : pressed ? 0.8 : 1,
          ...(variant === 'link-destructive'
            ? {
                minWidth: 0,
                paddingHorizontal: 0,
                minHeight: 32,
                alignItems: 'flex-start' as const,
              }
            : null),
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={foreground} size="small" />
      ) : (
        <Text
          style={{
            fontFamily:
              variant === 'link-destructive' ? font.mono : font.sansMedium,
            fontSize: variant === 'link-destructive' ? 13 : 14,
            color: foreground,
            textDecorationLine:
              variant === 'link-destructive' ? 'underline' : 'none',
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * The circular send, and the square stop inside it.
 *
 * Losing the word costs something: Send and Steer become the same button, and
 * only the running dot and the placeholder say which one you are pressing. The
 * shape carries the distinction that actually matters — arrow versus square is
 * the convention every chat app has trained people on — and the action word
 * survives as the accessibility label, so it is still spoken aloud.
 */
export function SendButton({
  mode,
  onPress,
  disabled,
  busy,
  accessibilityLabel,
}: {
  mode: 'send' | 'stop';
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel: string;
}) {
  const { c } = useTheme();
  const off = disabled || busy;
  const foreground = mode === 'stop' ? c.foreground : c.primaryForeground;

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={5}
      accessibilityLabel={accessibilityLabel}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor:
          mode === 'stop' ? mix(c.mutedForeground, 22) : c.primary,
        opacity: off ? 0.4 : pressed ? 0.75 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={foreground} size="small" />
      ) : mode === 'stop' ? (
        // No font here has a filled square, so it is drawn — same reason the
        // transcript's marks are.
        <View
          style={{
            width: 11,
            height: 11,
            borderRadius: 2.5,
            backgroundColor: foreground,
          }}
        />
      ) : (
        <Text
          style={{
            fontFamily: font.mono,
            fontSize: 17,
            lineHeight: 19,
            color: foreground,
          }}
        >
          ↑
        </Text>
      )}
    </Pressable>
  );
}

/**
 * A text field the OS can fill.
 *
 * `textContentType` and `autoComplete` are what iCloud Keychain and Google's
 * autofill key off; without them a sign-in form is one the password manager
 * cannot see. The ref is forwarded so a form can chain fields with the return
 * key rather than making the thumb find the next box.
 */
export const Field = forwardRef<
  React.ComponentRef<typeof TextInput>,
  {
    value: string;
    onChangeText: (next: string) => void;
    placeholder?: string;
    secure?: boolean;
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
    maxLength?: number;
    keyboardType?:
      | 'default'
      | 'url'
      | 'email-address'
      | 'numbers-and-punctuation';
    textContentType?: TextInputProps['textContentType'];
    autoComplete?: TextInputProps['autoComplete'];
    returnKeyType?: TextInputProps['returnKeyType'];
    onSubmitEditing?: () => void;
    autoFocus?: boolean;
    selectTextOnFocus?: boolean;
    accessibilityLabel?: string;
    /** A text style, so a caller can put a host or a token in mono. */
    style?: StyleProp<TextStyle>;
  }
>(function FieldInner(
  {
    value,
    onChangeText,
    placeholder,
    secure,
    autoCapitalize = 'none',
    maxLength,
    keyboardType,
    textContentType,
    autoComplete,
    returnKeyType,
    onSubmitEditing,
    autoFocus,
    selectTextOnFocus,
    accessibilityLabel,
    style,
  },
  ref,
) {
  const { c } = useTheme();
  return (
    <TextInput
      ref={ref}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={c.mutedForeground}
      secureTextEntry={secure}
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      maxLength={maxLength}
      keyboardType={keyboardType}
      textContentType={textContentType}
      autoComplete={autoComplete}
      returnKeyType={returnKeyType}
      onSubmitEditing={onSubmitEditing}
      // Stay focused after "next"; the handler moves focus on itself.
      submitBehavior={
        onSubmitEditing && returnKeyType !== 'done' && returnKeyType !== 'go'
          ? 'submit'
          : 'blurAndSubmit'
      }
      autoFocus={autoFocus}
      selectTextOnFocus={selectTextOnFocus}
      accessibilityLabel={accessibilityLabel ?? placeholder}
      style={[
        {
          minHeight: 44,
          borderWidth: 1,
          borderColor: c.input,
          borderRadius: radius.md,
          paddingHorizontal: 12,
          fontSize: 16,
          fontFamily: font.sans,
          color: c.foreground,
          backgroundColor: c.background,
        },
        style,
      ]}
    />
  );
});

/** The hub row grammar: a section label, then hairline-separated 44px rows. */
export function SectionLabel({
  label,
  count,
}: {
  label: string;
  count?: number;
}) {
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
      accessibilityRole={onPress ? 'button' : undefined}
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
      ]}
    >
      {children}
    </Pressable>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <Text
      style={{
        fontFamily: font.mono,
        fontSize: 12,
        color: c.mutedForeground,
        lineHeight: 18,
      }}
    >
      {children}
    </Text>
  );
}

/**
 * A page that fills its screen, for the ones that lay out more than one thing.
 *
 * **Not for a page with a large title.** UIKit finds the scroll view that
 * drives the bar by walking first children down from the screen, and this view
 * stops that walk even though the scroll view is its only child — the title
 * then stays at full size forever and never collapses. Such a page returns its
 * `ScrollView`/`FlatList` directly, or a fragment with the scroll view first;
 * `__tests__/large-title.test.tsx` holds them to it. The background here is the
 * one the navigator's `contentStyle` already paints, so dropping this wrapper
 * costs a page nothing.
 */
export function Screen({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});

/** "7/10/2026 5:24 PM" — the stamp the web rows show. */
export function stamp(iso: string): string {
  const at = new Date(iso);
  const date = at.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const time = at.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date} ${time}`;
}

/** The text node markdown is built from, with selection turned on. */
function SelectableText(props: React.ComponentProps<typeof Text>) {
  return <Text selectable {...props} />;
}

/**
 * Prose, rendered the one way.
 *
 * Four screens render markdown — the transcript's replies and its streaming
 * tail, a routine run's answer, a sub-session's last lines — and each was
 * passing `markdownStyles` by hand, which is three chances to drift and three
 * places to forget the copy button. The paragraph should not read differently
 * depending on which screen it is on, and neither should a fenced command.
 */
export function Prose({
  children,
  mentions,
  size = 'body',
}: {
  children: string;
  /**
   * `small` for prose quoted inside a card — a sub-session's tail;
   * `document` for a whole document (an artifact), whose headings keep a
   * document's hierarchy where a message's are all one quiet step up.
   */
  size?: ProseSize;
  /**
   * The session's partners. Their names are tinted wherever they appear in
   * this prose, so one of them can be followed down a transcript by eye.
   */
  mentions?: readonly SubSessionMention[];
}) {
  const { c, isDark } = useTheme();
  const services = useTranscriptServices();
  const ProseImage = services.ProseImage;
  const rules = useMemo(() => {
    const merged = {
      ...(mentions && mentions.length > 0 ? mentionRules(mentions, isDark) : null),
      ...(ProseImage ? imageRules(ProseImage) : null),
    };
    return Object.keys(merged).length > 0 ? merged : undefined;
  }, [mentions, isDark, ProseImage]);
  // Links open the app's own screens, the browser, or say why they cannot;
  // without this, `/artifacts/…` went to `Linking` and silently nowhere.
  const onLinkPress = services.useOpenLink();
  return (
    <Markdown
      style={markdownStyles(c, size)}
      onLinkPress={onLinkPress}
      // Every text node selectable, so a reader can take one line out of a
      // reply rather than the whole thing. This is the platform's own
      // selection UI; it costs no view and no gesture handler.
      textcomponent={SelectableText}
      rules={rules}
      // The prism theme behind the syntax colours; without it a fence is
      // highlighted for a white page.
      colorScheme={isDark ? 'dark' : 'light'}
      // Gives every fence a header with a copy button, which is the only way
      // to get a command off this screen and into a terminal.
      onCopyCode={copyText}
    >
      {children}
    </Markdown>
  );
}

/**
 * The one rule that tints a partner's name.
 *
 * It replaces the renderer for `text` nodes only, which is exactly the prose:
 * inline code and fences carry their content on their own node types and never
 * become text children, so they are skipped for free. Links do have text
 * children, so those are skipped explicitly — a name inside a link is the
 * link's own words, and colouring it would be wrong in a way a reader notices.
 */
function mentionRules(
  mentions: readonly SubSessionMention[],
  dark: boolean,
): RenderRules {
  return {
    text: (node, _children, parentNodes, nodeStyles, ...extra) => {
      // The renderer passes the styles inherited from the enclosing nodes as a
      // trailing argument; without it a name inside a heading or a list loses
      // its size along with its colour.
      const inherited = (extra[0] ?? {}) as object;
      const style = [inherited, nodeStyles.text];
      const content = node.content ?? '';

      // A name inside a link is the link's own words. Inline code and fences
      // carry their content on their own node types and never reach here.
      if (parentNodes.some(ancestor => ancestor.type === 'link')) {
        return (
          <Text key={node.key} selectable style={style}>
            {content}
          </Text>
        );
      }

      return (
        <Text key={node.key} selectable style={style}>
          {splitMentions(content, mentions).map((run, index) => {
            const tint = run.color ? tintFor(run.color, dark) : null;
            return tint ? (
              <Text
                key={index}
                style={{ color: tint, fontFamily: font.sansMedium }}
              >
                {run.text}
              </Text>
            ) : (
              run.text
            );
          })}
        </Text>
      );
    },
  };
}

/**
 * How prose renders: an assistant's message in the transcript, and a routine
 * run's answer, which is the same text arriving by a different road.
 *
 * Lives here rather than beside either caller because the two must not drift —
 * the same paragraph should not read differently depending on which screen it
 * is on.
 */
export type ProseSize = 'body' | 'small' | 'document';

export function markdownStyles(c: Palette, size: ProseSize = 'body') {
  const half = reading.paragraphGap / 2;
  const base = {
    body: {
      color: c.foreground,
      fontFamily: font.sans,
      ...(size === 'small' ? reading.proseSmall : reading.prose),
    },
    // The library's own paragraph is 10 above and 10 below, so two paragraphs
    // stood 20 apart where the web has 8. Half the gap on each side gives the
    // web's collapsed margin between them; the row around the prose accounts
    // for the half left at either end.
    paragraph: { marginTop: half, marginBottom: half },
    bullet_list: { marginVertical: half },
    ordered_list: { marginVertical: half },
    list_item: { marginVertical: 1 },
    // Headings size themselves, because the library's do not finish the job.
    // Its own are a web page's — a 32px h1 — and none of them names a line
    // height, so `body`'s 23 came down the inheritance chain and a 32px line
    // was drawn in 23px of room: every heading in an artifact was clipped, and
    // its wrapped lines overlapped each other. These are a phone's sizes, each
    // with the leading it needs, and margins that hold a heading nearer the
    // text it titles than the text above it.
    heading1: {
      fontFamily: font.sansMedium,
      fontSize: 22,
      lineHeight: 28,
      marginTop: 12,
      marginBottom: 2,
    },
    heading2: {
      fontFamily: font.sansMedium,
      fontSize: 19,
      lineHeight: 25,
      marginTop: 12,
      marginBottom: 2,
    },
    heading3: {
      fontFamily: font.sansMedium,
      fontSize: 17,
      lineHeight: 23,
      marginTop: 10,
      marginBottom: 2,
    },
    heading4: {
      fontFamily: font.sansMedium,
      fontSize: 15,
      lineHeight: 22,
      marginTop: 10,
      marginBottom: 2,
    },
    heading5: {
      fontFamily: font.sansMedium,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 10,
      marginBottom: 2,
    },
    // The sixth level is a label more than a heading, so it reads as one.
    heading6: {
      fontFamily: font.sansMedium,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 10,
      marginBottom: 2,
      color: c.mutedForeground,
    },
    code_inline: {
      fontFamily: font.mono,
      fontSize: 12,
      backgroundColor: mix(c.muted, 60),
      color: c.foreground,
    },
    // Wide code must scroll inside itself, never widen the screen.
    // Code blocks and fences: the web's pre — 12.48 on 1.625, 12 inside,
    // 12 above and below (less the paragraph's half gap).
    code_block: {
      fontFamily: font.mono,
      fontSize: 12.5,
      lineHeight: 20,
      padding: 12,
      marginVertical: 12 - half,
      backgroundColor: mix(c.muted, 40),
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      color: c.foreground,
    },
    // A fence is not one style but six, and the five below `fence` were falling
    // through to the library's own — which are light greys, so a fenced block
    // rendered a pale slab on this charcoal. They matter more now that the
    // header is where the copy button lives.
    fence: {
      fontFamily: font.mono,
      fontSize: 12.5,
      marginVertical: 12 - half,
      backgroundColor: mix(c.muted, 40),
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      overflow: 'hidden' as const,
      color: c.foreground,
    },
    fence_header: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'center' as const,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: mix(c.muted, 70),
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    fence_language_label: {
      fontFamily: font.mono,
      fontSize: 11,
      color: c.mutedForeground,
    },
    fence_copy_button: { paddingHorizontal: 6, paddingVertical: 2 },
    fence_copy_text: { fontFamily: font.mono, fontSize: 11, color: c.primary },
    fence_code: { backgroundColor: mix(c.muted, 40), padding: 12 },
    fence_token: { fontFamily: font.mono, fontSize: 12.5, lineHeight: 20 },
    // The web's link: primary, medium, no underline at rest (the underline is
    // its hover state, which a phone has none of). The library's default also
    // pulls the line up 4 with a negative margin, which nudged linked words
    // off the baseline of the text around them.
    // A link is its own Text inside a Pressable, so it inherits nothing from
    // the paragraph: without the body's size and leading it was drawn in a
    // shorter line box and rode above the words around it.
    link: {
      ...(size === 'small' ? reading.proseSmall : reading.prose),
      color: c.primary,
      fontFamily: font.sansMedium,
      textDecorationLine: 'none' as const,
      marginBottom: 0,
    },
    blockquote: {
      backgroundColor: 'transparent',
      borderLeftWidth: 2,
      borderLeftColor: c.border,
      marginLeft: 0,
      paddingLeft: 12,
      paddingHorizontal: 0,
      paddingRight: 0,
      marginVertical: half,
    },
    // The library's table is ruled in black, which on the dark ground is a
    // hole and on the light one a shout; the web's is the border colour, with
    // 4x8 cells, 12 from the text around it.
    table: { borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, marginVertical: 12 - half },
    tr: { borderBottomWidth: 1, borderColor: c.border, flexDirection: 'row' as const },
    th: { flex: 1, paddingVertical: 4, paddingHorizontal: 8 },
    td: { flex: 1, paddingVertical: 4, paddingHorizontal: 8 },
    hr: { backgroundColor: c.border, height: 1, marginVertical: 12 },
  };
  if (size === 'document') return base;
  // In a message the web sets h1–h4 alike, one quiet step above the text
  // (15.2px, 600, 20 above and 8 below); a phone message follows it. The
  // margins net out the paragraph's half gap on either side.
  const messageHeading = {
    fontFamily: font.sansMedium,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.375,
    marginTop: 20 - half,
    marginBottom: 8 - half,
  };
  return {
    ...base,
    heading1: messageHeading,
    heading2: messageHeading,
    heading3: messageHeading,
    heading4: messageHeading,
    heading5: { ...messageHeading, fontSize: 14, letterSpacing: 0 },
    heading6: { ...messageHeading, fontSize: 13, letterSpacing: 0, color: c.mutedForeground },
  };
}
