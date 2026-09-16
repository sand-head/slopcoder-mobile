/**
 * One routine: what starts it, what it has done, what it says.
 *
 * The header answers "is it on, and when does it next go"; the three tabs
 * answer the rest, in the cockpit's own order — the runs, the prompt, the
 * triggers. Tapping a run opens it in a sheet, which is where the desktop's
 * right-hand panel goes on a phone.
 *
 * What this screen writes is what you would reasonably change one-handed —
 * pause it, run it now, retry a failure, fix a sentence in the prompt, close
 * one door without touching the others, rotate a webhook's secret. The shape
 * of a routine — its schedule, its model, its repositories, where the answer
 * goes, the triggers themselves — is the editor's, which Edit and "+ add
 * trigger" present as a sheet over this screen. The heartbeat has no editor:
 * its cadence, hours and model are four fields on its Prompt tab, as on the
 * web.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  TextInput,
  View,
} from 'react-native';
import {
  AutomationKind,
  AutomationRunStatus,
  AutomationTriggerKind,
  type AutomationWebhookSecret,
  type ModelCandidate,
  type RoutineDetail,
  type RunDetail,
  type RunSummary,
  type TriggerStats,
} from '../api/contracts';
import {
  clock,
  duration,
  hhmm,
  nextLabel,
  runNote,
  spend,
  statusLabel,
  triggerKindName,
  when,
} from '../api/routines';
import { HEARTBEAT_INTERVALS, heartbeatDraft, timeOk } from '../api/routineEditor';
import { useAuth } from '../state/auth';
import {
  Body,
  Button,
  Field,
  GLYPHS,
  Hint,
  Meta,
  Mono,
  Screen,
  Skeleton,
  StatusDot,
  Prose,
} from '../ui/kit';
import { HistoryStrip, outcomeColor } from '../ui/HistoryStrip';
import { Sheet, SheetGroup, SheetSegments } from '../ui/Sheet';
import { SecretSheet } from '../ui/SecretSheet';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { useHeaderInset } from '../navigation/headers';
import { OverflowMenu } from '../ui/menu';
import { tapConfirm, tapRefuse, tapSelect } from '../ui/haptics';
import { font, mix, radius, useTheme } from '../theme';

/** How many runs one page of the log carries. */
const PAGE = 30;

/** As on the board: a tick while something is running, and only then. */
const POLL_MS = 15_000;

const TABS = [
  { key: 'runs', label: 'Runs' },
  { key: 'prompt', label: 'Prompt' },
  { key: 'triggers', label: 'Triggers' },
];

