/**
 * The board: what has run, what is scheduled, and the check-in that watches.
 *
 * The cockpit's `/routines` is a grid of cards with a rail beside it; on a
 * phone it already folds into three tabs — the runs as a ledger, the routines
 * as stacked cards, the heartbeat on its own — and that fold is what this
 * screen is. Same data, same wording, same order.
 *
 * Everything shown is folded server-side (`RoutineBoardService`), so this is
 * one call and no arithmetic: "3rd failure in a row" and "Every weekday at
 * 07:00" arrive as sentences rather than as a run log to derive them from.
 *
 * Authoring is not here. Writing a routine means picking a model, repositories,
 * a schedule, triggers and where the answer goes — a form the cockpit already
 * has and a phone has no business reproducing — so "New routine" opens it in
 * the browser, signed in, rather than offering a worse copy.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AutomationKind,
  type HeartbeatStatus,
  type RoutineBoard,
  type RoutineCard,
  type RoutineFailure,
  type RunSummary,
} from '../api/contracts';
import {
  clock,
  deviceZone,
  failureMeta,
  firstWords,
  groupRuns,
  heartbeatMeta,
  lastLabel,
  ledger,
  needs,
  nextLabel,
  notepadLine,
  plural,
  statusLabel,
} from '../api/routines';
import { useAuth } from '../state/auth';
import { useRoutineAlert } from '../state/routines';
import { BackButton, Body, Button, Hint, Meta, Mono, Screen, StatusDot } from '../ui/kit';
import { HistoryStrip, outcomeColor } from '../ui/HistoryStrip';
import { SheetSegments } from '../ui/Sheet';
import { useNavMenu } from '../ui/NavMenu';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { font, mix, radius, useTheme } from '../theme';

/**
 * How often the board re-reads itself while a run is in flight. A run is
 * minutes long — this is a tick, not a stream, and it stops when nothing is
 * running.
 */
const POLL_MS = 15_000;

const TABS = [
  { key: 'runs', label: 'Runs' },
  { key: 'routines', label: 'Routines' },
  { key: 'heartbeat', label: 'Heartbeat' },
];

