/**
 * The rail, as a phone has one: a panel that comes in from the left.
 *
 * The cockpit keeps a 56px icon rail down the left of every page — home, a new
 * session, the running sessions, then Routines, Code, Usage, Settings and the
 * account — hidden below `md`. This is that rail at phone width: same
 * destinations, same order, same side, behind a button at the leading edge.
 *
 * **It is not a sheet.** A bottom sheet is for the choices *this screen* is
 * making — the composer's dials, a run — and it comes up under the thumb that
 * was already there. Navigation is not a choice about the screen you are on, it
 * is leaving it, and it belongs on the edge the rail lives on.
 *
 * **Root pages only.** The panel belongs where the rail does: on the places you
 * switch *between*. A pushed screen — a session, a routine, the new-session
 * form — is a thing you came into and go back out of, and it keeps its back
 * chevron. A root page has nothing above it to go back to, so its leading edge
 * is the panel's instead.
 *
 * Two properties of the rail are worth keeping and easy to lose: it is on every
 * root page, and Routines carries a red pip when a run failed, so "something
 * broke overnight" reaches you wherever you are — see `state/routines.ts`.
 *
 * Code mode is listed and cannot be opened, exactly as the rail greys it out
 * when there is no session to open it for. Leaving it off would answer "where
 * is code mode?" with silence; saying where it is answers it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../state/auth';
import { useRoutineAlert } from '../state/routines';
import { Body, Brand, Meta, Mono } from './kit';
import { font, mix, useTheme } from '../theme';

/** Where the panel can take you. */
export type Destination = 'Sessions' | 'NewSession' | 'Routines' | 'Usage' | 'Settings';

/** The screens that carry the panel: the places, not the things. */
export type RootScreen = Extract<Destination, 'Sessions' | 'Routines' | 'Usage' | 'Settings'>;

interface Entry {
  key: Destination | 'Code';
  label: string;
  /** What it is, not a restatement of what it is called. */
  note: string;
}

const ENTRIES: Entry[] = [
  { key: 'Sessions', label: 'Sessions', note: 'the launcher, and everything running' },
  { key: 'NewSession', label: 'New session', note: 'the full picker: repos, nodes, model, facet' },
  { key: 'Routines', label: 'Routines', note: 'schedules, runs and the heartbeat' },
  { key: 'Code', label: 'Code mode', note: 'a canvas over WebAssembly — open the session on a computer' },
  { key: 'Usage', label: 'Usage', note: 'tokens and cost, across every session' },
  { key: 'Settings', label: 'Settings', note: 'this device, and signing out' },
];

/** Wide enough to read a line in, capped so the screen behind stays visible. */
const PANEL = Math.min(312, Math.round(Dimensions.get('window').width * 0.82));

/**
 * Where the panel sits when it is shut: its own width to the *left* of the
 * screen, which is the whole of what makes this a side panel rather than
 * something that rises out of the bottom. Exported because the sign is the only
 * part of an interpolation a test can read.
 */
export const OFFSCREEN = -PANEL;

/** Long enough to read as a slide, short enough not to be in the way. */
const SLIDE_MS = 220;

/**
 * Three lines, drawn rather than typed: Geist Mono has no hamburger glyph, and
 * React Native has no fallback stack to find one in.
 */
export function MenuButton({ onPress, label = 'Menu' }: { onPress: () => void; label?: string }) {
  const { c } = useTheme();
  const anyFailed = useRoutineAlert(s => s.anyFailed);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={anyFailed ? `${label} — a routine run failed` : label}
      onPress={onPress}
      // Generous on the leading side: it sits in the corner, which is where a
      // thumb is least accurate.
      hitSlop={{ top: 12, bottom: 12, left: 16, right: 12 }}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.5 : 1,
      })}>
      <View style={{ width: 18, height: 13, justifyContent: 'space-between' }}>
        {[0, 1, 2].map(i => (
          <View key={i} style={{ height: 1.75, borderRadius: 1, backgroundColor: c.foreground }} />
        ))}
      </View>
      {anyFailed ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 7,
            height: 7,
            borderRadius: 3.5,
            backgroundColor: c.destructive,
          }}
        />
      ) : null}
    </Pressable>
  );
}

