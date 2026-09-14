/**
 * The rail, as a phone has one.
 *
 * The cockpit keeps a 56px icon rail down the left of every page — home, a new
 * session, the running sessions, then Routines, Code, Usage, Settings and the
 * account. It is hidden below `md`, and until now the app had no answer for
 * what replaces it: each screen reached one or two others by name and anything
 * else was unreachable or, worse, filed under Settings, which is where you put
 * a thing when you have not decided where it goes.
 *
 * So: the same destinations, in the same order, behind one button in the
 * header. Two properties of the rail are worth keeping and are easy to lose:
 *
 * - **It is on every page.** A menu that only exists on the home screen is a
 *   home screen with a menu, not a rail.
 * - **Routines carries state.** A red pip when a run failed, so "something
 *   broke overnight" is visible from wherever you are — see [[state/routines]].
 *
 * Code mode is listed and cannot be opened, exactly as the rail greys it out
 * when there is no session to open it for. Leaving it out would answer the
 * question "where is code mode?" with silence; saying where it is answers it.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { useAuth } from '../state/auth';
import { useRoutineAlert } from '../state/routines';
import { Body, Meta, Mono } from './kit';
import { Sheet } from './Sheet';
import { font, mix, radius, useTheme } from '../theme';

/** The screens this app has, in the rail's own order. */
export type Destination = 'Sessions' | 'NewSession' | 'Routines' | 'Usage' | 'Settings';

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

/**
 * Three lines, drawn rather than typed: Geist Mono has no hamburger glyph, and
 * React Native has no fallback stack to find one in.
 */
export function MenuButton({
  onPress,
  label = 'Menu',
}: {
  onPress: () => void;
  label?: string;
}) {
  const { c } = useTheme();
  const anyFailed = useRoutineAlert(s => s.anyFailed);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={anyFailed ? `${label} — a routine run failed` : label}
      onPress={onPress}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 16 }}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: radius.md,
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
            top: 3,
            right: 3,
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

export function NavMenu({
  visible,
  onClose,
  onGo,
  current,
}: {
  visible: boolean;
  onClose: () => void;
  /** Called with a destination once the sheet is out of the way. */
  onGo: (destination: Destination) => void;
  /** The screen the menu was opened from, marked rather than offered. */
  current?: Destination;
}) {
  const { c } = useTheme();
  const credential = useAuth(s => s.credential);
  const anyFailed = useRoutineAlert(s => s.anyFailed);

  return (
    <Sheet visible={visible} title="slopcoder" onClose={onClose}>
      <View
        style={{
          backgroundColor: c.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: c.border,
          overflow: 'hidden',
        }}>
        {ENTRIES.map((entry, index) => {
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
                gap: 12,
                minHeight: 56,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: c.border,
                backgroundColor: here
                  ? mix(c.primary, 10)
                  : pressed
                    ? mix(c.mutedForeground, 10)
                    : 'transparent',
                opacity: off ? 0.5 : 1,
              })}>
              {/* The rail marks where you are with a filled tile; a row marks it
                  with a bar in the same place, since there is no icon to fill. */}
              <View
                style={{
                  width: 3,
                  height: 22,
                  borderRadius: 2,
                  backgroundColor: here ? c.primary : 'transparent',
                }}
              />
              <View style={{ flex: 1, gap: 2 }}>
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
              {here ? <Meta style={{ color: c.primary }}>here</Meta> : null}
            </Pressable>
          );
        })}
      </View>

      {/* The rail's account button, which on a phone is just who you are. */}
      <View style={{ gap: 2, paddingHorizontal: 2 }}>
        <Meta>signed in</Meta>
        <Mono numberOfLines={1} style={{ fontSize: 12 }}>
          {credential?.userName ?? '—'} · {credential?.server ?? '—'}
        </Mono>
      </View>
    </Sheet>
  );
}

/**
 * Everything a screen needs to carry the menu: the button, the sheet, and the
 * navigation between them.
 *
 * A hook rather than a component because the button belongs in a header the
 * screen owns and the sheet belongs at the root of it — two places, one piece
 * of state, and no screen should have to remember that.
 */
export function useNavMenu(navigation: any, current?: Destination) {
  const [open, setOpen] = React.useState(false);

  const menu = (
    <NavMenu
      visible={open}
      current={current}
      onClose={() => setOpen(false)}
      onGo={destination => {
        setOpen(false);
        // `navigate` on a native stack pops back to a screen already below,
        // rather than stacking a second copy of it.
        navigation.navigate(destination);
      }}
    />
  );

  return { button: <MenuButton onPress={() => setOpen(true)} />, menu };
}
