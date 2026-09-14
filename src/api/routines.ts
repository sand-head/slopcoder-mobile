/**
 * How a routine reads: the wording every Routines surface shares.
 *
 * A port of `Pages/Routines/RoutineFormat.cs` and the parts of `TimeFormat.cs`
 * it leans on. The board, the detail screen and the sessions strip all draw the
 * same three outcomes and the same handful of trigger kinds, and a second copy
 * of "notified is emerald" is a copy that will drift — so this is one module,
 * pure and testable, and no screen decides any of it for itself.
 *
 * Colour is the one thing that is *not* here: it needs the palette, so it lives
 * beside the bars in `ui/HistoryStrip.tsx`.
 *
 * Everything takes ISO strings, because that is what the seam sends. The clock
 * they are read on is the phone's, which is also the zone the board is asked
 * for — so "today" means the same thing on both sides of the call.
 */
import {
  AutomationRunStatus,
  AutomationTriggerKind,
  ChannelKind,
  RunOutcome,
  type HeartbeatStatus,
  type RoutineBoard,
  type RoutineCard,
  type RoutineFailure,
  type RunDetail,
  type RunSummary,
} from './contracts';

// ---- time ----

/** "480ms", "12.3s", "4m 02s", "1h 12m" — the scale picks the two useful units. */
export function duration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Number((ms / 1000).toFixed(1))}s`;
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)}m ${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}s`;
  }
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

/**
 * "in 5m", "in 2h", "in 3d" — a deadline the reader is waiting on. A time
 * already past reads as "now", because that is what it means to them.
 */
