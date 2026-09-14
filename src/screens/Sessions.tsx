/**
 * The launcher, and the session list — one screen, as on the web.
 *
 * Running sessions are inset cards; idle ones are flush hairline rows. That is
 * not decoration: it is the only signal on the list that something is happening
 * without you.
 *
 * The bar is the platform's: a large title that collapses as you scroll and a
 * search field inside it. The composer under it is the one way to start a
 * session — a separate new-session screen used to exist with the same composer
 * on it, and there was no telling why.
 *
 * Each row carries a native context menu — a long press, or the `…` — for
 * rename and delete. `Alert.alert` was standing in for that menu, which on iOS
 * is a centred dialog and on Android cannot style a destructive row.
 */
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  Alert,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native';
import {
  ApprovalMode,
  DeleteResult,
  SessionStatus,
  type FacetOption,
  type ModelCandidate,
  type RemoteNodeSummary,
  type RoutineStatus,
  type SessionSummary,
} from '../api/contracts';
import { useAuth } from '../state/auth';
import { clock, deviceZone, firstWords, soon } from '../api/routines';
import { useOwnedRepos } from '../state/repos';
import { rowToChoice } from '../api/repoPicker';
import { useSessionHub } from '../state/hub';
import {
  Body,
  Button,
  Field,
  GLYPHS,
  Hint,
  Meta,
  Mono,
  Screen,
  SectionLabel,
  Skeleton,
  StatusDot,
  stamp,
} from '../ui/kit';
import { Composer, shortRepo, type TurnOptions } from '../ui/Composer';
import { OverflowMenu } from '../ui/menu';
import { Sheet } from '../ui/Sheet';
import { useRoutineAlert } from '../state/routines';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { useConnection } from '../state/connection';
import { tapConfirm, tapError, tapRefuse } from '../ui/haptics';
import { font, radius, useTheme } from '../theme';

