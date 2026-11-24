/**
 * The session's header: a round back button, a capsule holding the title and
 * what the session works on, and a capsule with the context ring and the menu.
 *
 * Laid out by React Native, not by UIKit's title-view placement. The old header
 * handed UIKit a React title view whose width Yoga had computed against the
 * whole screen — it knew nothing of the bar's back and menu items, which are
 * UIKit's — so it was never truncated, and UIKit placed a view too wide for the
 * gap between the items: centred when it was laid out one way, slid against
 * the back button when laid out another, over a button either way. Here one
 * flex row owns all three: the sides take their own width, the centre takes
 * exactly what is left (`flex: 1, minWidth: 0`), and the title truncates in it.
 *
 * Glass where the OS has it (GlassSurface: iOS 26+, honouring Reduce
 * Transparency), the opaque card everywhere else.
 */
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from './kit';
import { OverflowMenu, type MenuItem } from './menu';
import { accent, font, mix, useTheme } from '../theme';

/** Height of each glass element: the platform's 44pt touch target. */
export const HEADER_CONTROL = 44;
/** Space between the three elements, and from the screen's edges. */
export const HEADER_GAP = 8;
export const HEADER_EDGE = 16;
/**
 * How far the header's text follows the system text size. It grows — a reader
 * who asked for large text gets it — but stops before a two-line capsule
 * turns the header into a third of the screen. The capsule grows in height
 * with it; nothing else moves.
 */
export const HEADER_TEXT_SCALE_CAP = 1.6;
/** The ring's number is drawn inside a fixed ring, so it may barely grow. */
export const RING_TEXT_SCALE_CAP = 1.15;

/** The web's ContextRing thresholds: warn at 70%, hot at 90%. */
export type RingTone = 'ok' | 'warn' | 'hot';
export function ringTone(percent: number): RingTone {
  return percent >= 90 ? 'hot' : percent >= 70 ? 'warn' : 'ok';
}

/**
 * The ring drawn as two clipped half-rings, since there is no SVG here. Each
 * half-ring is coloured on one side of a circle; rotating it inside a clip
 * that shows one half of the ring sweeps the arc clockwise from twelve
 * o'clock. Returns the two rotations in degrees for a clamped percent.
 */
export function ringRotations(percent: number): { right: number; left: number } {
  const angle = (Math.max(0, Math.min(100, percent)) / 100) * 360;
  return {
    // -135° puts the coloured half on the left, hidden by the right clip;
    // +180° of sweep brings it fully into the right half.
    right: -135 + Math.min(angle, 180),
    // 45° puts it on the right, hidden by the left clip; the second half of
    // the sweep brings it round into the left.
    left: 45 + Math.max(0, angle - 180),
  };
}

/**
 * `percent` is null until the session has reported usage: the ring is still
 * drawn, as its empty track with a dash, so the header does not change shape
 * between sessions and never claims a 0% it does not know.
 */
export function ContextRing({ percent: reported, size = 28, stroke = 3 }: { percent: number | null; size?: number; stroke?: number }) {
  const { c, isDark } = useTheme();
  const percent = reported ?? 0;
  const tone = ringTone(percent);
  const color =
    tone === 'hot' ? c.destructive : tone === 'warn' ? (isDark ? accent.colorAmber400 : accent.colorAmber500) : c.primary;
  const { right, left } = ringRotations(percent);
  const half = (rotate: number): ViewStyle => ({
    position: 'absolute',
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: stroke,
    borderTopColor: color,
    borderRightColor: color,
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
    transform: [{ rotate: `${rotate}deg` }],
  });
  return (
    <View testID="context-ring" style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: stroke,
          // The web's track is --muted, which on a dark card all but vanishes;
          // a faint foreground keeps the ring's whole circle readable.
          borderColor: mix(c.mutedForeground, 30),
        }}
      />
      {/* Right half of the ring: the first 180° of the sweep. Not drawn at
          all with nothing to show: at 0° the coloured half's edge lies exactly
          on the clip's edge at six o'clock, and its anti-aliasing showed there
          as a sliver of arc under an empty or "0" ring. */}
      {percent > 0 ? (
        <View style={{ position: 'absolute', left: size / 2, width: size / 2, height: size, overflow: 'hidden' }}>
          <View style={[half(right), { left: -size / 2 }]} />
        </View>
      ) : null}
      {/* Left half: the rest. */}
      <View style={{ position: 'absolute', left: 0, width: size / 2, height: size, overflow: 'hidden' }}>
        {percent > 50 ? <View style={[half(left), { left: 0 }]} /> : null}
      </View>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text
          maxFontSizeMultiplier={RING_TEXT_SCALE_CAP}
          style={{ fontFamily: font.sansMedium, fontSize: 10, lineHeight: 12, color: reported === null ? c.mutedForeground : c.foreground }}
        >
          {reported === null ? '–' : Math.round(Math.max(0, Math.min(100, percent)))}
        </Text>
      </View>
    </View>
  );
}

