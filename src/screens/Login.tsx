/**
 * Getting a key onto the device: a password, or a QR code the web settings page
 * draws. Both end at the same place — a `slop_…` key in the keychain.
 *
 * The password is never stored. What is stored is the device-scoped key the
 * server mints in exchange for it, which the owner can revoke from
 * `/settings/api-keys` without changing their password.
 *
 * The form is one the OS can fill: `textContentType` and `autoComplete` are
 * what iCloud Keychain and Google's autofill key off, and the return key walks
 * server → username → password → sign in, so a thumb never has to find the
 * next box.
 */
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  isScannedCode,
  useCameraPermission,
  useObjectOutput,
  usePreviewOutput,
} from 'react-native-vision-camera';
import { parsePairingUri } from '../api/seam';
import { loginMessage, useAuth } from '../state/auth';
import { Body, Brand, Button, Field, Hint, Meta, Screen } from '../ui/kit';
import { tapError, tapSuccess } from '../ui/haptics';
import { radius, useTheme } from '../theme';
import { useHeaderInset } from '../navigation/headers';

export function LoginScreen({ navigation, route }: { navigation: any; route: any }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const signInWithPassword = useAuth(s => s.signInWithPassword);
  const signInWithPairingCode = useAuth(s => s.signInWithPairingCode);

  const [server, setServer] = useState('https://');
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userField = useRef<React.ComponentRef<typeof TextInput>>(null);
  const passwordField = useRef<React.ComponentRef<typeof TextInput>>(null);

  const ready = !!server.trim() && !!userName.trim() && !!password;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(server.trim(), userName.trim(), password);
      tapSuccess();
    } catch (e) {
      tapError();
      setError(loginMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // The scanner is its own screen; it hands the code back through params so
  // the redeem, and any error, happen on the page that shows errors.
  const scanned: { server: string; code: string } | undefined = route.params?.scanned;
  useEffect(() => {
    if (!scanned) return;
    navigation.setParams({ scanned: undefined });
    setBusy(true);
    setError(null);
    signInWithPairingCode(scanned.server, scanned.code)
      .then(() => tapSuccess())
      .catch(e => {
        tapError();
        setError(loginMessage(e));
      })
      .finally(() => setBusy(false));
  }, [scanned, navigation, signInWithPairingCode]);

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            padding: 20,
            paddingTop: insets.top + 48,
            paddingBottom: insets.bottom + 24,
            gap: 14,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive">
          <View style={{ marginBottom: 8 }}>
            <Brand size={17} />
          </View>

          <Meta>Server</Meta>
          <Field
            value={server}
            onChangeText={setServer}
            placeholder="https://slop.example.com"
            keyboardType="url"
            textContentType="URL"
            autoComplete="url"
            returnKeyType="next"
            onSubmitEditing={() => userField.current?.focus()}
          />

          <Meta>Username</Meta>
          <Field
            ref={userField}
            value={userName}
            onChangeText={setUserName}
            placeholder="you"
            textContentType="username"
            autoComplete="username"
            returnKeyType="next"
            onSubmitEditing={() => passwordField.current?.focus()}
          />

          <Meta>Password</Meta>
          <Field
            ref={passwordField}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secure
            textContentType="password"
            autoComplete="current-password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          {error ? (
            <Body accessibilityLiveRegion="polite" style={{ color: c.destructive, fontSize: 13 }}>
              {error}
            </Body>
          ) : null}

          <Button
            label="Sign in"
            onPress={submit}
            busy={busy}
            disabled={!ready}
            style={{ marginTop: 6 }}
          />

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              marginVertical: 10,
            }}>
            <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
            <Meta>or</Meta>
            <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
          </View>

          <Button
            label="Scan a pairing code"
            variant="outline"
            disabled={busy}
            onPress={() => navigation.navigate('Scan')}
          />
          <Hint>
            Open Settings → API keys in slopcoder on a computer and choose “Show pairing code”. The
            code works once, for ninety seconds.
          </Hint>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * The camera, as a full-screen modal with a real bar over it: a Cancel the
 * platform draws, and an Android back button that closes the scanner rather
 * than the app — which is what happened when this was a state flip inside the
 * login page.
 */
export function ScanScreen({ navigation }: { navigation: any }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const { hasPermission, requestPermission } = useCameraPermission();
  const handled = useRef(false);

  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Button label="Cancel" variant="ghost" onPress={() => navigation.goBack()} />
      ),
    });
  }, [navigation]);

  const preview = usePreviewOutput();
  const codes = useObjectOutput({
    types: ['qr'],
    onObjectsScanned(objects) {
      // The camera reports per frame, and a pairing code is single-use: the
      // second frame must not spend it a second time.
      if (handled.current) return;

      for (const object of objects) {
        if (!isScannedCode(object) || !object.value) continue;
        const parsed = parsePairingUri(object.value);
        if (!parsed) continue;
        handled.current = true;
        navigation.navigate('Login', { scanned: parsed });
        return;
      }
    },
  });

  if (!hasPermission) {
    return (
      <Screen>
        <View style={{ flex: 1, padding: 20, paddingTop: headerInset + 24, gap: 14 }}>
          <Body>slopcoder needs the camera to scan a pairing code.</Body>
          <Button label="Allow camera" onPress={() => void requestPermission()} />
        </View>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Camera device="back" isActive outputs={[preview, codes]} style={{ flex: 1 }} />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: insets.bottom + 24,
          paddingHorizontal: 20,
        }}>
        <View style={{ backgroundColor: c.card, borderRadius: radius.md, padding: 12 }}>
          <Hint>Point the camera at the QR code on the API keys page.</Hint>
        </View>
      </View>
    </View>
  );
}
