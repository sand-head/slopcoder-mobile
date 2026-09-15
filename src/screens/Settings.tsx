/**
 * Deliberately thin. Everything configurable lives on the server and is reached
 * from the web UI; what belongs here is what is true of *this device*.
 */
import React, { useLayoutEffect } from 'react';
import { Alert, Platform, ScrollView, View } from 'react-native';
import { useAuth } from '../state/auth';
import { Body, Brand, Button, Hint, Meta, Mono, SectionLabel } from '../ui/kit';
import { tapRefuse } from '../ui/haptics';
import { appVersion } from '../appInfo';
import { useTheme } from '../theme';

export function SettingsScreen({ navigation }: { navigation: any }) {
  const credential = useAuth(s => s.credential);
  const signOut = useAuth(s => s.signOut);

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Settings' });
  }, [navigation]);

  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'This device’s key is dropped. It stays listed under API keys on the server until you revoke it there.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          tapRefuse();
          // The navigator swaps to the sign-in stack on its own once the
          // credential is gone; nothing to pop.
          void signOut();
        },
      },
    ]);

  return (
    // The scroll view is the screen, with nothing wrapped around it: UIKit
    // finds the one that drives the large title by walking first children down
    // from the screen, and a view in between is one step too many.
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, paddingBottom: 24, gap: 18 }}>
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
        <SectionLabel label="elsewhere" />
        <Hint>
          Everything else — providers, facets, memory, remote nodes — lives on the server. Open
          slopcoder in a browser to reach it, and to write a routine: choosing a model, a
          schedule, triggers and where the answer goes is a form, not a phone screen. Code mode
          and the terminal are there too; they are not in this app on purpose.
        </Hint>
      </View>

      <View>
        <SectionLabel label="session" />
        <Button label="Sign out" variant="link-destructive" onPress={confirmSignOut} />
      </View>

      <View style={{ marginTop: 'auto', paddingTop: 24, gap: 8, opacity: 0.7 }}>
        <Brand size={13} />
        <Meta>version {appVersion()}</Meta>
      </View>
    </ScrollView>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
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
