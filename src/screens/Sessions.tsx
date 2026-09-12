/**
 * The launcher, and the session list — one screen, as on the web.
 *
 * Running sessions are inset cards; idle ones are flush hairline rows. That is
 * not decoration: it is the only signal on the list that something is happening
 * without you.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SessionStatus, type SessionSummary } from '../api/contracts';
import { useAuth } from '../state/auth';
import { useSessionHub } from '../state/hub';
import { Body, Button, Hint, Meta, Mono, Screen, SectionLabel, StatusDot, stamp } from '../ui/kit';
import { font, radius, useTheme } from '../theme';

export function SessionsScreen({ navigation }: { navigation: any }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const seam = useAuth(s => s.seam);
  const credential = useAuth(s => s.credential);
  const { hub, connected } = useSessionHub();

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                backgroundColor: c.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Body style={{ color: c.primaryForeground, fontFamily: font.display, fontSize: 12 }}>
                s
              </Body>
            </View>
            <Body style={{ fontFamily: font.mono, fontSize: 15 }}>slopcoder</Body>
          </View>
          <View style={{ flex: 1 }} />
          <Button
            label="Settings"
            variant="ghost"
            onPress={() => navigation.navigate('Settings')}
          />
        </View>

        <Body style={{ fontFamily: font.sansMedium, fontSize: 24, marginTop: 4 }}>What’s next?</Body>

        <Button label="Start a session" onPress={() => navigation.navigate('NewSession')} />

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
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function SessionCard({
  session,
  onPress,
  flush,
}: {
  session: SessionSummary;
  onPress: () => void;
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
          padding: flush ? 0 : 12,
          paddingVertical: flush ? 12 : 12,
          minHeight: 44,
        }}>
        <View style={{ paddingTop: 5 }}>
          <StatusDot running={running} />
        </View>
        <View style={{ flex: 1, gap: 3 }} onTouchEnd={onPress}>
          <Body numberOfLines={1}>{session.title}</Body>
          <Mono numberOfLines={1}>
            {stamp(session.createdAt)} · {session.autoRoute ? 'auto' : session.model}
          </Mono>
          {offline ? (
            <Meta style={{ color: c.destructive }}>workspace offline</Meta>
          ) : null}
        </View>
        <Button label="Open" variant="ghost" onPress={onPress} />
      </View>
    </View>
  );
}