export function SessionsScreen({ navigation }: { navigation: any }) {
  const { c } = useTheme();
  const seam = useAuth(s => s.seam);
  const { hub } = useSessionHub();
  const setFailed = useRoutineAlert(s => s.setFailed);

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<SessionSummary | null>(null);
  const [routines, setRoutines] = useState<RoutineStatus | null>(null);

  const [prompt, setPrompt] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelCandidate[]>([]);
  const [facets, setFacets] = useState<FacetOption[]>([]);
  const [repos, setRepos] = useState<string[]>([]);
  const [nodes, setNodes] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [allNodes, setAllNodes] = useState<RemoteNodeSummary[]>([]);
  const owned = useOwnedRepos(seam);
  const [options, setOptions] = useState<TurnOptions>({
    selection: { auto: true, connectionId: null, modelId: null },
    thinking: null,
    approval: ApprovalMode.Dangerous,
    facet: null,
  });

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Sessions',
      headerSearchBarOptions: {
        placeholder: 'Search sessions',
        autoCapitalize: 'none',
        hideWhenScrolling: true,
        onChangeText: (event: { nativeEvent: { text: string } }) => setQuery(event.nativeEvent.text),
        onCancelButtonPress: () => setQuery(''),
      },
    });
  }, [navigation]);

  useEffect(() => {
    if (!seam) return;
    void Promise.all([seam.models(), seam.facets(), seam.recentRepos(), seam.nodes()]).then(
      ([m, f, r, n]) => {
        setModels(m);
        setFacets(f);
        setRecent(r);
        setAllNodes(n);
      },
    );
  }, [seam]);

  /** The launcher's own two-call start, as on the web: create, then run. */
  const start = async () => {
    if (!seam) return;
    const text = prompt.trim();
    if (!text) return;

    setStarting(true);
    setStartError(null);
    try {
      const id = await seam.createSession({
        selection: options.selection,
        initialPrompt: text,
        repoUrls: repos.length > 0 ? repos : null,
        thinkingLevel: options.thinking,
        facet: options.facet,
        nodeIds: nodes.length > 0 ? nodes : null,
      });
      if (!id) {
        tapError();
        setStartError('That model selection is no longer available.');
        return;
      }

      // The one setting with no create-time field.
      if (options.approval !== ApprovalMode.Dangerous) {
        await seam.setApprovalMode(id, { mode: options.approval, useClassifier: true });
      }
      await seam.start(id, { prompt: text, selection: options.selection });
      tapConfirm();

      setPrompt('');
      setRepos([]);
      setNodes([]);
      navigation.navigate('Session', { id });
    } catch (e) {
      tapError();
      // The message, not the exception: "TypeError: Network request failed"
      // is not a sentence for anybody.
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const load = useCallback(async () => {
    if (!seam) return;
    try {
      const next = await seam.sessions();
      // Rows that appear, leave or change section slide rather than snap.
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setSessions(next);
      setError(null);
      // The strip's one read, and a cheap one: it says whether anything needs
      // you without the board's aggregation. A failure here is not the session
      // list's problem, so it is caught on its own.
      seam
        .routineStatus(deviceZone())
        .then(status => {
          setRoutines(status);
          // The tab's badge, from a read the strip was making anyway.
          setFailed(status.anyFailed);
        })
        .catch(() => {});
    } catch (e) {
      // OfflineError already carries the useful sentence; the banner says the
      // rest, so this only needs to explain a server that answered badly.
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [seam, setFailed]);

  useEffect(() => {
    void load();
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [load, navigation]);

  // The registry push carries no payload by design — it means "re-list".
  useEffect(() => hub?.addRegistryListener(() => void load()), [hub, load]);

  // And once the server is answering again, refresh without being asked: the
  // list is the first thing anyone looks at after a reconnect.
  const recoveries = useConnection(s => s.recoveries);
  useEffect(() => {
    if (recoveries > 0) void load();
  }, [recoveries, load]);

  const rename = async (session: SessionSummary, name: string) => {
    const trimmed = name.trim();
    if (!seam || !trimmed || trimmed === session.title) return;
    await seam.rename(session.id, trimmed);
    await load();
  };

  const askRename = (session: SessionSummary) => {
    if (Platform.OS === 'ios') {
      // The platform's own text prompt; it focuses the field and brings the
      // keyboard, which a hand-rolled modal had to be taught one trap at a time.
      Alert.prompt(
        'Rename session',
        undefined,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Rename', onPress: name => void rename(session, name ?? '') },
        ],
        'plain-text',
        session.title,
      );
      return;
    }
    setRenaming(session);
  };

  const remove = (session: SessionSummary) => {
    Alert.alert(`Delete “${session.title}”?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const answer = await seam?.deleteSession(session.id);
          if (answer?.result === DeleteResult.Running) {
            // The server refuses to delete a session mid-turn rather than pull
            // it out from under the harness. Silence here read as a tap that
            // did nothing.
            tapError();
            Alert.alert('Still running', 'Stop the session before deleting it.');
            return;
          }
          tapRefuse();
          await load();
        },
      },
    ]);
  };

  const needle = query.trim().toLowerCase();
  const visible = (sessions ?? []).filter(
    s => needle === '' || s.title.toLowerCase().includes(needle) || s.model.toLowerCase().includes(needle),
  );
  const running = visible.filter(s => s.status === SessionStatus.Running);
  const idle = visible.filter(s => s.status !== SessionStatus.Running);

  const open = (session: SessionSummary) => navigation.navigate('Session', { id: session.id });

  return (
    <Screen>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        // The composer's buttons sit inside this scroll view. Without this, a
        // tap on one while the keyboard is up only dismisses the keyboard and
        // the button is not pressed until the second tap.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // iOS: the page grows to keep the composer's caret above the keyboard.
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 18 }}
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
        <ConnectionBanner onRetry={load} />

        <Body style={{ fontFamily: font.sansMedium, fontSize: 22 }}>What’s next?</Body>

        <Composer
          value={prompt}
          onChangeValue={setPrompt}
          placeholder="Describe a task…"
          action="Start"
          onAction={start}
          busy={starting}
          disabled={!prompt.trim()}
          options={options}
          onChangeOptions={setOptions}
          models={models}
          facets={facets}
          attachments={{
            repos,
            nodes,
            recentRepos: recent.map(url => ({ key: url, label: shortRepo(url) })),
            ownedRepos: owned.repos,
            ownedLoaded: owned.loaded,
            ownedError: owned.error,
            availableNodes: allNodes
              .filter(n => n.enabled)
              .map(n => ({ key: n.id, label: n.name, description: n.host })),
            searchRepos: async query => ((await seam?.searchRepos(query)) ?? []).map(rowToChoice),
            onChange: next => {
              setRepos(next.repos);
              setNodes(next.nodes);
            },
          }}
        />

        {/* The start's own error, under the thing that failed, with a retry
            that retries the start — not a reload of the list. */}
        {startError ? (
          <View style={{ gap: 8 }}>
            <Body accessibilityLiveRegion="polite" style={{ color: c.destructive, fontSize: 13 }}>
              {startError}
            </Body>
            <Pressable onPress={start} hitSlop={8} accessibilityRole="button">
              <Mono style={{ color: c.primary, textDecorationLine: 'underline' }}>Try again</Mono>
            </Pressable>
          </View>
        ) : null}

        {error ? (
          <View style={{ gap: 8 }}>
            <Body accessibilityLiveRegion="polite" style={{ color: c.destructive, fontSize: 13 }}>
              {error}
            </Body>
            <Pressable onPress={load} hitSlop={8} accessibilityRole="button">
              <Mono style={{ color: c.primary, textDecorationLine: 'underline' }}>Try again</Mono>
            </Pressable>
          </View>
        ) : null}

        {sessions === null && !error ? (
          <Skeleton rows={5} />
        ) : sessions !== null && sessions.length === 0 ? (
          <Hint>No sessions yet. Start one above, or ask Siri.</Hint>
        ) : sessions !== null && visible.length === 0 ? (
          <Hint>Nothing matches “{query.trim()}”.</Hint>
        ) : null}

        {running.length > 0 ? (
          <View>
            <SectionLabel label="running" count={running.length} />
            <View style={{ gap: 8 }}>
              {running.map(session => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onPress={() => open(session)}
                  onRename={() => askRename(session)}
                  onDelete={() => remove(session)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {idle.length > 0 ? (
          <View>
            <SectionLabel label="idle" count={idle.length} />
            {idle.map(session => (
              <SessionCard
                key={session.id}
                session={session}
                flush
                onPress={() => open(session)}
                onRename={() => askRename(session)}
                onDelete={() => remove(session)}
              />
            ))}
          </View>
        ) : null}

        {routines?.anyRoutines && needle === '' ? (
          <RoutineStrip
            status={routines}
            onAll={() => navigation.navigate('RoutinesTab')}
            onOpen={(id, run) => navigation.navigate('Routine', { id, run })}
            onRetry={async (id, run) => {
              await seam?.retryRoutineRun(id, run);
              setRoutines(await seam!.routineStatus(deviceZone()));
            }}
          />
        ) : null}
      </ScrollView>

      {/* Android has no `Alert.prompt`; a sheet with the field already focused
          is the nearest thing to one. */}
      {Platform.OS !== 'ios' ? (
        <RenameSheet
          session={renaming}
          onClose={() => setRenaming(null)}
          onRename={name => {
            const target = renaming;
            setRenaming(null);
            if (target) void rename(target, name);
          }}
        />
      ) : null}
    </Screen>
  );
}

function RenameSheet({
  session,
  onClose,
  onRename,
}: {
  session: SessionSummary | null;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState('');
  useEffect(() => {
    if (session) setDraft(session.title);
  }, [session]);

  return (
    <Sheet visible={session !== null} title="Rename session" onClose={onClose}>
      <Field
        value={draft}
        onChangeText={setDraft}
        autoCapitalize="sentences"
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
        onSubmitEditing={() => onRename(draft)}
        accessibilityLabel="Session name"
      />
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
        <Button label="Cancel" variant="outline" onPress={onClose} />
        <Button label="Rename" onPress={() => onRename(draft)} disabled={!draft.trim()} />
      </View>
    </Sheet>
  );
}

function SessionCard({
  session,
  onPress,
  onRename,
  onDelete,
  flush,
}: {
  session: SessionSummary;
  onPress: () => void;
  onRename: () => void;
  onDelete: () => void;
  flush?: boolean;
}) {
  const { c } = useTheme();
  const running = session.status === SessionStatus.Running;
  const offline = session.clientWorkspace != null && session.workspaceConnected === false;

  const items = [
    { key: 'rename', title: 'Rename', symbol: 'pencil', onPress: onRename },
    { key: 'delete', title: 'Delete', symbol: 'trash', destructive: true, onPress: onDelete },
  ];

  return (
    <View
      style={
        flush
          ? { borderTopWidth: 1, borderTopColor: c.border }
          : {
              backgroundColor: c.card,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: radius.md,
            }
      }>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 10,
          paddingHorizontal: flush ? 0 : 12,
          paddingVertical: 12,
          minHeight: 44,
        }}>
        {/* The whole row is the link; a long press on it is the menu. */}
        <OverflowMenu title={session.title} items={items} longPress style={{ flex: 1 }}>
          <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`${session.title}, ${running ? 'running' : 'idle'}`}
            accessibilityHint="Opens the session. Long press for more."
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 10,
              opacity: pressed ? 0.6 : 1,
            })}>
            <View style={{ paddingTop: 5 }}>
              <StatusDot running={running} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Body numberOfLines={1}>{session.title}</Body>
              <Mono numberOfLines={1}>
                {stamp(session.createdAt)} · {session.autoRoute ? 'auto' : session.model}
              </Mono>
              {offline ? <Meta style={{ color: c.destructive }}>workspace offline</Meta> : null}
            </View>
          </Pressable>
        </OverflowMenu>

        <OverflowMenu title={session.title} items={items}>
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="More"
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.5 : 1,
            })}>
            <Body style={{ fontFamily: font.mono, fontSize: 16, color: c.mutedForeground }}>
              {GLYPHS.more}
            </Body>
          </Pressable>
        </OverflowMenu>
      </View>
    </View>
  );
}

/**
 * What the routines have been doing, at the foot of the page you land on: what
 * broke, what one of them last said, what is next. Nothing at all until there
 * is a routine to report on — the same rule the cockpit's strip follows, and
 * the reason an account with no routines never learns the feature exists from
 * an empty box.
 */
function RoutineStrip({
  status,
  onAll,
  onOpen,
  onRetry,
}: {
  status: RoutineStatus;
  onAll: () => void;
  onOpen: (routineId: string, runId?: string) => void;
  onRetry: (routineId: string, runId: string) => Promise<void>;
}) {
  const theme = useTheme();
  const { c } = theme;
  const [retrying, setRetrying] = useState(false);

  return (
    <View style={{ gap: 8, paddingTop: 4, borderTopWidth: 1, borderTopColor: c.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10 }}>
        {status.anyFailed ? (
          <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.destructive }} />
        ) : null}
        <Meta style={{ flex: 1 }}>routines</Meta>
        <Pressable onPress={onAll} hitSlop={10} accessibilityRole="button">
          <Mono style={{ color: c.primary }}>all routines ›</Mono>
        </Pressable>
      </View>

      {status.newestFailure ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            style={{ flex: 1 }}
            accessibilityRole="button"
            onPress={() => onOpen(status.newestFailure!.routineId, status.newestFailure!.runId)}>
            <Mono numberOfLines={1} style={{ color: c.destructive }}>
              {status.newestFailure.name} failed {clock(status.newestFailure.at)}
            </Mono>
          </Pressable>
          <Pressable
            disabled={retrying}
            hitSlop={10}
            accessibilityRole="button"
            onPress={async () => {
              setRetrying(true);
              try {
                await onRetry(status.newestFailure!.routineId, status.newestFailure!.runId);
              } finally {
                setRetrying(false);
              }
            }}>
            <Mono style={{ color: c.primary, textDecorationLine: 'underline' }}>retry</Mono>
          </Pressable>
        </View>
      ) : null}

      {status.latestNotified ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpen(status.latestNotified!.routineId, status.latestNotified!.id)}>
          <Mono numberOfLines={1}>
            <Mono style={{ color: theme.status.ok }}>{status.latestNotified.routineName}</Mono>{' '}
            {clock(status.latestNotified.startedAt)}
            {status.latestNotified.said ? ` · ${firstWords(status.latestNotified.said)}` : ''}
          </Mono>
        </Pressable>
      ) : null}

      {status.upcoming.length > 0 ? (
        <Mono numberOfLines={1}>
          next · {status.upcoming.map(u => `${u.name} ${soon(u.at)}`).join(' · ')}
        </Mono>
      ) : null}
    </View>
  );
}
