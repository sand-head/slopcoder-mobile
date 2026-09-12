/**
 * Getting a key onto the device: a password, or a QR code the web settings page
 * draws. Both end at the same place — a `slop_…` key in the keychain.
 *
 * The password is never stored. What is stored is the device-scoped key the
 * server mints in exchange for it, which the owner can revoke from
 * `/settings/api-keys` without changing their password.
 */
import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
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
import { radius, useTheme } from '../theme';

export function LoginScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const signInWithPassword = useAuth(s => s.signInWithPassword);
  const signInWithPairingCode = useAuth(s => s.signInWithPairingCode);

  const [server, setServer] = useState('https://');
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(server.trim(), userName.trim(), password);
    } catch (e) {
      setError(loginMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onScanned = async (raw: string) => {
    const parsed = parsePairingUri(raw);
    if (!parsed) return;

    setScanning(false);
    setBusy(true);
    setError(null);
    try {
      // The QR carries the server too, so a scan needs nothing typed at all.
      await signInWithPairingCode(parsed.server, parsed.code);
    } catch (e) {
      setError(loginMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (scanning) {
    return <Scanner onScanned={onScanned} onCancel={() => setScanning(false)} />;
  }

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
          keyboardShouldPersistTaps="handled">
          <View style={{ marginBottom: 8 }}>
            <Brand size={17} />
          </View>

          <Meta>Server</Meta>
          <Field
            value={server}
            onChangeText={setServer}
            placeholder="https://slop.example.com"
            keyboardType="url"
          />

          <Meta>Username</Meta>
          <Field value={userName} onChangeText={setUserName} placeholder="you" />

          <Meta>Password</Meta>
          <Field value={password} onChangeText={setPassword} placeholder="••••••••" secure />

          {error ? <Body style={{ color: c.destructive, fontSize: 13 }}>{error}</Body> : null}

          <Button
            label="Sign in"
            onPress={submit}
            busy={busy}
            disabled={!server.trim() || !userName.trim() || !password}
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

          <Button label="Scan a pairing code" variant="outline" onPress={() => setScanning(true)} />
          <Hint>
            Open Settings → API keys in slopcoder on a computer and choose “Show pairing code”. The
            code works once, for ninety seconds.
          </Hint>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Scanner({
  onScanned,
  onCancel,
}: {
  onScanned: (value: string) => void;
  onCancel: () => void;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { hasPermission, requestPermission } = useCameraPermission();
  const handled = useRef(false);

  const preview = usePreviewOutput();
  const codes = useObjectOutput({
    types: ['qr'],
    onObjectsScanned(objects) {
      // The camera reports per frame, and a pairing code is single-use: the
      // second frame must not spend it a second time.
      if (handled.current) return;

      for (const object of objects) {
        if (!isScannedCode(object) || !object.value) continue;
        handled.current = true;
        onScanned(object.value);
        return;
      }
    },
  });

  if (!hasPermission) {
    return (
      <Screen>
        <View style={{ flex: 1, padding: 20, paddingTop: insets.top + 48, gap: 14 }}>
          <Body>slopcoder needs the camera to scan a pairing code.</Body>
          <Button label="Allow camera" onPress={() => void requestPermission()} />
          <Button label="Back" variant="outline" onPress={onCancel} />
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
          gap: 10,
        }}>
        <View style={{ backgroundColor: c.card, borderRadius: radius.md, padding: 12 }}>
          <Hint>Point the camera at the QR code on the API keys page.</Hint>
        </View>
        <Button label="Cancel" variant="outline" onPress={onCancel} />
      </View>
    </View>
  );
}