export function until(iso: string, now = Date.now()): string {
  const delta = new Date(iso).getTime() - now;
  if (delta <= 60_000) return 'now';
  if (delta < 3_600_000) return `in ${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `in ${Math.floor(delta / 3_600_000)}h`;
  return `in ${Math.floor(delta / 86_400_000)}d`;
}

/** Just the time, on the reader's own clock: "07:00". */
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Midnight of the day a timestamp falls on, locally. */
function startOfDay(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/**
 * When something happened, as near as it needs to be: "today 07:00",
 * "yesterday 14:20", "Tue 07:00" inside the last week, then "Sep 1".
 */
export function when(iso: string, now = Date.now()): string {
  const at = new Date(iso);
  const day = startOfDay(at);
  const today = startOfDay(new Date(now));

  if (day === today) return `today ${clock(iso)}`;
  if (day === today - 86_400_000) return `yesterday ${clock(iso)}`;
  if (day > today - 7 * 86_400_000 && day < today) {
    return `${at.toLocaleDateString(undefined, { weekday: 'short' })} ${clock(iso)}`;
  }
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The shortest honest way to say when something next fires, for a line that
 * lists several: "8m" within the hour, "12:00" later today, then "Tue 07:00",
 * then "Sep 12". No "in", no "next" — the line has already said it.
 */
export function soon(iso: string, now = Date.now()): string {
  const at = new Date(iso);
  const delta = at.getTime() - now;

  if (delta < 0) return 'due';
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}m`;
  if (startOfDay(at) === startOfDay(new Date(now))) return clock(iso);
  if (delta < 7 * 86_400_000) {
    return `${at.toLocaleDateString(undefined, { weekday: 'short' })} ${clock(iso)}`;
  }
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The phone's own IANA zone, which is what "today" is counted in. Undefined
 * rather than a guess when the runtime cannot name it: the server falls back to
 * UTC, and a wrong zone is worse than a known one.
 */
export function deviceZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

// ---- outcomes ----

/** The outcome as the tables and alerts write it. */
export function outcomeLabel(outcome: RunOutcome | null | undefined): string {
  switch (outcome) {
    case RunOutcome.Notified:
      return 'notified';
    case RunOutcome.Quiet:
      return 'quiet';
    case RunOutcome.Failed:
      return 'failed';
    default:
      return 'running';
  }
}

/**
 * The same, but honest about a skip. A skipped run paints as a quiet bar —
 * nothing was said and nothing is wrong — yet a row that calls it "quiet" hides
 * that the run never happened.
 */
export function statusLabel(status: AutomationRunStatus): string {
  return status === AutomationRunStatus.Skipped ? 'skipped' : outcomeLabel(outcomeOf(status));
}

/** The outcome a status paints as, or null while the run is still going. */
export function outcomeOf(status: AutomationRunStatus): RunOutcome | null {
  switch (status) {
    case AutomationRunStatus.Completed:
      return RunOutcome.Notified;
    case AutomationRunStatus.Quiet:
    case AutomationRunStatus.Skipped:
      return RunOutcome.Quiet;
    case AutomationRunStatus.Failed:
      return RunOutcome.Failed;
    default:
      return null;
  }
}

// ---- routines ----

export function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

export function needs(failures: number): string {
  return failures === 1 ? '1 failed run needs you' : `${failures} failed runs need you`;
}

/** "1st", "2nd", "3rd", "11th" — a streak reads as a count, not a number. */
export function ordinal(n: number): string {
  // The teens are the exception: 11th, 12th, 13th, not 11st.
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  const suffix = n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** "connection refused · 12.3s · 3rd failure in a row". */
export function failureMeta(failure: RoutineFailure): string {
  const parts: string[] = [];
  if (failure.error) parts.push(failure.error);
  if (failure.durationMs != null) parts.push(duration(failure.durationMs));
  // A streak of one is just "it failed", which the line above already said.
  if (failure.streak > 1) parts.push(`${ordinal(failure.streak)} failure in a row`);
  return parts.join(' · ');
}

/**
 * The card's right-hand word: "next Tue 07:00 (in 21h)", "paused" when the
 * schedule is off, "on trigger" when there is no clock to be next.
 */
export function nextLabel(at: string | null, paused: boolean): string {
  if (paused) return 'paused';
  return at ? `next ${when(at)} (${until(at)})` : 'on trigger';
}

/** "last 07:00 · notified", or that it has never run. */
export function lastLabel(card: RoutineCard): string {
  return card.lastRun
    ? `last ${clock(card.lastRun.startedAt)} · ${statusLabel(card.lastRun.status)}`
    : 'never run';
}

/** "every 30 min · 08:00–22:00 · next in 8m". */
export function heartbeatMeta(beat: HeartbeatStatus): string {
  const parts = [beat.intervalSentence];
  if (beat.activeStart && beat.activeEnd) {
    parts.push(`${hhmm(beat.activeStart)}–${hhmm(beat.activeEnd)}`);
  }
  parts.push(
    !beat.enabled
      ? 'paused'
      : beat.nextFire
        ? `next ${until(beat.nextFire)}`
        : 'next unscheduled',
  );
  return parts.join(' · ');
}

/** A `TimeOnly` arrives as "07:00:00"; the seconds are noise. */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

/** "Notepad · 4 items · watch the CI queue, chase the flaky test". */
export function notepadLine(beat: HeartbeatStatus): string {
  if (beat.notepadItems.length === 0) return 'Notepad · empty';
  const first = beat.notepadItems.slice(0, 2).join(', ');
  return `Notepad · ${beat.notepadItems.length} ${plural(beat.notepadItems.length, 'item')} · ${first}`;
}

/**
 * A trigger named by the service it listens on, when one is known: a chat
 * command on a Discord connection is a "Discord command", which is what the
 * picker offered and what the row should say back.
 */
export function triggerKindName(
  kind: AutomationTriggerKind | null | undefined,
  channel?: ChannelKind | null,
): string {
  if (kind === AutomationTriggerKind.ChannelCommand) {
    switch (channel) {
      case ChannelKind.Discord:
        return 'Discord command';
      case ChannelKind.Fluxer:
        return 'Fluxer command';
      case ChannelKind.Telegram:
        return 'Telegram command';
      default:
        return 'Chat command';
    }
  }
  switch (kind) {
    case AutomationTriggerKind.Email:
      return 'Email';
    case AutomationTriggerKind.Webhook:
      return 'Webhook';
    case AutomationTriggerKind.Heartbeat:
      return 'Heartbeat';
    default:
      // Null is the synthesized schedule: a column on the routine, not a row.
      return 'Schedule';
  }
}

// ---- the ledger ----

/**
 * The runs the Runs tab lists. The server sends a merged list across every
 * routine; when it is missing — an older host, or a board with nothing in the
 * window — the cards' own last runs still make an honest, if short, one.
 */
export function ledger(board: RoutineBoard): RunSummary[] {
  if (board.recentRuns && board.recentRuns.length > 0) return board.recentRuns;

  return board.routines
    .map(card => card.lastRun)
    .filter((run): run is RunSummary => run !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export interface RunGroup {
  label: string;
  runs: RunSummary[];
}

/** "today" / "yesterday" / "earlier", in that order, skipping the empty ones. */
export function groupRuns(runs: RunSummary[], now = Date.now()): RunGroup[] {
  const today = startOfDay(new Date(now));
  const groups: RunGroup[] = [
    { label: 'today', runs: [] },
    { label: 'yesterday', runs: [] },
    { label: 'earlier', runs: [] },
  ];

  for (const run of runs) {
    const day = startOfDay(new Date(run.startedAt));
    const index = day === today ? 0 : day === today - 86_400_000 ? 1 : 2;
    groups[index].runs.push(run);
  }

  return groups.filter(group => group.runs.length > 0);
}

/** The opening of what a routine said — one line has room for about this much. */
export function firstWords(said: string, max = 60): string {
  const flat = said.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

// ---- one run ----

/**
 * "4m 02s · 38k tokens · $0.11 · claude-sonnet", with the missing parts left
 * out rather than written as a dash: a run whose provider reported no usage
 * should read as short, not as broken.
 */
export function spend(detail: RunDetail): string {
  const parts: string[] = [];
  if (detail.run.durationMs != null) parts.push(duration(detail.run.durationMs));

  const tokens = (detail.inputTokens ?? 0) + (detail.outputTokens ?? 0);
  if (tokens > 0) parts.push(tokens >= 1000 ? `${Math.floor(tokens / 1000)}k tokens` : `${tokens} tokens`);
  if (detail.estimatedCost != null) parts.push(`$${detail.estimatedCost.toFixed(2)}`);
  if (detail.model) parts.push(detail.model);

  return parts.join(' · ');
}

/** How the turn ended, in the transcript's own end-of-turn wording. */
export function runNote(detail: RunDetail): string {
  const run = detail.run;
  switch (run.status) {
    case AutomationRunStatus.Failed:
      return `failed · ${run.error ?? 'no error was recorded'}`;
    case AutomationRunStatus.Skipped:
      return `skipped · ${run.error ?? 'the session was busy'}`;
    case AutomationRunStatus.Quiet:
      return 'quiet · NO_REPLY';
    case AutomationRunStatus.Running:
      return 'running…';
    default: {
      const ended = detail.endedAt
        ? ` · ${new Date(detail.endedAt).toLocaleTimeString(undefined, { hour12: false })}`
        : '';
      return `end of turn · ${run.delivered ? 'notified' : 'not delivered'}${ended}`;
    }
  }
}
