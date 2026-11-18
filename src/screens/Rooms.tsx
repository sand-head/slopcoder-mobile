/**
 * The chat rooms the user's agent sessions talk in — `Pages/Rooms.razor`, as
 * the two pages a phone-width browser shows: the list, then one room.
 *
 * Read-only, as on the web: agents post, the user watches, and can delete a
 * room. A person's words in a room would reach an agent framed as another
 * agent's input, never as the user's instruction, so there is no composer.
 *
 * Live over the session hub the app already holds: a `RoomChanged` signal
 * names the room that moved and the page re-reads it over REST. A burst of
 * signals — the post, the member going running, then idle — is one re-read and
 * at most one more (`serialRefresh`).
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, RefreshControl, ScrollView, View, type ScrollViewInstance } from 'react-native';
import type { ChatRoomEntry, ChatRoomListing, ChatRoomPresence } from '../api/contracts';
import { clock, when } from '../api/routines';
import { handleTint, memberLine, mergeRoom, plural, prependEarlier, serialRefresh, touches, type RoomPage } from '../api/rooms';
import type { SubSessionMention } from '../api/mentions';
import { useAuth } from '../state/auth';
import { useSessionHub } from '../state/hub';
import { Body, Button, Dot, Meta, Mono, Prose, Skeleton } from '../ui/kit';
import { BarText, Empty, ListRow, Problem, SettingsPage, useFocusLoad } from '../ui/settings';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { Sheet } from '../ui/Sheet';
import { barMenu } from '../navigation/headers';
import { OverflowMenu } from '../ui/menu';
import { tapConfirm, tapError } from '../ui/haptics';
import { font, mix, tintFor, useTheme } from '../theme';

/** Re-run `reload` on every room signal, coalesced; only signals `wants` cares about. */
function useRoomSignals(wants: (room: string) => boolean, reload: () => Promise<void>) {
  const { hub } = useSessionHub();
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const wantsRef = useRef(wants);
  wantsRef.current = wants;

  const refresh = useMemo(() => serialRefresh(() => reloadRef.current()), []);

  useEffect(
    () =>
      hub?.addRoomListener(room => {
        if (wantsRef.current(room)) refresh(true);
      }),
    [hub, refresh],
  );
}

/** "brisk-comet-42: shipped the relay" under a room's name, or its description. */
function roomPreview(room: ChatRoomListing): string | undefined {
  if (room.lastPreview) return `${room.lastSender ?? '?'}: ${room.lastPreview}`;
  return room.description.length > 0 ? room.description : undefined;
}

export function RoomsScreen({ navigation }: { navigation: any }) {
  const seam = useAuth(s => s.seam);
  const list = useFocusLoad(navigation, seam ? () => seam.chatRooms() : null);

  // Any room's change can move the list: a new last message, a member count.
  useRoomSignals(() => true, list.reload);

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Chat rooms' });
  }, [navigation]);

  const open = (room: ChatRoomListing) => navigation.navigate('Room', { name: room.name });

  const remove = (room: ChatRoomListing) =>
    confirmDelete(room.name, () => {
      if (!seam) return;
      seam
        .deleteChatRoom(room.name)
        .then(() => tapConfirm())
        .catch(() => tapError())
        .finally(() => void list.reload());
    });

  return (
    <SettingsPage
      refreshing={list.refreshing}
      onRefresh={list.refresh}
      error={list.error}
      loading={list.data === null && !list.error}>
      {list.data?.length === 0 ? (
        <Empty>
          No rooms yet. Agent sessions create rooms with create_room when they need to coordinate. Every session has a
          username; an @mention of it reaches that session directly.
        </Empty>
      ) : null}
      {list.data && list.data.length > 0 ? (
        <View>
          {list.data.map(room => (
            <ListRow
              key={room.id}
              title={`#${room.name}`}
              subtitle={roomPreview(room)}
              onPress={() => open(room)}
              chevron
              menu={[
                { key: 'open', title: 'Open', symbol: 'bubble.left.and.bubble.right', onPress: () => open(room) },
                { key: 'delete', title: 'Delete room', symbol: 'trash', destructive: true, onPress: () => remove(room) },
              ]}>
              <Meta style={{ fontSize: 10 }}>
                {plural(room.members, 'member')} · {plural(room.messages, 'message')} ·{' '}
                {when(room.lastMessageAt ?? room.createdAt)}
              </Meta>
            </ListRow>
          ))}
        </View>
      ) : null}
    </SettingsPage>
  );
}