/** A chevron and three dots, drawn: no glyph in either font is relied on. */
function BackChevron({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 11,
        height: 11,
        marginLeft: 4,
        borderLeftWidth: 2,
        borderBottomWidth: 2,
        borderColor: color,
        transform: [{ rotate: '45deg' }],
      }}
    />
  );
}

function Dots({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3.5 }}>
      {[0, 1, 2].map(i => (
        <View key={i} style={{ width: 4.5, height: 4.5, borderRadius: 2.25, backgroundColor: color }} />
      ))}
    </View>
  );
}

export interface SessionHeaderProps {
  title: string;
  /** What the session works on: "2 repositories", a repository, "No repositories". */
  subtitle: string;
  /** Spoken after the title and subtitle, e.g. "archived · read-only". */
  accessibilityNote?: string;
  /** Null means no usage reported yet: the ring shows its empty track and a dash. */
  contextPercent: number | null;
  onBack: () => void;
  onOpenContext: () => void;
  onOpenUsage: () => void;
  menuItems: MenuItem[];
}

export function SessionHeader({
  title,
  subtitle,
  accessibilityNote,
  contextPercent,
  onBack,
  onOpenContext,
  onOpenUsage,
  menuItems,
}: SessionHeaderProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const capsule: StyleProp<ViewStyle> = { minHeight: HEADER_CONTROL, borderRadius: HEADER_CONTROL / 2 };

  return (
    <View
      testID="session-header"
      style={{
        paddingTop: insets.top + 6,
        paddingBottom: 8,
        paddingLeft: insets.left + HEADER_EDGE,
        paddingRight: insets.right + HEADER_EDGE,
        flexDirection: 'row',
        alignItems: 'center',
        gap: HEADER_GAP,
        // iOS: the header floats over the transcript, which shows through the
        // glass; a fade keeps the gaps between the elements quiet without a
        // bar. Android: the header is in the layout above the page, painted.
        ...(Platform.OS === 'ios'
          ? { backgroundImage: `linear-gradient(to bottom, ${c.background} 55%, transparent)` }
          : { backgroundColor: c.background }),
      }}
    >
      <GlassSurface cornerRadius={HEADER_CONTROL / 2} style={{ width: HEADER_CONTROL, height: HEADER_CONTROL }}>
        <Pressable
          testID="session-header-back"
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={6}
          style={({ pressed }) => ({
            width: HEADER_CONTROL,
            height: HEADER_CONTROL,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <BackChevron color={c.foreground} />
        </Pressable>
      </GlassSurface>

      {/* The centre takes exactly what the sides leave: flex 1, and minWidth 0
          so a long title cannot claim its own width and push the sides out. */}
      <GlassSurface cornerRadius={HEADER_CONTROL / 2} style={[capsule, { flex: 1, minWidth: 0 }]}>
        <Pressable
          testID="session-header-title"
          onPress={onOpenContext}
          accessibilityRole="button"
          accessibilityLabel={`${title}. ${subtitle}. ${accessibilityNote ? `${accessibilityNote}. ` : ''}Session context`}
          style={({ pressed }) => ({
            minHeight: HEADER_CONTROL,
            paddingHorizontal: 16,
            paddingVertical: 4,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={HEADER_TEXT_SCALE_CAP}
            style={{ fontFamily: font.sansMedium, fontSize: 15, lineHeight: 20, color: c.foreground, textAlign: 'center' }}
          >
            {title}
          </Text>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={HEADER_TEXT_SCALE_CAP}
            style={{ fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: c.mutedForeground, textAlign: 'center' }}
          >
            {subtitle}
          </Text>
        </Pressable>
      </GlassSurface>

      <GlassSurface cornerRadius={HEADER_CONTROL / 2} style={[capsule, { flexDirection: 'row', alignItems: 'center' }]}>
        <Pressable
          testID="session-header-ring"
          onPress={onOpenUsage}
          accessibilityRole="button"
          accessibilityLabel={contextPercent === null ? 'Context usage not reported yet. Session usage' : `${contextPercent}% of context used. Session usage`}
          style={({ pressed }) => ({
            height: HEADER_CONTROL,
            paddingLeft: 10,
            paddingRight: 2,
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <ContextRing percent={contextPercent} />
        </Pressable>
        <OverflowMenu title="Session options" items={menuItems}>
          <View
            testID="session-header-more"
            accessibilityRole="button"
            accessibilityLabel="Session options"
            style={{ width: HEADER_CONTROL, height: HEADER_CONTROL, alignItems: 'center', justifyContent: 'center' }}
          >
            <Dots color={c.foreground} />
          </View>
        </OverflowMenu>
      </GlassSurface>
    </View>
  );
}
