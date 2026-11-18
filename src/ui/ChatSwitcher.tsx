/**
 * The Discord-style switcher a chat screen hangs off its left edge: sessions
 * with the user's agents above, the rooms they talk in below.
 *
 * A mobile drawer, not a web sidebar: it is an RN `Modal` over a dimming
 * backdrop, slides in from the left, and every choice dismisses it. The
 * component is purely presentational — it owns neither the session list nor
 * the room list, and never touches the seam; the screen passes data in and
 * navigation callbacks out.
 *
 * The `+` beside CHANNELS opens the create form inline, the way Discord grows
 * a channel list in place rather than in a separate sheet. A name is
 * normalized (trimmed, leading `#` dropped, lowercased) and must read
 * `[a-z0-9][a-z0-9_-]{0,63}` — the shape room names already carry everywhere
 * else in the app. On success the resolved name comes back from
 * `onCreateRoom` and the drawer opens that room and closes; on a throw the
 * input stays where it was and the error sits at the form.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  SessionStatus,
  type ChatRoomListing,
  type SessionSummary,
} from '../api/contracts';
import { plural } from '../api/rooms';
import { when } from '../api/routines';
import { mix, radius, useTheme, font } from '../theme';
import { Body, Button, Field, Hint, Meta, Mono, SectionLabel, Skeleton, StatusDot } from './kit';

/** Trim, drop leading `#`, lowercase — what a typed name becomes. */
export function normalizeChannelName(raw: string): string {
  return raw.trim().replace(/^#+/, '').toLowerCase();
}

/** `[a-z0-9][a-z0-9_-]{0,63}`: the shape room names carry everywhere else. */
export function isValidChannelName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(name);
}

const VALIDATION_MESSAGE =
  'Names start with a letter or digit, then lowercase letters, digits, - and _ — up to 64 characters.';

export interface ChatSwitcherProps {
  visible: boolean;
  onClose: () => void;
  /** Null while the list is loading; an empty array means none. */
  sessions: readonly SessionSummary[] | null;
  rooms: readonly ChatRoomListing[] | null;
  error?: string | null;
  selectedSessionId?: string;
  selectedRoom?: string;
  onOpenSession: (id: string) => void;
  onOpenRoom: (name: string) => void;
  onCreateRoom: (name: string, description: string) => Promise<string>;
}

const DRAWER_WIDTH = Math.min(320, Dimensions.get('window').width * 0.85);

export function ChatSwitcher({
  visible,
  onClose,
  sessions,
  rooms,
  error,
  selectedSessionId,
  selectedRoom,
  onOpenSession,
  onOpenRoom,
  onCreateRoom,
}: ChatSwitcherProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [creating, setCreating] = useState(false);

  // RN's Modal only mounts its children while visible, so the slide is the
  // entry animation; the exit is the backdrop dropping away with the modal.
  const slide = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    if (!visible) return;
    slide.setValue(0);
    const run = Animated.timing(slide, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [visible, slide]);

  const openSession = (id: string) => {
    onOpenSession(id);
    onClose();
  };
  const openRoom = (name: string) => {
    onOpenRoom(name);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: mix('#000000', 45) }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close chat switcher"
          onPress={onClose}
        />
        <Animated.View
          style={[
            styles.drawer,
            {
              backgroundColor: c.sidebar,
              borderRightColor: c.sidebarBorder,
              transform: [
                {
                  translateX: slide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-DRAWER_WIDTH, 0],
                  }),
                },
              ],
            },
          ]}>
          <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
            <Meta>chat switcher</Meta>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              hitSlop={8}
              style={({ pressed }) => [
                styles.close,
                { backgroundColor: mix(c.mutedForeground, pressed ? 22 : 10) },
              ]}>
              <Text style={{ fontFamily: font.mono, fontSize: 15, color: c.mutedForeground }}>
                ×
              </Text>
            </Pressable>
          </View>

          {error ? (
            <Mono numberOfLines={2} style={{ color: c.destructive, paddingHorizontal: 14 }}>
              {error}
            </Mono>
          ) : null}

          <ScrollView contentContainerStyle={{ paddingBottom: 16 + insets.bottom }}>
            <View style={styles.section}>
              <SectionLabel label="sessions" count={sessions?.length} />
              {sessions === null ? <Skeleton rows={3} height={44} /> : null}
              {sessions !== null && sessions.length === 0 ? (
                <Hint>No sessions yet.</Hint>
              ) : null}
              {sessions?.map(session => (
                <SessionRow
                  key={session.id}
                  session={session}
                  selected={session.id === selectedSessionId}
                  onPress={() => openSession(session.id)}
                />
              ))}
            </View>

            <View style={styles.section}>
              <CreateChannelContext.Provider value={() => setCreating(true)}>
                <View style={styles.channelsHeader}>
                  <SectionLabel label="channels" count={rooms?.length} />
                  <CreateChannelButton />
                </View>
              </CreateChannelContext.Provider>
              {rooms === null ? <Skeleton rows={2} height={44} /> : null}
              {rooms !== null && rooms.length === 0 ? (
                <Hint>No channels yet. The + above makes one.</Hint>
              ) : null}
              {rooms?.map(room => (
                <RoomRow
                  key={room.id}
                  room={room}
                  selected={room.name === (selectedRoom ?? '').toLowerCase()}
                  onPress={() => openRoom(room.name)}
                />
              ))}
              <CreateChannelForm
                open={creating}
                onClose={() => setCreating(false)}
                onCreateRoom={onCreateRoom}
                onCreated={openRoom}
              />
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** One agent session as a Discord DM row: initial, title, presence, meta. */
function SessionRow({
  session,
  selected,
  onPress,
}: {
  session: SessionSummary;
  selected: boolean;
  onPress: () => void;
}) {
  const { c, status } = useTheme();
  const running = session.status === SessionStatus.Running;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open session ${session.title}, ${running ? 'running' : 'idle'}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected
            ? mix(c.primary, 18)
            : pressed
              ? mix(c.mutedForeground, 10)
              : 'transparent',
        },
      ]}>
      <View
        style={[
          styles.avatar,
          { backgroundColor: selected ? mix(c.primary, 32) : mix(c.mutedForeground, 16) },
        ]}>
        <Text
          style={{
            fontFamily: font.monoSemiBold,
            fontSize: 13,
            color: selected ? c.primaryForeground : c.foreground,
          }}>
          {session.title.slice(0, 1).toUpperCase() || '?'}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Body numberOfLines={1}>{session.title}</Body>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <StatusDot running={running} />
          <Meta style={{ color: running ? status.running : undefined }}>
            {running ? 'running' : 'idle'}
          </Meta>
          <Mono numberOfLines={1} ellipsizeMode="tail">
            · {session.autoRoute ? 'auto' : session.model} · {when(session.updatedAt)}
          </Mono>
        </View>
      </View>
    </Pressable>
  );
}

