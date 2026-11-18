/**
 * The launcher, and the session list — one screen, as on the web.
 *
 * Sessions are conversations with the user's agents; shared rooms are the
 * channels below them. Both are live, and both open into the same chat
 * switcher. Avatar presence, rather than a separate running section, says what
 * is happening.
 *
 * The bar is the platform's: a large title that collapses as you scroll and a
 * search field inside it. The composer under it is the one way to start a
 * session — a separate new-session screen used to exist with the same composer
 * on it, and there was no telling why.
 *
 * Each row's `…` opens a native menu for rename and delete. `Alert.alert` was
 * standing in for that menu, which on iOS is a centred dialog and on Android
 * cannot style a destructive row. The menu is on the button and not on the
 * row itself: on iOS the menu's native wrapper is a button underneath its
 * child, and a tap on the row went to it and never reached the row's press.
 */
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  Alert,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KEYBOARD_GAP } from '../ui/keyboard';
import {
  ApprovalMode,
  DeleteResult,
  SessionStatus,
  type ChatRoomListing,
  type FacetOption,
  type ModelCandidate,
  type RecentRepo,
  type RemoteNodeSummary,
  type RoutineStatus,
  type SessionSearchHit,
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
  SectionLabel,
  Skeleton,
  StatusDot,
  stamp,
} from '../ui/kit';
import { animateNextLayout } from '../ui/motion';
import { Composer, shortRepo, type TurnOptions } from '../ui/Composer';
import { MAX_IMAGES, pickImages, type ImageSource, type PendingImage } from '../ui/images';
import { OverflowMenu } from '../ui/menu';
import { Sheet } from '../ui/Sheet';
import { useRoutineAlert } from '../state/routines';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { isValidChannelName, normalizeChannelName } from '../ui/ChatSwitcher';
import { useConnection } from '../state/connection';
import { tapConfirm, tapError, tapRefuse } from '../ui/haptics';
import { font, mix, radius, useTheme } from '../theme';

