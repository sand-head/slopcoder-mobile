/** A native session switcher; room navigation has been retired. */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  SessionStatus,
  type SessionSummary,
} from '../api/contracts';
import { useReducedMotion } from './motion';
import { when } from '../api/routines';
import { matchesSession } from '../api/sessionIdentity';
import { mix, radius, useTheme, font } from '../theme';
import { Body, Hint, Meta, Mono, SectionLabel, Skeleton, StatusDot } from './kit';

export interface ChatSwitcherProps {
  visible: boolean;
  onClose: () => void;
  sessions: readonly SessionSummary[] | null;
  error?: string | null;
  selectedSessionId?: string;
  onOpenSession: (id: string) => void;
}

const DRAWER_WIDTH = Math.min(320, Dimensions.get('window').width * 0.85);

export function ChatSwitcher({
  visible,
  onClose,
  sessions,
  error,
  selectedSessionId,
  onOpenSession,
}: ChatSwitcherProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const visibleSessions = sessions?.filter(session => matchesSession(session, query)) ?? null;

  // RN's Modal only mounts its children while visible, so the slide is the
  // entry animation; the exit is the backdrop dropping away with the modal.
  const slide = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (!visible) return;
    if (reducedMotion) { slide.setValue(1); return; }
    slide.setValue(0);
    const run = Animated.timing(slide, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [visible, slide, reducedMotion]);

  const openSession = (id: string) => {
    onOpenSession(id);
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
            <Meta>sessions</Meta>
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

          <TextInput value={query} onChangeText={setQuery} placeholder="Search sessions"
            placeholderTextColor={c.mutedForeground} accessibilityLabel="Search sessions"
            style={{ marginHorizontal: 14, marginVertical: 8, paddingHorizontal: 12, paddingVertical: 8,
              borderRadius: radius.md, backgroundColor: c.card, color: c.foreground, fontFamily: font.sans }} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 + insets.bottom }}>
            <View style={styles.section}>
              <SectionLabel label="sessions" count={visibleSessions?.length} />
              {sessions === null ? <Skeleton rows={3} height={44} /> : null}
              {sessions !== null && sessions.length === 0 ? (
                <Hint>No sessions yet.</Hint>
              ) : null}
              {sessions !== null && visibleSessions?.length === 0 && query.trim() ? <Hint>No matching sessions.</Hint> : null}
              {visibleSessions?.map(session => (
                <SessionRow
                  key={session.id}
                  session={session}
                  selected={session.id === selectedSessionId}
                  onPress={() => openSession(session.id)}
                />
              ))}
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
            ? mix(c.mutedForeground, 12)
            : pressed
              ? mix(c.mutedForeground, 10)
              : 'transparent',
        },
      ]}>
      <View
        style={[
          styles.avatar,
          { backgroundColor: mix(c.mutedForeground, 16) },
        ]}>
        <Text
          style={{
            fontFamily: font.monoSemiBold,
            fontSize: 13,
            color: c.foreground,
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