function confirmDelete(name: string, onConfirm: () => void) {
  Alert.alert(
    `Delete #${name}?`,
    'The room, its members and every message in it are gone for good. Sessions keep their usernames and can create the room again.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onConfirm },
    ],
  );
}

export function RoomScreen({ route, navigation }: { route: any; navigation: any }) {
  const { c } = useTheme();
  const seam = useAuth(s => s.seam);
  const name: string = route.params.name;

  const [page, setPage] = useState<RoomPage | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const scroll = useRef<ScrollViewInstance>(null);
  // Whether the reader is at the newest message, so a new one keeps them there
  // and does not drag them back down from something they scrolled up to read.
  const atEnd = useRef(true);
  // Paging back grows the content above the reader; that must not scroll.
  const holdPosition = useRef(false);

  const load = useCallback(async () => {
    if (!seam) return;
    try {
      const view = await seam.chatRoom(name);
      setMissing(view === null);
      if (view) setPage(current => mergeRoom(current, view));
      setError(null);
    } catch (e) {
      // A missed re-read is not worth replacing what is shown; the first one is.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [seam, name]);

  useEffect(() => {
    void load();
    return navigation.addListener('focus', () => void load());
  }, [navigation, load]);

  useRoomSignals(room => touches(room, name), load);

  const loadEarlier = () => {
    if (!seam || !page || page.messages.length === 0 || loadingEarlier) return;
    setLoadingEarlier(true);
    holdPosition.current = true;
    seam
      .chatRoom(name, page.messages[0].seq)
      .then(earlier => {
        if (earlier) setPage(current => (current ? prependEarlier(current, earlier) : current));
      })
      .catch(() => tapError())
      .finally(() => setLoadingEarlier(false));
  };

  const remove = useCallback(
    () =>
      confirmDelete(name, () => {
        if (!seam) return;
        setBusy(true);
        seam
          .deleteChatRoom(name)
          .then(deleted => {
            if (deleted) tapConfirm();
            else tapError();
            navigation.goBack();
          })
          .catch(e => {
            tapError();
            setError(e instanceof Error ? e.message : String(e));
          })
          .finally(() => setBusy(false));
      }),
    [seam, name, navigation],
  );

  const memberCount = page?.view.members.length ?? 0;
  useLayoutEffect(() => {
    const showMembers = () => setMembersOpen(true);
    navigation.setOptions({
      title: `#${name}`,
      ...barMenu(
        [
          { key: 'members', label: `Members (${memberCount})`, symbol: 'person.2', onPress: showMembers },
          { key: 'delete', label: 'Delete room', symbol: 'trash', destructive: true, onPress: remove },
        ],
        () =>
          Platform.OS === 'ios' ? null : (
            <OverflowMenu
              title={`#${name}`}
              items={[
                { key: 'members', title: `Members (${memberCount})`, onPress: showMembers },
                { key: 'delete', title: 'Delete room', destructive: true, onPress: remove },
              ]}>
              <BarText label="More" onPress={() => {}} disabled={busy} />
            </OverflowMenu>
          ),
      ),
    });
  }, [navigation, name, memberCount, remove, busy]);

  // Every handle in sight is tinted wherever it is written, as on the web.
  const mentions = useMemo<SubSessionMention[]>(() => {
    if (!page) return [];
    const handles = new Map<string, string>();
    for (const member of page.view.members) handles.set(member.handle.toLowerCase(), member.handle);
    for (const message of page.messages) {
      for (const handle of message.mentioned) handles.set(handle.toLowerCase(), handle);
    }
    return [...handles.values()].map(handle => ({ persona: `@${handle}`, color: handleTint(handle) }));
  }, [page]);

  const openSession = (sessionId: string) => navigation.push('Session', { id: sessionId });

  return (
    <>
      <ScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 14 }}
        scrollEventThrottle={100}
        onScroll={event => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          atEnd.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 48;
        }}
        onContentSizeChange={() => {
          if (holdPosition.current) {
            holdPosition.current = false;
            return;
          }
          if (atEnd.current) scroll.current?.scrollToEnd({ animated: false });
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={c.mutedForeground}
          />
        }>
        <ConnectionBanner onRetry={() => void load()} />
        {error ? <Problem>{error}</Problem> : null}

        {missing ? (
          <Empty>No such room. It was deleted, or it never existed.</Empty>
        ) : page === null ? (
          error ? null : <Skeleton rows={3} height={64} />
        ) : (
          <>
            {page.view.room.description.length > 0 ? (
              <Body style={{ fontSize: 13, color: c.mutedForeground }}>{page.view.room.description}</Body>
            ) : null}
            {page.view.hasEarlier ? (
              <Button
                label={loadingEarlier ? 'Loading…' : 'Load earlier messages'}
                variant="ghost"
                disabled={loadingEarlier}
                onPress={loadEarlier}
              />
            ) : null}
            {page.messages.length === 0 ? <Empty>No messages yet.</Empty> : null}
            {page.messages.map(message => (
              <Message key={message.seq} message={message} mentions={mentions} onOpenSession={openSession} />
            ))}
          </>
        )}
      </ScrollView>

      <Sheet visible={membersOpen} title={`Members · ${memberCount}`} onClose={() => setMembersOpen(false)}>
        {page && page.view.members.length === 0 ? <Mono>No sessions are in this room.</Mono> : null}
        {page?.view.members.map(member => (
          <Member
            key={member.sessionId}
            member={member}
            messages={page.messages}
            onOpen={() => {
              setMembersOpen(false);
              openSession(member.sessionId);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}

/** A handle in its own shade, as the web's `tint-*` classes draw it. */
function useHandleColor(handle: string): string {
  const { c, isDark } = useTheme();
  return tintFor(handleTint(handle), isDark) ?? c.foreground;
}

function Message({
  message,
  mentions,
  onOpenSession,
}: {
  message: ChatRoomEntry;
  mentions: readonly SubSessionMention[];
  onOpenSession: (id: string) => void;
}) {
  const { c } = useTheme();
  const color = useHandleColor(message.sender);
  const sender = message.senderSessionId;

  return (
    <View style={{ gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
        <Pressable
          onPress={sender ? () => onOpenSession(sender) : undefined}
          disabled={!sender}
          accessibilityRole={sender ? 'link' : undefined}
          accessibilityLabel={sender ? `${message.sender}, open this session` : `${message.sender}, session deleted`}
          hitSlop={6}>
          <Mono style={{ fontSize: 12.5, fontFamily: font.monoSemiBold, color }}>{message.sender}</Mono>
        </Pressable>
        <Meta style={{ fontSize: 10 }}>
          {clock(message.at)} · #{message.seq}
        </Meta>
        {message.mentioned.length > 0 ? (
          <Meta style={{ fontSize: 10 }}>→ {message.mentioned.join(', ')}</Meta>
        ) : null}
      </View>
      <Prose mentions={mentions}>{message.text}</Prose>
    </View>
  );
}

function Member({
  member,
  messages,
  onOpen,
}: {
  member: ChatRoomPresence;
  messages: readonly ChatRoomEntry[];
  onOpen: () => void;
}) {
  const { c, status } = useTheme();
  const color = useHandleColor(member.handle);
  const running = member.state === 'running';
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${member.handle}, ${memberLine(member, messages)}, ${member.sessionTitle}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 52,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: c.border,
        backgroundColor: pressed ? mix(c.mutedForeground, 8) : 'transparent',
      })}>
      <Dot color={running ? status.running : c.mutedForeground} filled={running} size={8} />
      <View style={{ flex: 1, gap: 2 }}>
        <Mono style={{ fontSize: 12.5, color }}>{member.handle}</Mono>
        <Meta style={{ fontSize: 10 }}>{memberLine(member, messages)}</Meta>
        <Body numberOfLines={1} style={{ fontSize: 13, color: c.mutedForeground }}>
          {member.sessionTitle}
        </Body>
      </View>
      <Mono style={{ fontSize: 15 }}>›</Mono>
    </Pressable>
  );
}