/** One room as a Discord channel row: `# name`, preview, counts, selected. */
function RoomRow({
  room,
  selected,
  onPress,
}: {
  room: ChatRoomListing;
  selected: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  const preview = room.lastPreview
    ? `${room.lastSender ?? '?'}: ${room.lastPreview}`
    : room.description.length > 0
      ? room.description
      : undefined;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open channel ${room.name}${selected ? ', selected' : ''}`}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected
            ? mix(c.primary, 18)
            : pressed
              ? mix(c.mutedForeground, 10)
              : 'transparent',
        },
      ]}>
      <Text style={{ fontFamily: font.mono, fontSize: 15, color: c.mutedForeground }}>
        #
      </Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Body numberOfLines={1}>{room.name}</Body>
        {preview ? <Mono numberOfLines={1}>{preview}</Mono> : null}
        <Meta>
          {plural(room.members, 'member')} · {plural(room.messages, 'message')}
        </Meta>
      </View>
    </Pressable>
  );
}

/** The prominent `+` beside CHANNELS; context so the form below can open it. */
const CreateChannelContext = React.createContext<() => void>(() => {});

function CreateChannelButton() {
  const { c } = useTheme();
  const open = React.useContext(CreateChannelContext);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Create channel"
      onPress={open}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 28,
        height: 28,
        borderRadius: radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: mix(c.primary, pressed ? 40 : 22),
      })}>
      <Text style={{ fontFamily: font.monoSemiBold, fontSize: 15, color: c.primary }}>
        +
      </Text>
    </Pressable>
  );
}

/** The inline create form: name, optional description, validation, result. */
function CreateChannelForm({
  open,
  onClose,
  onCreateRoom,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreateRoom: (name: string, description: string) => Promise<string>;
  onCreated: (name: string) => void;
}) {
  const { c } = useTheme();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const normalized = normalizeChannelName(name);
    if (!isValidChannelName(normalized)) {
      setFormError(VALIDATION_MESSAGE);
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      // The server resolves the name it actually created; open that one.
      const created = await onCreateRoom(normalized, description.trim());
      onClose();
      setName('');
      setDescription('');
      onCreated(created);
    } catch (e) {
      // Keep what was typed; the reason sits at the form, not in a toast.
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <View
      style={{
        marginTop: 8,
        gap: 8,
        padding: 10,
        borderRadius: radius.lg,
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: c.border,
      }}>
      <Field
        value={name}
        onChangeText={value => {
          setName(value);
          setFormError(null);
        }}
        placeholder="channel-name"
        autoFocus
        returnKeyType="next"
        accessibilityLabel="Channel name"
      />
      <Field
        value={description}
        onChangeText={setDescription}
        placeholder="Description (optional)"
        autoCapitalize="sentences"
        returnKeyType="done"
        onSubmitEditing={() => void create()}
        accessibilityLabel="Channel description"
      />
      {formError ? (
        <Mono numberOfLines={3} style={{ color: c.destructive }}>
          {formError}
        </Mono>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
        <Button
          label="Cancel"
          variant="outline"
          onPress={() => {
            onClose();
            setFormError(null);
          }}
        />
        <Button label="Create" onPress={() => void create()} busy={busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  drawer: {
    width: DRAWER_WIDTH,
    maxWidth: '85%',
    height: '100%',
    borderRightWidth: 1,
    paddingTop: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  close: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { paddingHorizontal: 8, marginTop: 10 },
  channelsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: radius.md,
    minHeight: 44,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