export function NavPanel({
  visible,
  onClose,
  onGo,
  current,
}: {
  visible: boolean;
  onClose: () => void;
  /** Called with a destination as the panel starts on its way out. */
  onGo: (destination: Destination) => void;
  /** The screen it was opened from, marked rather than offered. */
  current?: Destination;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const credential = useAuth(s => s.credential);
  const anyFailed = useRoutineAlert(s => s.anyFailed);

  // The modal outlives `visible` by one animation, so the panel can be seen
  // leaving; without this it vanishes on the frame the state flips.
  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) setMounted(true);

    const animation = Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: SLIDE_MS,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      // A transform and an opacity, which is exactly what the native driver
      // takes — so the slide keeps its frames even while the screen behind it
      // is fetching.
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });

    return () => animation.stop();
  }, [visible, slide]);

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      // The slide is ours; the modal must not run a second animation over it.
      animationType="none"
      statusBarTranslucent
      // Android's back button, which would otherwise leave the screen entirely.
      onRequestClose={onClose}>
      <Animated.View style={{ flex: 1, opacity: slide }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the menu"
          onPress={onClose}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
        />
      </Animated.View>

      <Animated.View
        accessibilityViewIsModal
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: PANEL,
          backgroundColor: c.background,
          borderRightWidth: 1,
          borderRightColor: c.border,
          paddingTop: insets.top + 14,
          paddingBottom: insets.bottom + 14,
          transform: [
            { translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [OFFSCREEN, 0] }) },
          ],
        }}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
          <Brand size={14} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
          {ENTRIES.map(entry => {
            const here = entry.key === current;
            const off = entry.key === 'Code';

            return (
              <Pressable
                key={entry.key}
                disabled={off || here}
                onPress={() => onGo(entry.key as Destination)}
                accessibilityRole="button"
                accessibilityState={{ disabled: off, selected: here }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  minHeight: 52,
                  paddingRight: 14,
                  paddingVertical: 9,
                  backgroundColor: here
                    ? mix(c.primary, 10)
                    : pressed
                      ? mix(c.mutedForeground, 10)
                      : 'transparent',
                  opacity: off ? 0.45 : 1,
                })}>
                {/* The rail fills the tile you are on. With no icon to fill, the
                    same mark is a bar against the edge the rail lives on. */}
                <View
                  style={{
                    width: 3,
                    alignSelf: 'stretch',
                    borderTopRightRadius: 2,
                    borderBottomRightRadius: 2,
                    backgroundColor: here ? c.primary : 'transparent',
                  }}
                />
                <View style={{ flex: 1, gap: 2, paddingLeft: 13 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Body style={{ fontFamily: font.sansMedium, fontSize: 15 }}>{entry.label}</Body>
                    {entry.key === 'Routines' && anyFailed ? (
                      <View
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 3.5,
                          backgroundColor: c.destructive,
                        }}
                      />
                    ) : null}
                  </View>
                  <Mono numberOfLines={2} style={{ lineHeight: 16 }}>
                    {entry.note}
                  </Mono>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* The rail's account button, which on a phone is just who you are. */}
        <View
          style={{
            gap: 3,
            paddingHorizontal: 16,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: c.border,
          }}>
          <Meta>signed in</Meta>
          <Mono numberOfLines={1} style={{ fontSize: 12 }}>
            {credential?.userName ?? '—'}
          </Mono>
          <Mono numberOfLines={1} ellipsizeMode="head" style={{ fontSize: 12 }}>
            {credential?.server ?? '—'}
          </Mono>
        </View>
      </Animated.View>
    </Modal>
  );
}

/**
 * Everything a root screen needs to carry the panel: the button for its leading
 * edge, and the panel itself.
 *
 * A hook rather than a component because the two live in different places — the
 * button inside a header the screen owns, the panel at the root of it — and no
 * screen should have to remember that. It takes a {@link RootScreen} rather
 * than any destination, so the type says what the doc comment above says: a
 * pushed screen does not get one.
 */
export function useNavMenu(navigation: any, current: RootScreen) {
  const [open, setOpen] = useState(false);

  const menu = (
    <NavPanel
      visible={open}
      current={current}
      onClose={() => setOpen(false)}
      onGo={destination => {
        setOpen(false);
        // `navigate` on a native stack pops back to a screen already below
        // rather than stacking a second copy of it.
        navigation.navigate(destination);
      }}
    />
  );

  return { button: <MenuButton onPress={() => setOpen(true)} />, menu };
}
