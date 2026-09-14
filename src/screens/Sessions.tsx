/**
 * The launcher, and the session list — one screen, as on the web.
 *
 * Running sessions are inset cards; idle ones are flush hairline rows. That is
 * not decoration: it is the only signal on the list that something is happening
 * without you.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ApprovalMode,
  SessionStatus,
  type FacetOption,
  type ModelCandidate,
  type RemoteNodeSummary,
  type SessionSummary,
} from '../api/contracts';
import { useAuth } from '../state/auth';
import { useOwnedRepos } from '../state/repos';
import { rowToChoice } from '../api/repoPicker';
import { useSessionHub } from '../state/hub';
import {
  Body,
  Brand,
  Button,
  Field,
  GLYPHS,
  Hint,
  Meta,
  Mono,
  Screen,
  SectionLabel,
  StatusDot,
  stamp,
} from '../ui/kit';
import { Composer, shortRepo, type TurnOptions } from '../ui/Composer';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { useConnection } from '../state/connection';
import { font, radius, useTheme } from '../theme';

export function SessionsScreen({ navigation }: { navigation: any }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const seam = useAuth(s => s.seam);
  const { hub } = useSessionHub();

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<SessionSummary | null>(null);
  const [draftName, setDraftName] = useState('');

  const [prompt, setPrompt] = useState('');
  const [starting, setStarting] = useState(false);
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
        setError('That model selection is no longer available.');
        return;
      }

      if (options.approval !== ApprovalMode.Dangerous) {
        await seam.setApprovalMode(id, { mode: options.approval, useClassifier: true });
      }
      await seam.start(id, { prompt: text, selection: options.selection });

      setPrompt('');
      setRepos([]);
      setNodes([]);
      navigation.navigate('Session', { id });
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  };

  const load = useCallback(async () => {
    if (!seam) return;
    try {
      setSessions(await seam.sessions());
      setError(null);
    } catch (e) {
      // OfflineError already carries the useful sentence; the banner says the
      // rest, so this only needs to explain a server that answered badly.
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [seam]);

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

  const rename = async () => {
    if (!seam || !renaming) return;
    const target = renaming;
    setRenaming(null);
    await seam.rename(target.id, draftName.trim());
    await load();
  };

  const remove = (session: SessionSummary) => {
    // A running session must be stopped first — the server answers DeleteResult
    // Running rather than deleting it out from under a turn.
    Alert.alert(`Delete “${session.title}”?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await seam?.deleteSession(session.id);
          await load();
        },
      },
    ]);
  };

  const running = (sessions ?? []).filter(s => s.status === SessionStatus.Running);
  const idle = (sessions ?? []).filter(s => s.status !== SessionStatus.Running);

  return (
    <Screen>
      {/* This screen has no header bar, so the banner would otherwise render
          under the status bar. The inset is reserved here whether the banner is
          showing or not, so it appearing does not shove the page down. */}
      <View style={{ paddingTop: insets.top }}>
        <ConnectionBanner onRetry={load} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: insets.bottom + 24,
          gap: 18,
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
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Brand />
          <View style={{ flex: 1 }} />
          <Button label="New" variant="ghost" onPress={() => navigation.navigate('NewSession')} />
          <Button
            label="Settings"
            variant="ghost"
            onPress={() => navigation.navigate('Settings')}
          />
        </View>

        <Body style={{ fontFamily: font.sansMedium, fontSize: 24, marginTop: 4 }}>What’s next?</Body>

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
            searchRepos: async query => (await seam!.searchRepos(query)).map(rowToChoice),
            onChange: next => {
              setRepos(next.repos);
              setNodes(next.nodes);
            },
          }}
        />

        {error ? (
          <View style={{ gap: 8 }}>
            <Body style={{ color: c.destructive, fontSize: 13 }}>{error}</Body>
            <Pressable onPress={load} hitSlop={8}>
              <Mono style={{ color: c.primary, textDecorationLine: 'underline' }}>Try again</Mono>
            </Pressable>
          </View>
        ) : null}

        {sessions === null ? (
          <Hint>Loading…</Hint>
        ) : sessions.length === 0 ? (
          <Hint>No sessions yet. Start one above.</Hint>
        ) : null}

        {running.length > 0 ? (
          <View>
            <SectionLabel label="running" count={running.length} />
            <View style={{ gap: 8 }}>
              {running.map(session => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onPress={() => navigation.navigate('Session', { id: session.id })}
                  onRename={() => {
                    setDraftName(session.title);
                    setRenaming(session);
                  }}
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
                onPress={() => navigation.navigate('Session', { id: session.id })}
                onRename={() => {
                  setDraftName(session.title);
                  setRenaming(session);
                }}
                onDelete={() => remove(session)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={renaming !== null} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable
          onPress={() => setRenaming(null)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 }}>
          <Pressable
            style={{
              backgroundColor: c.card,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: c.border,
              padding: 16,
              gap: 12,
            }}>
            <Meta>Rename session</Meta>
            <Field value={draftName} onChangeText={setDraftName} autoCapitalize="sentences" />
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
              <Button label="Cancel" variant="outline" onPress={() => setRenaming(null)} />
              <Button label="Rename" onPress={rename} disabled={!draftName.trim()} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
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
        {/* The whole row is the link, as on the web — not a row plus a button
            that does the same thing. */}
        <Pressable
          onPress={onPress}
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

        {/* One overflow rather than two icons: a 390pt row has no space for
            both beside a title, and Geist Mono has no pencil or bin glyph. */}
        <Pressable
          onPress={() =>
            Alert.alert(session.title, undefined, [
              { text: 'Rename', onPress: onRename },
              { text: 'Delete', style: 'destructive', onPress: onDelete },
              { text: 'Cancel', style: 'cancel' },
            ])
          }
          hitSlop={8}
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
      </View>
    </View>
  );
}