export function RoutineScreen({ route, navigation }: { route: any; navigation: any }) {
  const theme = useTheme();
  const { c } = theme;
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const seam = useAuth(s => s.seam);
  const server = useAuth(s => s.credential?.server);

  const id: string = route.params.id;

  const [detail, setDetail] = useState<RoutineDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [paging, setPaging] = useState(false);

  const [tab, setTab] = useState('runs');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The open run, and its detail once it lands. The board deep-links one in.
  const [selected, setSelected] = useState<string | null>(route.params.run ?? null);
  const [run, setRun] = useState<RunDetail | null>(null);

  // Two editable fields, each remembering what the server last said so "unsaved"
  // is a fact rather than a guess — and so a poll landing mid-sentence cannot
  // overwrite what is being typed.
  const [prompt, setPrompt] = useState('');
  const [storedPrompt, setStoredPrompt] = useState('');
  const [notepad, setNotepad] = useState('');
  const [storedNotepad, setStoredNotepad] = useState('');

  // The heartbeat's own four controls, and what the server last said they
  // were. Written as a full draft, so saving the interval cannot quietly
  // clear anything else.
  const [beatSettings, setBeatSettings] = useState({ interval: '', activeStart: '', activeEnd: '', model: '' });
  const [storedBeat, setStoredBeat] = useState(beatSettings);
  const [models, setModels] = useState<ModelCandidate[]>([]);
  const [modelSheet, setModelSheet] = useState(false);

  // A rotated webhook secret, readable exactly once.
  const [rotated, setRotated] = useState<AutomationWebhookSecret[]>([]);

  const load = useCallback(async () => {
    if (!seam) return;
    try {
      const [found, page] = await Promise.all([
        seam.routine(id),
        seam.routineRuns(id, 0, PAGE),
      ]);
      if (!found) {
        setMissing(true);
        return;
      }
      setDetail(found);
      setRuns(page.runs);
      setTotal(page.total);
      setError(null);

      setStoredPrompt(current => {
        // Only adopt the server's text when it is genuinely new; otherwise a
        // poll would undo whatever has been typed since.
        if (found.routine.prompt !== current) setPrompt(found.routine.prompt);
        return found.routine.prompt;
      });
      setStoredNotepad(current => {
        if (found.routine.notepad !== current) setNotepad(found.routine.notepad);
        return found.routine.notepad;
      });
      if (found.routine.kind === AutomationKind.Heartbeat) {
        const next = {
          interval: found.routine.cronExpression,
          activeStart: found.routine.activeHoursStart ? hhmm(found.routine.activeHoursStart) : '',
          activeEnd: found.routine.activeHoursEnd ? hhmm(found.routine.activeHoursEnd) : '',
          model: found.routine.model ?? '',
        };
        setStoredBeat(current => {
          const same =
            current.interval === next.interval &&
            current.activeStart === next.activeStart &&
            current.activeEnd === next.activeEnd &&
            current.model === next.model;
          if (!same) setBeatSettings(next);
          return same ? current : next;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [seam, id]);

  // On mount, and again whenever the editor's sheet comes down over it.
  useEffect(() => {
    void load();
    return navigation.addListener('focus', load);
  }, [load, navigation]);

  // The model list is only for the heartbeat's picker, and only a convenience.
  useEffect(() => {
    if (!seam || detail?.routine.kind !== AutomationKind.Heartbeat) return;
    let live = true;
    seam
      .models()
      .then(m => live && setModels(m))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [seam, detail?.routine.kind]);

  const running = detail?.running ?? false;
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void loadRef.current(), POLL_MS);
    return () => clearInterval(timer);
  }, [running]);

  // The selected run, fetched on its own: the summary in the list has the line
  // it said, the detail has the tools it called and what it cost.
  useEffect(() => {
    if (!seam || !selected) {
      setRun(null);
      return;
    }
    let live = true;
    setRun(null);
    seam
      .routineRun(id, selected)
      .then(found => live && setRun(found))
      .catch(() => live && setSelected(null));
    return () => {
      live = false;
    };
  }, [seam, id, selected]);

  const act = async (command: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      setError(await command());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadMore = async () => {
    if (!seam || paging) return;
    setPaging(true);
    try {
      const page = await seam.routineRuns(id, runs.length, PAGE);
      setRuns(current => [...current, ...page.runs]);
      setTotal(page.total);
    } finally {
      setPaging(false);
    }
  };

  const remove = useCallback(() => {
    const name = detail?.routine.name ?? 'this routine';
    Alert.alert(`Delete “${name}”?`, 'It stops running and its run history goes with it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          tapRefuse();
          await seam?.deleteRoutine(id);
          navigation.goBack();
        },
      },
    ]);
  }, [detail?.routine.name, seam, id, navigation]);

  const routine = detail?.routine;
  const beat = routine?.kind === AutomationKind.Heartbeat;
  const paused = !routine?.enabled || !routine?.scheduleEnabled;
  const beatModelLabel = beatSettings.model
    ? models.find(m => m.modelId === beatSettings.model)?.modelDisplayName ?? beatSettings.model
    : 'auto';
  const beatDirty =
    beatSettings.interval !== storedBeat.interval ||
    beatSettings.activeStart !== storedBeat.activeStart ||
    beatSettings.activeEnd !== storedBeat.activeEnd ||
    beatSettings.model !== storedBeat.model;

  // The bar: the routine's name, its switch, and the menu the cockpit's
  // card carries — open the session, edit it (in the browser, over this
  // screen), delete it.
  const sessionId = routine?.sessionId ?? null;
  const enabled = routine?.enabled ?? false;
  const name = routine?.name ?? 'Routine';
  useLayoutEffect(() => {
    navigation.setOptions({
      title: name,
      headerRight: () =>
        routine ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Switch
              value={enabled}
              disabled={busy}
              accessibilityLabel={`${name} enabled`}
              onValueChange={on => {
                setDetail(d => (d ? { ...d, routine: { ...d.routine, enabled: on } } : d));
                void act(() => seam!.setRoutineEnabled(id, on));
              }}
              trackColor={{ true: c.primary, false: mix(c.mutedForeground, 30) }}
            />
            <OverflowMenu
              title={name}
              items={[
                ...(sessionId
                  ? [{ key: 'session', title: 'Open session', symbol: 'bubble.left', onPress: () => navigation.navigate('Session', { id: sessionId }) }]
                  : []),
                ...(!beat
                  ? [{ key: 'edit', title: 'Edit', symbol: 'pencil', onPress: () => navigation.navigate('RoutineEditor', { id }) }]
                  : []),
                { key: 'delete', title: 'Delete', symbol: 'trash', destructive: true, onPress: remove },
              ]}>
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="More"
                style={({ pressed }) => ({
                  width: 36,
                  height: 36,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.5 : 1,
                })}>
                <Body style={{ fontFamily: font.mono, fontSize: 18, color: c.primary }}>{GLYPHS.more}</Body>
              </Pressable>
            </OverflowMenu>
          </View>
        ) : null,
    });
    // `act` and `routine` change identity every render; the values the bar
    // reads are listed instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, name, enabled, busy, sessionId, beat, id, remove, c.primary, c.mutedForeground, !!routine]);

  if (missing) {
    return (
      <Screen>
        <View style={{ padding: 20, paddingTop: headerInset + 20, gap: 8 }}>
          <Body style={{ fontFamily: font.sansMedium, fontSize: 16 }}>No such routine</Body>
          <Hint>It was deleted, or it belongs to someone else.</Hint>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      {/* Over the page, below the bar: the page insets itself for the bar,
          and a banner in the flow above it would be under it. */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: headerInset, left: 0, right: 0, zIndex: 1 }}>
        <ConnectionBanner onRetry={load} />
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        // A pushed screen has no tab bar under it, so the page's own foot has
        // to clear the home indicator.
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 16 }}
        keyboardShouldPersistTaps="handled"
        // The prompt editor sits at the foot of this page; without these the
        // keyboard covered it and the Save row, and the page could not scroll
        // to the caret.
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
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
        {error ? (
          <Body accessibilityLiveRegion="polite" style={{ color: c.destructive, fontSize: 13 }}>
            {error}
          </Body>
        ) : null}

        {!detail && !error ? <Skeleton rows={4} /> : null}

        {detail && routine ? (
          <>
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {detail.running ? <StatusDot running /> : null}
                <Body style={{ flex: 1, fontSize: 13.5 }}>{detail.scheduleSentence}</Body>
              </View>
              <Mono>{detail.scheduleMeta}</Mono>
              <Mono>
                {nextLabel(detail.nextFire, paused)} · notifies {detail.notifiesLabel} · model{' '}
                {routine.model ?? 'auto'}
              </Mono>
              {routine.nodeIds.length > 0 ? (
                <Mono style={{ color: c.destructive }}>
                  runs shell on {routine.nodeIds.length}{' '}
                  {routine.nodeIds.length === 1 ? 'machine' : 'machines'}, unattended
                </Mono>
              ) : null}
            </View>

            <View style={{ gap: 8 }}>
              <HistoryStrip history={detail.history} height={22} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                <Mono>{detail.runs30d} runs · 30d</Mono>
                <Mono style={{ color: theme.status.ok }}>{detail.notified30d} notified</Mono>
                <Mono style={{ color: c.destructive }}>{detail.failed30d} failed</Mono>
                <Mono>
                  {detail.medianDurationMs != null
                    ? `${duration(detail.medianDurationMs)} median`
                    : 'no median yet'}
                </Mono>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Button
                label="Run now"
                variant="outline"
                busy={busy}
                onPress={() => {
                  tapConfirm();
                  void act(() => seam!.runRoutineNow(id));
                }}
              />
            </View>

            <SheetSegments
              options={TABS}
              selected={tab}
              onSelect={next => {
                if (next !== tab) tapSelect();
                setTab(next);
              }}
            />

            {tab === 'runs' ? (
              <View>
                {runs.length === 0 ? <Hint>No runs yet.</Hint> : null}
                {runs.map(row => (
                  <RunRow key={row.id} run={row} onPress={() => setSelected(row.id)} />
                ))}
                {runs.length < total ? (
                  <Pressable onPress={loadMore} style={{ paddingVertical: 14 }} hitSlop={8} accessibilityRole="button">
                    <Mono style={{ color: c.primary, textDecorationLine: 'underline' }}>
                      {paging ? 'loading…' : `load more · ${runs.length} of ${total}`}
                    </Mono>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {tab === 'prompt' ? (
              beat ? (
                <View style={{ gap: 10 }}>
                  <Hint>
                    The check-in's prompt is fixed — what it watches is the notepad, and the agent
                    keeps that current with set_notepad.
                  </Hint>
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: radius.md,
                      backgroundColor: mix(c.muted, 30),
                      padding: 10,
                    }}>
                    <Mono style={{ fontSize: 11.5, lineHeight: 17, color: c.foreground }}>
                      {routine.prompt}
                    </Mono>
                  </View>

                  <Meta>notepad</Meta>
                  <Editor
                    value={notepad}
                    onChangeText={setNotepad}
                    placeholder="What the check-in watches."
                  />
                  <SaveRow
                    dirty={notepad !== storedNotepad}
                    busy={busy}
                    label="Save notepad"
                    onSave={() => void act(() => seam!.setRoutineNotepad(id, notepad))}
                  />
                  <Meta style={{ paddingTop: 6 }}>schedule</Meta>
                  <SheetSegments
                    label="every"
                    options={HEARTBEAT_INTERVALS}
                    selected={beatSettings.interval}
                    onSelect={key => {
                      tapSelect();
                      setBeatSettings(b => ({ ...b, interval: key }));
                    }}
                  />
                  <View style={{ gap: 6 }}>
                    <Meta>active hours</Meta>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Field
                        value={beatSettings.activeStart}
                        onChangeText={text => setBeatSettings(b => ({ ...b, activeStart: text }))}
                        placeholder="any"
                        keyboardType="numbers-and-punctuation"
                        accessibilityLabel="Active from"
                        style={{ flex: 1 }}
                      />
                      <Mono>–</Mono>
                      <Field
                        value={beatSettings.activeEnd}
                        onChangeText={text => setBeatSettings(b => ({ ...b, activeEnd: text }))}
                        placeholder="any"
                        keyboardType="numbers-and-punctuation"
                        accessibilityLabel="Active until"
                        style={{ flex: 1 }}
                      />
                    </View>
                    <Hint>Beats may only start inside this window, as HH:MM. Blank means any time.</Hint>
                  </View>
                  <Pressable
                    onPress={() => setModelSheet(true)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Model: ${beatModelLabel}`}
                    style={({ pressed }) => ({
                      minHeight: 44,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      paddingHorizontal: 12,
                      borderWidth: 1,
                      borderColor: c.input,
                      borderRadius: radius.md,
                      backgroundColor: pressed ? mix(c.mutedForeground, 8) : c.background,
                    })}>
                    <Meta>model</Meta>
                    <Body numberOfLines={1} style={{ flex: 1, fontSize: 15, textAlign: 'right' }}>
                      {beatModelLabel}
                    </Body>
                    <Mono style={{ fontSize: 13 }}>›</Mono>
                  </Pressable>
                  <SaveRow
                    dirty={beatDirty}
                    busy={busy}
                    label="Save schedule"
                    onSave={() => {
                      if (!timeOk(beatSettings.activeStart) || !timeOk(beatSettings.activeEnd)) {
                        setError('Active hours read as HH:MM.');
                        return;
                      }
                      void act(async () => (await seam!.updateRoutine(id, heartbeatDraft(routine, beatSettings))).error);
                    }}
                  />
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  <Editor
                    value={prompt}
                    onChangeText={setPrompt}
                    placeholder="What to do each run. It arrives with no conversation around it."
                  />
                  <SaveRow
                    dirty={prompt !== storedPrompt}
                    busy={busy}
                    label="Save"
                    onSave={() => void act(() => seam!.setRoutinePrompt(id, prompt))}
                  />
                </View>
              )
            ) : null}

            {tab === 'triggers' ? (
              <View>
                <Meta style={{ paddingBottom: 6 }}>
                  triggers · {detail.triggers.length} ·{' '}
                  {detail.triggers.reduce((sum, t) => sum + t.fires30d, 0)} fires in 30d
                </Meta>
                {detail.triggers.length === 0 ? (
                  <Hint>
                    {beat
                      ? 'The heartbeat has no triggers of its own — it is what other routines ride.'
                      : 'Nothing starts this yet — add a schedule, or a trigger.'}
                  </Hint>
                ) : null}
                {detail.triggers.map(trigger => (
                  <TriggerRow
                    key={trigger.triggerId}
                    trigger={trigger}
                    busy={busy}
                    onFire={() => void act(() => seam!.fireTrigger(id, trigger.triggerId))}
                    onToggle={on =>
                      void act(() => seam!.setTriggerEnabled(id, trigger.triggerId, on))
                    }
                    onRotate={
                      trigger.kind === AutomationTriggerKind.Webhook
                        ? () =>
                            Alert.alert(
                              'Rotate the secret?',
                              'The old one stops working at once; the URL keeps its address.',
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Rotate',
                                  style: 'destructive',
                                  onPress: () =>
                                    void act(async () => {
                                      const result = await seam!.rotateWebhookSecret(id, trigger.triggerId);
                                      if (!result.error) setRotated(result.webhooks);
                                      return result.error;
                                    }),
                                },
                              ],
                            )
                        : undefined
                    }
                  />
                ))}
                {!beat ? (
                  <View style={{ paddingTop: 10, alignItems: 'flex-start' }}>
                    <Button
                      label="+ Add trigger"
                      variant="outline"
                      onPress={() => navigation.navigate('RoutineEditor', { id, add: true })}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <Sheet visible={modelSheet} title="Model" onClose={() => setModelSheet(false)}>
        <SheetGroup
          options={[
            { key: '', label: 'Auto', description: 'Let the router pick per beat' },
            ...models.map(m => ({ key: m.modelId, label: m.modelDisplayName || m.modelId, description: m.connectionName })),
          ]}
          selected={beatSettings.model}
          onSelect={key => {
            setBeatSettings(b => ({ ...b, model: key }));
            setModelSheet(false);
          }}
        />
      </Sheet>

      <SecretSheet secrets={rotated} server={server} onContinue={() => setRotated([])} />

      <Sheet
        visible={selected !== null}
        title={run ? `Run · ${when(run.run.startedAt)}` : 'Run'}
        onClose={() => setSelected(null)}>
        {run ? (
          <RunPanel
            run={run}
            busy={busy}
            onRetry={() => {
              setSelected(null);
              void act(() => seam!.retryRoutineRun(id, run.run.id));
            }}
            onOpenSession={
              run.sessionId
                ? () => {
                    setSelected(null);
                    navigation.navigate('Session', { id: run.sessionId });
                  }
                : undefined
            }
          />
        ) : (
          <Hint>Loading…</Hint>
        )}
      </Sheet>
    </Screen>
  );
}

/** One row of the run log: when, how it ended, how long, what it said. */
function RunRow({ run, onPress }: { run: RunSummary; onPress: () => void }) {
  const theme = useTheme();
  const { c } = theme;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${when(run.startedAt)}, ${statusLabel(run.status)}`}
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
        {run.status === AutomationRunStatus.Running ? (
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
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Body style={{ flex: 1, fontSize: 13.5 }}>{when(run.startedAt)}</Body>
          <Mono style={{ color: outcomeColor(run.outcome, theme) }}>{statusLabel(run.status)}</Mono>
          <Mono>{run.durationMs != null ? duration(run.durationMs) : '—'}</Mono>
        </View>
        <Mono numberOfLines={1}>{run.error ?? run.said ?? '—'}</Mono>
      </View>
    </Pressable>
  );
}

/** One trigger: what it listens for, how often it has, and whether it is open. */
function TriggerRow({
  trigger,
  busy,
  onFire,
  onToggle,
  onRotate,
}: {
  trigger: TriggerStats;
  busy: boolean;
  onFire: () => void;
  onToggle: (on: boolean) => void;
  /** A webhook's only other verb: mint a new secret, shown once. */
  onRotate?: () => void;
}) {
  const { c } = useTheme();

  const meta = [
    trigger.lastFired ? `last ${when(trigger.lastFired)}` : 'never fired',
    trigger.lastFiredBy ?? null,
    `${trigger.fires30d} in 30d`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View
      style={{
        paddingVertical: 12,
        gap: 8,
        borderTopWidth: 1,
        borderTopColor: c.border,
        opacity: trigger.enabled ? 1 : 0.55,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Body numberOfLines={2} style={{ fontSize: 13.5 }}>
            {triggerKindName(trigger.kind, trigger.channel)} · {trigger.summary}
          </Body>
          <Mono numberOfLines={1}>{meta}</Mono>
        </View>
        <Switch
          value={trigger.enabled}
          disabled={busy}
          accessibilityLabel={`${trigger.summary} enabled`}
          onValueChange={onToggle}
          trackColor={{ true: c.primary, false: mix(c.mutedForeground, 30) }}
        />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <HistoryStrip history={trigger.history} height={12} />
        </View>
        {onRotate ? (
          <Pressable onPress={onRotate} disabled={busy} hitSlop={10} accessibilityRole="button" accessibilityLabel="Rotate secret">
            <Mono
              style={{ color: c.primary, textDecorationLine: 'underline', opacity: busy ? 0.5 : 1 }}>
              rotate secret
            </Mono>
          </Pressable>
        ) : null}
        <Pressable onPress={onFire} disabled={busy} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fire trigger">
          <Mono
            style={{ color: c.primary, textDecorationLine: 'underline', opacity: busy ? 0.5 : 1 }}>
            fire
          </Mono>
        </Pressable>
      </View>
    </View>
  );
}

/** A multi-line box for the two pieces of text this screen can write. */
function Editor({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
}) {
  const { c } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={c.mutedForeground}
      multiline
      textAlignVertical="top"
      autoCapitalize="sentences"
      autoCorrect={false}
      style={{
        minHeight: 180,
        borderWidth: 1,
        borderColor: c.input,
        borderRadius: radius.md,
        padding: 12,
        // 16px or iOS zooms on focus.
        fontSize: 16,
        lineHeight: 23,
        fontFamily: font.sans,
        color: c.foreground,
        backgroundColor: c.background,
      }}
    />
  );
}

function SaveRow({
  dirty,
  busy,
  label,
  onSave,
}: {
  dirty: boolean;
  busy: boolean;
  label: string;
  onSave: () => void;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Button label={label} onPress={onSave} disabled={!dirty} busy={busy} />
      {dirty ? <Mono style={{ color: c.primary }}>unsaved</Mono> : null}
    </View>
  );
}

/** One run, replayed: what it spent, what it called, what it finally said. */
function RunPanel({
  run,
  busy,
  onRetry,
  onOpenSession,
}: {
  run: RunDetail;
  busy: boolean;
  onRetry: () => void;
  onOpenSession?: () => void;
}) {
  const theme = useTheme();
  const { c } = theme;
  const line = spend(run);

  return (
    <View style={{ gap: 14 }}>
      {line ? <Mono>{line}</Mono> : null}

      <View style={{ gap: 6 }}>
        {run.steps.length === 0 ? (
          <Mono>
            {run.sessionId === null
              ? 'this run never reached a session'
              : 'no tool calls — it answered straight away'}
          </Mono>
        ) : null}
        {run.steps.map((step, index) => (
          <View key={index} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                marginTop: 6,
                backgroundColor: step.ok ? c.border : c.destructive,
              }}
            />
            <Mono style={{ color: c.foreground }}>{step.symbol}</Mono>
            <Mono numberOfLines={1} style={{ flex: 1 }}>
              {step.name}
            </Mono>
            {step.meta ? <Mono numberOfLines={1}>{step.meta}</Mono> : null}
          </View>
        ))}
      </View>

      {run.finalMessage ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: c.border,
            paddingTop: 10,
          }}>
          <Prose>{run.finalMessage}</Prose>
        </View>
      ) : null}

      <Mono style={{ color: outcomeColor(run.run.outcome, theme) }}>{runNote(run)}</Mono>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          label={run.run.status === AutomationRunStatus.Failed ? 'Retry' : 'Run again'}
          variant="outline"
          busy={busy}
          onPress={onRetry}
        />
        {onOpenSession ? (
          <Button label="Open session" variant="ghost" onPress={onOpenSession} />
        ) : null}
      </View>

      <Mono>started {clock(run.run.startedAt)}</Mono>
    </View>
  );
}
