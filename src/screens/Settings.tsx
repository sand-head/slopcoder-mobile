/**
 * Deliberately thin. Everything configurable lives on the server and is reached
 * from the web UI; what belongs here is what is true of *this device*.
 */
import React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../state/auth';
import { BackButton, Body, Brand, Button, Hint, Meta, Mono, Screen, SectionLabel } from '../ui/kit';
import { font, useTheme } from '../theme';
import pkg from '../../package.json';

export function SettingsScreen({ navigation }: { navigation: any }) {
  const credential = useAuth(s => s.credential);
  const signOut = useAuth(s => s.signOut);
  const insets = useSafeAreaInsets();
  const { c } = useTheme();

  return (
    <Screen>
      {/* Previously there was no way back except the OS gesture, which Android
          has and iOS only has from the screen edge. */}
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
        <Body style={{ flex: 1, fontFamily: font.sansMedium, fontSize: 14 }}>Settings</Body>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingBottom: insets.bottom + 24,
          gap: 18,
        }}>

        <View>
          <SectionLabel label="account" />
          <Row label="signed in as" value={credential?.userName ?? '—'} />
          <Row label="server" value={credential?.server ?? '—'} mono />
          <Row
            label="this device"
            value={Platform.OS === 'ios' ? 'iPhone (slopcoder)' : 'Android (slopcoder)'}
          />
        </View>

        <View>
          <SectionLabel label="usage" />
          <NavRow label="tokens and cost" onPress={() => navigation.navigate('Usage')} />
        </View>

        <View>
          <SectionLabel label="elsewhere" />
          <Hint>
            Everything else — providers, facets, memory, remote nodes, usage — lives on the server.
            Open slopcoder in a browser to reach it. Code mode and the terminal are there too; they
            are not in this app on purpose.
          </Hint>
        </View>

        <View>
          <SectionLabel label="session" />
          <Button
            label="Sign out"
            variant="link-destructive"
            onPress={async () => {
              await signOut();
              navigation.popToTop();
            }}
          />
          <Hint>
            Drops this device’s key. It stays listed under Settings → API keys on the server until
            you revoke it there.
          </Hint>
        </View>

        <View style={{ marginTop: 'auto', paddingTop: 24, gap: 8, opacity: 0.7 }}>
          <Brand size={13} />
          <Meta>version {pkg.version}</Meta>
        </View>
      </ScrollView>
    </Screen>
  );
}

/** A settings row that goes somewhere, with the web hub's trailing chevron. */
function NavRow({ label, onPress }: { label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: c.border,
        opacity: pressed ? 0.6 : 1,
      })}>
      <Body style={{ fontSize: 15 }}>{label}</Body>
      <Body style={{ fontFamily: font.mono, fontSize: 16, color: c.mutedForeground }}>›</Body>
    </Pressable>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: c.border,
      }}>
      <Meta>{label}</Meta>
      {mono ? (
        <Mono numberOfLines={1} style={{ flexShrink: 1, fontSize: 12 }}>
          {value}
        </Mono>
      ) : (
        <Body numberOfLines={1} style={{ flexShrink: 1, fontSize: 14 }}>
          {value}
        </Body>
      )}
    </View>
  );
}
