/**
 * Connect a ChatGPT subscription through the Codex device flow.
 *
 * The device flow's authorization code, PKCE verifier and every token stay on
 * the server: this screen starts the flow, shows the code to type into
 * chatgpt.com, and polls until the server says the connection exists. The
 * phone never holds anything a screenshot could leak. The fallback — pasting
 * a Codex CLI's auth.json — is the one place tokens travel inbound, and they
 * go straight to the server to be encrypted.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CodexPollStatus, type CodexDeviceStart } from '../../api/contracts';
import { timeSpanMs } from '../../api/settings';
import { useAuth } from '../../state/auth';
import { Body, Button, Hint, Mono, Screen } from '../../ui/kit';
import { BarText, CodeBox, Problem } from '../../ui/settings';
import { ConnectionBanner } from '../../ui/ConnectionBanner';
import { useHeaderInset } from '../../navigation/headers';
import { tapError, tapSuccess } from '../../ui/haptics';
import { font, useTheme } from '../../theme';

/** How long a device code is worth polling for. */
const DEADLINE_MS = 15 * 60 * 1000;

/** The provider's interval, but never a hot loop if it says zero. */
const MIN_INTERVAL_MS = 1000;

export function CodexConnectScreen({ navigation }: { navigation: any }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const seam = useAuth(s => s.seam);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<CodexDeviceStart | null>(null);
  const [status, setStatus] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');

  // The poll is a timer chain, not an interval: the next tick is scheduled
  // only once the last answer is in, so a slow server never stacks requests.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  const stopPolling = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    abort.current?.abort();
    abort.current = null;
  };

  useEffect(() => stopPolling, []);

  useLayoutEffect(() => {
    const cancel = () => navigation.goBack();
    navigation.setOptions({
      title: 'Connect ChatGPT',
      headerLeft: () => (Platform.OS === 'ios' ? null : <BarText label="Cancel" onPress={cancel} />),
      headerRight: () => null,
      unstable_headerLeftItems: () => [{ type: 'button', label: 'Cancel', onPress: cancel }],
      unstable_headerRightItems: () => [],
    });
  }, [navigation]);

  const finish = (why: string | null) => {
    stopPolling();
    setDevice(null);
    setStatus('');
    if (why === null) {
      tapSuccess();
      navigation.goBack();
      return;
    }
    tapError();
    setError(why);
  };

  const poll = (start: CodexDeviceStart, startedAt: number) => {
    const every = Math.max(MIN_INTERVAL_MS, timeSpanMs(start.interval));
    timer.current = setTimeout(() => {
      void (async () => {
        if (!seam) return;
        if (Date.now() - startedAt > DEADLINE_MS) {
          finish("The sign-in code expired. Start again when you're ready.");
          return;
        }
        const controller = new AbortController();
        abort.current = controller;
        try {
          // The server polls the provider, exchanges the code, and creates
          // the connection; only a status comes back here.
          const result = await seam.codexPoll(start.deviceAuthId!, start.userCode!, controller.signal);
          if (controller.signal.aborted) return;
          if (result.status === CodexPollStatus.Pending) {
            poll(start, startedAt);
            return;
          }
          finish(result.status === CodexPollStatus.Connected ? null : result.error ?? 'The sign-in failed.');
        } catch (e) {
          if (controller.signal.aborted) return;
          if (e instanceof Error && e.name === 'AbortError') return;
          // A missed poll is not a failed sign-in; try again on the next tick.
          poll(start, startedAt);
        }
      })();
    }, every);
  };

  const startDeviceAuth = async () => {
    if (!seam || busy) return;
    setBusy(true);
    setError(null);
    try {
      const start = await seam.codexStart();
      if (start.deviceAuthId === null || start.userCode === null) {
        setError(`${start.error ?? 'Device sign-in is unavailable.'} You can still import a Codex CLI login below.`);
        setShowImport(true);
        return;
      }
      setDevice(start);
      setStatus('Waiting for you to approve…');
      poll(start, Date.now());
    } catch (e) {
      tapError();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancelDeviceAuth = () => {
    stopPolling();
    setDevice(null);
    setStatus('');
  };

  const importAuth = async () => {
    if (!seam || busy) return;
    setBusy(true);
    setError(null);
    try {
      const why = await seam.codexImport(importJson);
      if (why !== null) {
        tapError();
        setError(why);
        return;
      }
      setImportJson('');
      tapSuccess();
      navigation.goBack();
    } catch (e) {
      tapError();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View pointerEvents="box-none" style={{ position: 'absolute', top: headerInset, left: 0, right: 0, zIndex: 1 }}>
        <ConnectionBanner />
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 18 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive">
        <View style={{ gap: 6 }}>
          <Body style={{ fontFamily: font.sansMedium }}>ChatGPT subscription (Codex)</Body>
          <Hint>
            Use a ChatGPT Plus/Pro plan's Codex allowance instead of API credits. Sign in with the account — usage bills against
            the subscription's limits.
          </Hint>
        </View>

        {error ? <Problem>{error}</Problem> : null}

        {device ? (
          <View style={{ gap: 14 }}>
            <Hint>Open the page below in a browser where you're signed in to ChatGPT, and enter this code:</Hint>
            <Mono selectable style={{ color: c.foreground, fontSize: 28, letterSpacing: 2, textAlign: 'center' }}>
              {device.userCode}
            </Mono>
            <Button
              label={`Open ${device.verificationUrl}`}
              variant="outline"
              onPress={() => void Linking.openURL(device.verificationUrl).catch(() => {})}
            />
            <Body accessibilityLiveRegion="polite" style={{ fontFamily: font.mono, fontSize: 11.5, color: c.mutedForeground }}>
              {status}
            </Body>
            <Button label="Cancel" variant="ghost" onPress={cancelDeviceAuth} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <Button label={busy ? 'Starting…' : 'Sign in with ChatGPT'} onPress={() => void startDeviceAuth()} busy={busy} />
            <Button
              label={showImport ? 'Hide import' : 'Import from Codex CLI instead'}
              variant="ghost"
              onPress={() => setShowImport(v => !v)}
              disabled={busy}
            />
            {showImport ? (
              <View style={{ gap: 12 }}>
                <Hint>
                  If the device sign-in is unavailable, run `codex login` on your own machine and paste the contents of
                  `~/.codex/auth.json` here. The tokens are stored encrypted and never shown again.
                </Hint>
                <CodeBox value={importJson} onChangeText={setImportJson} placeholder='{ "tokens": { … } }' editable={!busy} accessibilityLabel="auth.json" />
                <Button label={busy ? 'Importing…' : 'Import'} onPress={() => void importAuth()} busy={busy} disabled={importJson.trim().length === 0} />
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
