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
  type SessionSummary,
} from '../api/contracts';
import { useAuth } from '../state/auth';
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
import { Composer, type TurnOptions } from '../ui/Composer';
import { font, mix, radius, useTheme } from '../theme';

export function SessionsScreen({ navigation }: { navigation: any }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const seam = useAuth(s => s.seam);
  const credential = useAuth(s => s.credential);
  const { hub, connected } = useSessionHub();

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
  const [recent, setRecent] = useState<string[]>([]);
  const [options, setOptions] = useState<TurnOptions>({
    selection: { auto: true, connectionId: null, modelId: null },
    thinking: null,
    approval: ApprovalMode.Dangerous,
    facet: null,
  });

  useEffect(() => {
    if (!seam) return;
    void Promise.all([seam.models(), seam.facets(), seam.recentRepos()]).then(([m, f, r]) => {
      setModels(m);
      setFacets(f);
      setRecent(r);
    });
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
      setError(String(e));
    }
  }, [seam]);

  useEffect(() => {
    void load();
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [load, navigation]);

  // The registry push carries no payload by design — it means "re-list".
  useEffect(() => hub?.addRegistryListener(() => void load()), [hub, load]);

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
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: insets.top + 12,
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
          accessory={
            <RepoChips
              recent={recent}
              picked={repos}
              onToggle={url =>
                setRepos(repos.includes(url) ? repos.filter(r => r !== url) : [...repos, url])
              }
              onMore={() => navigation.navigate('NewSession')}
            />
          }
        />

        {!connected && credential ? <Mono>Reconnecting to live updates…</Mono> : null}
        {error ? <Body style={{ color: c.destructive, fontSize: 13 }}>{error}</Body> : null}

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

/**
 * The web's `+ add` chip row. Recent repositories are one tap; anything that
 * needs searching — or a node, or a facet picked from a list — is the full
 * screen behind "More".
 */
function RepoChips({
  recent,
  picked,
  onToggle,
  onMore,
}: {
  recent: string[];
  picked: string[];
  onToggle: (url: string) => void;
  onMore: () => void;
}) {
  const { c } = useTheme();

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {recent.slice(0, 4).map(url => {
        const on = picked.includes(url);
        return (
          <Pressable
            key={url}
            onPress={() => onToggle(url)}
            style={{
              height: 28,
              justifyContent: 'center',
              paddingHorizontal: 10,
              borderRadius: 9999,
              borderWidth: 1,
              borderColor: on ? c.primary : c.border,
              backgroundColor: on ? mix(c.primary, 10) : 'transparent',
            }}>
            <Mono style={{ fontSize: 11.5, color: on ? c.primary : c.mutedForeground }}>
              {shortRepo(url)}
            </Mono>
          </Pressable>
        );
      })}
      <Pressable
        onPress={onMore}
        style={{
          height: 28,
          justifyContent: 'center',
          paddingHorizontal: 10,
          borderRadius: 9999,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: c.border,
        }}>
        <Mono style={{ fontSize: 11.5 }}>+ more</Mono>
      </Pressable>
    </View>
  );
}

/** `https://host/owner/repo.git` reads better as `owner/repo` on a phone. */
function shortRepo(url: string): string {
  const parts = url.replace(/\.git$/, '').split('/').filter(Boolean);
  return parts.slice(-2).join('/') || url;
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