export function RoutinesScreen({ navigation }: { navigation: any }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const seam = useAuth(s => s.seam);
  const server = useAuth(s => s.credential?.server);
  const nav = useNavMenu(navigation, 'Routines');
  const setFailed = useRoutineAlert(s => s.setFailed);

  const [board, setBoard] = useState<RoutineBoard | null>(null);
  const [tab, setTab] = useState('runs');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!seam) return;
    try {
      const next = await seam.routineBoard(deviceZone());
      setBoard(next);
      // The board knows what the strip's status read would have told us.
      setFailed(next.failures.length > 0);
      setError(null);
    } catch (e) {
      // The board it already has stays: a poll that could not reach the server
      // is a line at the top, not a screen that empties itself.
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [seam, setFailed]);

  useEffect(() => {
    void load();
    return navigation.addListener('focus', load);
  }, [load, navigation]);

  // A running routine is the only thing here that changes without the user
  // doing anything, so the timer exists exactly while one does.
  const running =
    (board?.routines.some(r => r.running) ?? false) || (board?.heartbeat?.running ?? false);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void loadRef.current(), POLL_MS);
    return () => clearInterval(timer);
  }, [running]);

  /**
   * One place for the two things every action shares: nothing runs twice at
   * once, and a problem is a sentence on screen rather than a broken board.
   */
  const act = async (run: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      const problem = await run();
      setError(problem);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Optimistic: the switch has already moved under the finger. */
  const setEnabled = (id: string, on: boolean) => {
    setBoard(current =>
      current
        ? {
            ...current,
            routines: current.routines.map(r => (r.id === id ? { ...r, enabled: on } : r)),
            heartbeat:
              current.heartbeat && current.heartbeat.id === id
                ? { ...current.heartbeat, enabled: on }
                : current.heartbeat,
          }
        : current,
    );
    void act(() => seam!.setRoutineEnabled(id, on));
  };

  const cards = (board?.routines ?? []).filter(r => r.kind !== AutomationKind.Heartbeat);
  const runs = board ? ledger(board) : [];

  const open = (id: string, runId?: string) => navigation.navigate('Routine', { id, run: runId });

  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 16,
          paddingTop: insets.top + 8,
          paddingBottom: 8,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}>
        <BackButton onPress={() => navigation.goBack()} />
        <Body style={{ flex: 1, fontFamily: font.sansMedium, fontSize: 14 }}>Routines</Body>
        {server ? (
          <Button
            label="New"
            variant="ghost"
            onPress={() => void Linking.openURL(`${server.replace(/\/+$/, '')}/routines/new`)}
          />
        ) : null}
        {nav.button}
      </View>

      <ConnectionBanner onRetry={load} />

      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingBottom: insets.bottom + 24,
          gap: 16,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={c.mutedForeground}
          />
        }>
        <SheetSegments
          options={TABS.map(t =>
            t.key === 'routines' ? { ...t, label: `${t.label} · ${cards.length}` } : t,
          )}
          selected={tab}
          onSelect={setTab}
        />

        {error ? (
          <Body style={{ color: c.destructive, fontSize: 13 }}>{error}</Body>
        ) : null}

        {board === null ? <Hint>Loading…</Hint> : null}

        {board !== null && cards.length === 0 && board.heartbeat === null ? (
          <View style={{ gap: 10 }}>
            <Body style={{ fontFamily: font.sansMedium, fontSize: 16 }}>No routines yet</Body>
            <Hint>
              A routine is a prompt that runs itself — a morning triage, a digest on /digest, a
              webhook from CI — and only messages you when it has something to say. Writing one
              means choosing a model, a schedule and where the answer goes, so that form lives in
              the cockpit.
            </Hint>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {server ? (
                <Button
                  label="New routine"
                  variant="outline"
                  onPress={() =>
                    void Linking.openURL(`${server.replace(/\/+$/, '')}/routines/new`)
                  }
                />
              ) : null}
              <Button
                label="Set up the heartbeat"
                variant="ghost"
                busy={busy}
                onPress={() =>
                  void act(async () => {
                    const beat = await seam!.heartbeat();
                    await load();
                    if (beat) open(beat.id);
                    return null;
                  })
                }
              />
            </View>
          </View>
        ) : null}

        {board !== null && tab === 'runs' ? (
          <View style={{ gap: 16 }}>
            {board.failures.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Meta style={{ color: c.destructive }}>{needs(board.failures.length)}</Meta>
                {board.failures.map(failure => (
                  <FailureRow
                    key={failure.runId}
                    failure={failure}
                    busy={busy}
                    onOpen={() => open(failure.routineId, failure.runId)}
                    onRetry={() =>
                      void act(() => seam!.retryRoutineRun(failure.routineId, failure.runId))
                    }
                  />
                ))}
              </View>
            ) : null}

            {runs.length === 0 && cards.length > 0 ? <Hint>Nothing has run yet.</Hint> : null}

            {groupRuns(runs).map(group => (
              <View key={group.label}>
                <Meta style={{ paddingBottom: 6 }}>
                  {group.label} · {group.runs.length}
                </Meta>
                {group.runs.map(run => (
                  <RunRow key={run.id} run={run} onPress={() => open(run.routineId, run.id)} />
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {board !== null && tab === 'routines' ? (
          <View style={{ gap: 10 }}>
            {cards.map(card => (
              <RoutineTile
                key={card.id}
                card={card}
                busy={busy}
                onPress={() => open(card.id)}
                onToggle={on => setEnabled(card.id, on)}
              />
            ))}
            {cards.length === 0 ? <Hint>No routines yet.</Hint> : null}
            {board.upcoming.length > 0 ? (
              <Mono style={{ paddingTop: 4 }}>
                next · {board.upcoming.map(u => `${u.name} ${clock(u.at)}`).join(' · ')}
              </Mono>
            ) : null}
          </View>
        ) : null}

        {board !== null && tab === 'heartbeat' ? (
          board.heartbeat ? (
            <HeartbeatTile
              beat={board.heartbeat}
              busy={busy}
              onPress={() => open(board.heartbeat!.id)}
              onToggle={on => setEnabled(board.heartbeat!.id, on)}
            />
          ) : (
            <View style={{ gap: 10 }}>
              <Hint>
                The heartbeat is one check-in the system owns: it wakes on its own cadence, reads
                the notepad it keeps, and says something only when there is something to say. Other
                routines can ride it.
              </Hint>
              <Button
                label="Set up the heartbeat"
                variant="outline"
                busy={busy}
                onPress={() =>
                  void act(async () => {
                    const beat = await seam!.heartbeat();
                    await load();
                    if (beat) open(beat.id);
                    return null;
                  })
                }
              />
              <Hint>It is created paused, on the default cadence. Nothing runs until you say so.</Hint>
            </View>
          )
        ) : null}

        {board !== null && board.routines.length > 0 ? (
          <Mono style={{ paddingTop: 4 }}>
            {board.runsToday} {plural(board.runsToday, 'run')} today · {board.notifiedToday}{' '}
            notified · {board.quietToday} quiet
            {board.failedToday > 0 ? ` · ${board.failedToday} failed` : ''}
          </Mono>
        ) : null}
      </ScrollView>

      {nav.menu}
    </Screen>
  );
}

/** One failed routine, and the two things worth doing about it from here. */
function FailureRow({
  failure,
  busy,
  onOpen,
  onRetry,
}: {
  failure: RoutineFailure;
  busy: boolean;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const { c } = useTheme();
  const meta = failureMeta(failure);

  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        padding: 12,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: mix(c.destructive, 35),
        backgroundColor: pressed ? mix(c.destructive, 12) : mix(c.destructive, 6),
      })}>
      <View style={{ flex: 1, gap: 3 }}>
        <Body numberOfLines={1} style={{ fontSize: 14 }}>
          {failure.name} failed at {clock(failure.at)}
        </Body>
        {meta ? (
          <Mono numberOfLines={2} style={{ color: c.destructive }}>
            {meta}
          </Mono>
        ) : null}
      </View>
      <Pressable onPress={onRetry} disabled={busy} hitSlop={10}>
        <Mono style={{ color: c.primary, textDecorationLine: 'underline', opacity: busy ? 0.5 : 1 }}>
          retry
        </Mono>
      </Pressable>
    </Pressable>
  );
}

/** One run on the ledger: which routine, how it ended, what it said. */
function RunRow({ run, onPress }: { run: RunSummary; onPress: () => void }) {
  const theme = useTheme();
  const { c } = theme;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: c.border,
        backgroundColor: pressed ? mix(c.mutedForeground, 8) : 'transparent',
      })}>
      <View style={{ paddingTop: 4 }}>
        {run.outcome == null ? (
          <StatusDot running />
        ) : (
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: outcomeColor(run.outcome, theme),
            }}
          />
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Body numberOfLines={1} style={{ fontSize: 14 }}>
          {run.routineName}{' '}
          <Body style={{ fontSize: 12, color: outcomeColor(run.outcome, theme) }}>
            · {statusLabel(run.status)}
          </Body>
        </Body>
        <Mono numberOfLines={1}>{run.said ? firstWords(run.said, 80) : '—'}</Mono>
      </View>
      <Mono style={{ paddingTop: 2 }}>{clock(run.startedAt)}</Mono>
    </Pressable>
  );
}