export function SessionsScreen({ navigation }: { navigation: any }) {
  const { c } = useTheme();
  const seam = useAuth(s => s.seam);
  const { hub } = useSessionHub();
  const setFailed = useRoutineAlert(s => s.setFailed);

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [rooms, setRooms] = useState<ChatRoomListing[] | null>(null);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [channelOpen, setChannelOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<SessionSummary | null>(null);
  const [routines, setRoutines] = useState<RoutineStatus | null>(null);
  // Recall: the header search filters the list locally, and when nothing in it
  // matches, the same words go to the server's full-text search over what was
  // *said* — scrollback, not titles. The web's sidebar does only the second
  // half; a phone has the one field, so it does both.
  const [recall, setRecall] = useState<{ query: string; hits: SessionSearchHit[] } | null>(null);
  const [recallBusy, setRecallBusy] = useState(false);

  const [prompt, setPrompt] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelCandidate[]>([]);
  const [facets, setFacets] = useState<FacetOption[]>([]);
  const [repos, setRepos] = useState<string[]>([]);
  const [nodes, setNodes] = useState<string[]>([]);
  const [recent, setRecent] = useState<RecentRepo[]>([]);
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
        placeholder: 'Search sessions & channels',
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
      await seam.start(id, {
        prompt: text,
        selection: options.selection,
        images:
          pendingImages.length > 0
            ? pendingImages.map(({ mediaType, base64Data }) => ({ mediaType, base64Data }))
            : null,
      });
      tapConfirm();

      setPrompt('');
      setPendingImages([]);
      setImageError(null);
      setRepos([]);
      setNodes([]);
      leaveFor('Session', { id });
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
      animateNextLayout();
      setSessions(next);
      setError(null);
      // Channels are additive: a room failure must not hide the agent sessions.
      seam
        .chatRooms()
        .then(nextRooms => {
          setRooms(nextRooms);
          setRoomsError(null);
        })
        .catch(e => setRoomsError(e instanceof Error ? e.message : String(e)));
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
  useEffect(() => hub?.addRoomListener(() => void load()), [hub, load]);

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
  const visibleRooms = (rooms ?? []).filter(
    room =>
      needle === '' ||
      room.name.toLowerCase().includes(needle) ||
      room.description.toLowerCase().includes(needle),
  );

  // Debounced recall, mirroring the web's 300ms: a keystroke invalidates
  // whatever was in flight, so a slow answer to an old query never overwrites
  // the answer to the current one. Only asked once the local filter has come up
  // empty — that is the state in which scrollback hits add anything.
  useEffect(() => {
    let cancelled = false;
    const searched = query.trim();
    setRecall(null);
    if (!seam || searched.length < 2 || visible.length > 0) {
      setRecallBusy(false);
      return;
    }
    const timer = setTimeout(() => {
      setRecallBusy(true);
      seam
        .sessionSearch(searched, 10)
        .then(hits => !cancelled && setRecall({ query: searched, hits }))
        .catch(() => !cancelled && setRecall({ query: searched, hits: [] }))
        .finally(() => !cancelled && setRecallBusy(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [seam, query, visible.length]);

  // Leaving with the keyboard up lands on a page with a composer of its own
  // and a keyboard already open for something else, which reads as the tap
  // having gone somewhere it did not.
  const leaveFor = (route: string, params: object) => {
    Keyboard.dismiss();
    navigation.navigate(route, params);
  };

  const open = (session: SessionSummary) => leaveFor('Session', { id: session.id });

  const createRoom = async (name: string, description: string) => {
    if (!seam) throw new Error('Sign in before creating a channel.');
    const view = await seam.createChatRoom({ name, description });
    await load();
    return view.room.name;
  };

  return (
    // A fragment, not a view: UIKit finds the scroll view that drives the large
    // title by walking first children down from the screen, so anything wrapped
    // around this one hides it. The rename sheet is a sibling *after* it, which
    // leaves the walk alone, and renders nothing on iOS anyway.
    <>
      <KeyboardAwareScrollView
        contentInsetAdjustmentBehavior="automatic"
        // The composer's buttons sit inside this scroll view. Without this, a
        // tap on one while the keyboard is up only dismisses the keyboard and
        // the button is not pressed until the second tap.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // The composer sits at the top of this page, where the keyboard never
        // reaches it, so the right amount to scroll when it is tapped is none.
        // `automaticallyAdjustKeyboardInsets` could not say that: it asks the
        // first responder where it is, and every answer it failed to get — a
        // keyboard raised on another screen, a field it could not place inside
        // this scroll view — it read as "shift the content up by a keyboard",
        // which scrolled the composer off the top of its own page and left it
        // there, because nothing put the offset back. This scrolls for the
        // focused field only when that field is inside *this* scroll view and
        // the keyboard would actually cover it, and it puts the page back
        // where it was when the keyboard goes down.
        bottomOffset={KEYBOARD_GAP}
        // Layout mode: the space for the keyboard is a spacer at the end of
        // the content rather than a decorator wrapped around the scroll view,
        // and a wrapper is exactly what hides this list from the large title.
        mode="layout"
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

        <Body style={{ fontFamily: font.sansMedium, fontSize: 22 }}>Start a new chat</Body>

        <Composer
          value={prompt}
          onChangeValue={setPrompt}
          placeholder="Message a new agent…"
          action="Start"
          onAction={start}
          busy={starting}
          disabled={!prompt.trim()}
          options={options}
          onChangeOptions={setOptions}
          models={models}
          facets={facets}
          images={{
            pending: pendingImages,
            onPick: async (source: ImageSource) => {
              setImageError(null);
              const result = await pickImages(source, MAX_IMAGES - pendingImages.length);
              if (result.images.length > 0) {
                animateNextLayout();
                setPendingImages(current => [...current, ...result.images].slice(0, MAX_IMAGES));
              }
              setImageError(result.error);
            },
            onRemove: key => {
              animateNextLayout();
              setPendingImages(current => current.filter(image => image.key !== key));
            },
            error: imageError,
          }}
          attachments={{
            repos,
            nodes,
            recentRepos: recent.map(row => ({
              key: row.cloneUrl,
              label: row.label || shortRepo(row.cloneUrl),
              kind: row.kind,
            })),
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
        ) : sessions !== null && sessions.length === 0 && needle === '' ? (
          // Archived sessions are off the list but not gone, so an empty list
          // is not proof there is no history — search still reaches them.
          <Hint>No sessions yet. Start one above, or ask Siri. Archived ones are off this list; search still finds them.</Hint>
        ) : sessions !== null && visible.length === 0 && needle !== '' ? (
          // Deliberately not an error: the local list came up empty, and the
          // server is being asked whether anything was ever *said* that
          // matches. "Nothing matches" would be premature until it answers.
          recall === null && recallBusy ? null : (
            <Hint>No sessions match “{query.trim()}”.</Hint>
          )
        ) : null}

        {/* Recall hits: what was said in past sessions, not their titles. Only
            shown when the local filter found nothing — with matches in the
            list, scrollback rows would be noise under them. */}
        {recall !== null && needle !== '' && recall.query === query.trim() && visible.length === 0 ? (
          <View>
            <SectionLabel label="said in past sessions" count={recallBusy ? undefined : recall.hits.length} />
            {recallBusy ? (
              <Hint>Searching scrollback…</Hint>
            ) : recall.hits.length === 0 ? (
              <Hint>Nothing said in a past session matches that.</Hint>
            ) : (
              <View style={{ gap: 8 }}>
                {recall.hits.map(hit => (
                  <Pressable
                    key={`${hit.sessionId}:${hit.when}`}
                    onPress={() => leaveFor('Session', { id: hit.sessionId })}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${hit.archived ? 'archived ' : ''}session ${hit.sessionTitle}`}
                    style={({ pressed }) => ({
                      backgroundColor: pressed ? mix(c.muted, 40) : c.card,
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: radius.md,
                      padding: 12,
                      gap: 4,
                    })}>
                    <Body numberOfLines={1} style={{ fontSize: 14 }}>
                      {hit.sessionTitle}
                    </Body>
                    <Mono style={{ fontSize: 12 }}>
                      {stamp(hit.when)} · {hit.kind}
                      {hit.archived ? ' · archived' : ''}
                    </Mono>
                    <Mono numberOfLines={3} style={{ fontSize: 12, color: c.mutedForeground }}>
                      {hit.snippet}
                    </Mono>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        ) : null}

        {visible.length > 0 ? (
          <View>
            <SectionLabel label="sessions" count={visible.length} />
            <View style={{ borderTopWidth: 1, borderTopColor: c.border }}>
              {visible.map(session => (
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
          </View>
        ) : null}

        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <SectionLabel label="channels" count={rooms?.length} />
            </View>
            <Pressable
              onPress={() => setChannelOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Create channel"
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
            >
              <Mono style={{ color: c.primary, fontSize: 14 }}>+</Mono>
            </Pressable>
          </View>
          {roomsError ? <Hint>Could not load channels: {roomsError}</Hint> : null}
          {rooms !== null && visibleRooms.length === 0 ? (
            <Hint>
              {needle === ''
                ? 'No channels yet. Create one so your agents can coordinate.'
                : 'No channels match that search.'}
            </Hint>
          ) : null}
          <View style={{ borderTopWidth: visibleRooms.length > 0 ? 1 : 0, borderTopColor: c.border }}>
            {visibleRooms.map(room => (
              <ChannelRow
                key={room.id}
                room={room}
                onPress={() => leaveFor('Room', { name: room.name })}
              />
            ))}
          </View>
        </View>

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
      </KeyboardAwareScrollView>

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
      <CreateChannelSheet
        visible={channelOpen}
        onClose={() => setChannelOpen(false)}
        onCreate={createRoom}
        onOpen={name => {
          setChannelOpen(false);
          leaveFor('Room', { name });
        }}
      />
    </>
  );
}

function ChannelRow({ room, onPress }: { room: ChatRoomListing; onPress: () => void }) {
  const { c } = useTheme();
  const preview = room.lastPreview
    ? `${room.lastSender ?? '?'}: ${room.lastPreview}`
    : room.description || 'No messages yet';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`#${room.name}, ${preview}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 64,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
        backgroundColor: pressed ? mix(c.mutedForeground, 8) : 'transparent',
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.secondary,
        }}
      >
        <Body style={{ fontFamily: font.sansMedium, fontSize: 19, color: c.mutedForeground }}>#</Body>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Body numberOfLines={1} style={{ fontFamily: font.sansMedium, fontSize: 15 }}>
          {room.name}
        </Body>
        <Body numberOfLines={1} style={{ fontSize: 13, color: c.mutedForeground }}>
          {preview}
        </Body>
        <Mono numberOfLines={1} style={{ fontSize: 10.5 }}>
          {room.members} members · {stamp(room.lastMessageAt ?? room.createdAt)}
        </Mono>
      </View>
      <Mono style={{ fontSize: 16 }}>›</Mono>
    </Pressable>
  );
}

function CreateChannelSheet({
  visible,
  onClose,
  onCreate,
  onOpen,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<string>;
  onOpen: (name: string) => void;
}) {
  const { c } = useTheme();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName('');
      setDescription('');
      setError(null);
    }
  }, [visible]);

  const normalized = normalizeChannelName(name);
  const valid = isValidChannelName(normalized);
  const create = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      onOpen(await onCreate(normalized, description.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} title="Create channel" onClose={onClose}>
      <Hint>Agents can join this shared room. Your messages notify only the agents you @mention.</Hint>
      <Field
        value={name}
        onChangeText={setName}
        autoCapitalize="none"
        autoFocus
        accessibilityLabel="Channel name"
        placeholder="channel-name"
      />
      <Field
        value={description}
        onChangeText={setDescription}
        autoCapitalize="sentences"
        accessibilityLabel="Channel description (optional)"
        placeholder="What is this channel for? (optional)"
        maxLength={500}
      />
      {name.trim().length > 0 && !valid ? (
        <Body style={{ color: c.destructive, fontSize: 13 }}>
          Use 1–64 lowercase letters, numbers, hyphens or underscores, starting with a letter or number.
        </Body>
      ) : null}
      {error ? (
        <Body accessibilityLiveRegion="polite" style={{ color: c.destructive, fontSize: 13 }}>
          {error}
        </Body>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
        <Button label="Cancel" variant="outline" onPress={onClose} />
        <Button label={busy ? 'Creating…' : 'Create channel'} onPress={() => void create()} disabled={!valid || busy} />
      </View>
    </Sheet>
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
        {/* The whole row is the link, as on the web. */}
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${session.title}, ${running ? 'running' : 'idle'}`}
          accessibilityHint="Opens the session."
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
            opacity: pressed ? 0.6 : 1,
          })}>
          <View>
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: mix(c.primary, running ? 18 : 10),
              }}
            >
              <Body style={{ fontFamily: font.sansMedium, fontSize: 15, color: c.primary }}>
                {session.title.trim().charAt(0).toUpperCase() || '?'}
              </Body>
            </View>
            <View style={{ position: 'absolute', right: -2, bottom: -2, padding: 2, borderRadius: 7, backgroundColor: c.background }}>
              <StatusDot running={running} />
            </View>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Body numberOfLines={1}>{session.title}</Body>
            <Mono numberOfLines={1}>
              {/* Last activity, not creation: the list is ordered by it, and a
                  row stamped with a date two weeks old next to one stamped
                  today would say the opposite of what the order says. */}
              {stamp(session.updatedAt)} · {session.autoRoute ? 'auto' : session.model}
            </Mono>
            {offline ? <Meta style={{ color: c.destructive }}>workspace offline</Meta> : null}
          </View>
        </Pressable>

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
