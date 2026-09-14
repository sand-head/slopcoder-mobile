/**
 * The last N runs as a strip of bars: emerald said something, grey said
 * nothing, red broke, and a hairline is a slot with no run in it at all.
 *
 * The one place an outcome becomes a colour on this side of the app, the way
 * `RoutineFormat.OutcomeClass` plus each page's stylesheet are on the web. The
 * strip is padded to its full length by the server, oldest first, so the right
 * end is always "just now" however new a routine is.
 *
 * The bars are not tappable. The web's are — clicking one selects that run —
 * but at fourteen bars across a phone each is about four points wide, which is
 * a third of the smallest thing a finger can reliably hit. The list of runs
 * underneath is the tap target.
 */
import React from 'react';
import { View } from 'react-native';
import { RunOutcome } from '../api/contracts';
import { mix, useTheme, type Theme } from '../theme';

/** What a bar, dot or word takes for its colour. */
export function outcomeColor(outcome: RunOutcome | null | undefined, theme: Theme): string {
  switch (outcome) {
    case RunOutcome.Notified:
      return theme.status.ok;
    case RunOutcome.Failed:
      return theme.c.destructive;
    case RunOutcome.Quiet:
      return theme.c.mutedForeground;
    default:
      // Still running, or a slot with no run: the caller decides whether that
      // is a pulsing dot or nothing, but it is never one of the three colours.
      return theme.c.border;
  }
}

export function HistoryStrip({
  history,
  height = 18,
}: {
  history: (RunOutcome | null)[];
  height?: number;
}) {
  const theme = useTheme();

  return (
    <View
      accessibilityLabel={`last ${history.length} runs`}
      style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height }}>
      {history.map((outcome, index) => (
        <View
          key={index}
          style={{
            flex: 1,
            borderRadius: 1,
            // An empty slot is a floor, not a bar: it says "nothing ran" rather
            // than "something ran and was quiet", which is a different fact.
            height: outcome == null ? 3 : height,
            backgroundColor:
              outcome == null
                ? theme.c.border
                : outcome === RunOutcome.Quiet
                  ? mix(theme.c.mutedForeground, 35)
                  : outcomeColor(outcome, theme),
          }}
        />
      ))}
    </View>
  );
}
