/**
 * Deliberately thin. Everything configurable lives on the server and is reached
 * from the web UI; what belongs here is what is true of *this device*.
 */
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../state/auth';
import { Body, Button, Hint, Mono, Screen, SectionLabel } from '../ui/kit';

export function SettingsScreen({ navigation }: { navigation: any }) {
  const credential = useAuth(s => s.credential);
  const signOut = useAuth(s => s.signOut);
  const insets = useSafeAreaInsets();

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 24,
          gap: 18,
        }}>
        <Body style={{ fontSize: 22, fontWeight: '500' }}>Settings</Body>

        <View>
          <SectionLabel label="account" />
          <View style={{ gap: 4, paddingVertical: 10 }}>
            <Body>{credential?.userName ?? '—'}</Body>
            <Mono>{credential?.server ?? ''}</Mono>
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <Button
            label="Sign out"
            variant="destructive"
            onPress={async () => {
              await signOut();
              navigation.popToTop();
            }}
          />
          <Hint>
            Signing out drops this device’s key. It stays listed under Settings → API keys on the
            server until you revoke it there.
          </Hint>
        </View>
      </ScrollView>
    </Screen>
  );
}