/** One routine: the card is the link, the switch sits on it. */
function RoutineTile({
  card,
  busy,
  onPress,
  onToggle,
}: {
  card: RoutineCard;
  busy: boolean;
  onPress: () => void;
  onToggle: (on: boolean) => void;
}) {
  const theme = useTheme();
  const { c } = theme;
  const paused = !card.enabled || !card.scheduleEnabled;

  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: card.lastFailed ? mix(c.destructive, 35) : c.border,
        backgroundColor: c.card,
        opacity: card.enabled ? 1 : 0.65,
      }}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          padding: 12,
          gap: 8,
          opacity: pressed ? 0.7 : 1,
        })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {card.running ? (
            <StatusDot running />
          ) : (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: !card.enabled
                  ? c.border
                  : card.lastFailed
                    ? c.destructive
                    : theme.status.ok,
              }}
            />
          )}
          <Body numberOfLines={1} style={{ flex: 1, fontFamily: font.sansMedium, fontSize: 15 }}>
            {card.name}
          </Body>
          {/* The switch is outside the pressable's own press, so a thumb on it
              toggles rather than opening the routine. */}
          <Switch
            value={card.enabled}
            disabled={busy}
            onValueChange={onToggle}
            trackColor={{ true: c.primary, false: mix(c.mutedForeground, 30) }}
          />
        </View>

        <View style={{ gap: 2 }}>
          <Body numberOfLines={2} style={{ fontSize: 13.5 }}>
            {card.scheduleSentence}
          </Body>
          <Mono numberOfLines={1}>{card.scheduleMeta}</Mono>
        </View>

        <HistoryStrip history={card.history} />

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Mono style={{ flex: 1, color: outcomeColor(card.lastRun?.outcome, theme) }} numberOfLines={1}>
            {lastLabel(card)}
          </Mono>
          <Mono numberOfLines={1}>{nextLabel(card.nextFire, paused)}</Mono>
        </View>
      </Pressable>
    </View>
  );
}

/** The one routine the system owns. */
function HeartbeatTile({
  beat,
  busy,
  onPress,
  onToggle,
}: {
  beat: HeartbeatStatus;
  busy: boolean;
  onPress: () => void;
  onToggle: (on: boolean) => void;
}) {
  const theme = useTheme();
  const { c } = theme;

  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.card,
        opacity: beat.enabled ? 1 : 0.65,
      }}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({ padding: 12, gap: 8, opacity: pressed ? 0.7 : 1 })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {beat.running ? (
            <StatusDot running />
          ) : (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: beat.enabled ? theme.status.ok : c.border,
              }}
            />
          )}
          <Body style={{ flex: 1, fontFamily: font.sansMedium, fontSize: 15 }}>heartbeat</Body>
          <Switch
            value={beat.enabled}
            disabled={busy}
            onValueChange={onToggle}
            trackColor={{ true: c.primary, false: mix(c.mutedForeground, 30) }}
          />
        </View>

        <Mono numberOfLines={2}>{heartbeatMeta(beat)}</Mono>
        <Body numberOfLines={2} style={{ fontSize: 13.5 }}>
          {notepadLine(beat)}
        </Body>
        <Mono>
          today: {beat.quietToday} quiet · {beat.notifiedToday} notified
        </Mono>
      </Pressable>
    </View>
  );
}
