/**
 * Bearer keys and device pairing. A minted key is readable exactly once, so it
 * comes up in a sheet that has to be dismissed on purpose; a pairing code is
 * shown as the digits another device types in, counting down the ninety
 * seconds the server gives it.
 *
 * This device's own key is in the list too — signing out drops it here, and
 * revoking it here signs this device out on its next request.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Share, View } from 'react-native';
import type { ApiKeySummary, DevicePairingCode } from '../../api/contracts';
import { day, secondsLeft, stamp } from '../../api/settings';
import { useAuth } from '../../state/auth';
import { Body, Button, Field, Hint, Meta } from '../../ui/kit';
import { Sheet } from '../../ui/Sheet';
import { CopyBox, Empty, ListRow, Section, SettingsPage, useFocusLoad } from '../../ui/settings';
import { tapConfirm, tapError, tapRefuse } from '../../ui/haptics';
import { font, useTheme } from '../../theme';

export function ApiKeysScreen({ navigation }: { navigation: any }) {
  const { c } = useTheme();
  const seam = useAuth(s => s.seam);
  const list = useFocusLoad(navigation, seam ? () => seam.apiKeys() : null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [minted, setMinted] = useState<string | null>(null);
  const [pairing, setPairing] = useState<DevicePairingCode | null>(null);
  const [left, setLeft] = useState(0);

  // Cosmetic only: the server holds the real expiry, and a phone clock that
  // disagrees can at worst show the wrong number while redemption decides.
  useEffect(() => {
    if (!pairing) return;
    const tick = () => {
      const remaining = secondsLeft(pairing.expiresAt);
      setLeft(remaining);
      if (remaining === 0) setPairing(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [pairing]);

  const mint = useCallback(() => {
    if (!seam || name.trim().length === 0) return;
    setBusy(true);
    seam
      .mintApiKey(name.trim())
      .then(result => {
        if (!result) throw new Error('The server minted no key.');
        tapConfirm();
        setMinted(result.fullKey);
        setName('');
        void list.reload();
      })
      .catch(e => {
        tapError();
        Alert.alert('Could not mint a key', e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
  }, [seam, name, list]);

  const pair = () => {
    if (!seam) return;
    setBusy(true);
    seam
      .startPairing()
      .then(code => setPairing(code))
      .catch(e => {
        tapError();
        Alert.alert('Could not issue a code', e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
  };

  const revoke = (key: ApiKeySummary) =>
    Alert.alert(`Revoke ‘${key.name}’?`, 'Anything using it stops working at once. If it is this phone’s key, you are signed out.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: () => {
          if (!seam) return;
          setBusy(true);
          seam
            .revokeApiKey(key.id)
            .then(() => tapRefuse())
            .catch(() => tapError())
            .finally(() => {
              setBusy(false);
              void list.reload();
            });
        },
      },
    ]);

  return (
    <SettingsPage keyboard refreshing={list.refreshing} onRefresh={list.refresh} error={list.error} loading={list.data === null && !list.error}>
      <Hint>
        Bearer keys for the headless exec API. POST /api/exec with a prompt starts an unattended session (approvals
        off, questions auto-dismissed, bounded iterations); GET /api/exec/&lt;id&gt;?wait=60 polls for the answer.
      </Hint>

      <Section label="keys" count={list.data?.length}>
        {list.data?.length === 0 ? <Empty>No API keys yet.</Empty> : null}
        {list.data?.map(key => (
          <ListRow
            key={key.id}
            title={key.name}
            subtitle={`${key.prefix}… · created ${day(key.createdAt)} · last used ${key.lastUsedAt ? stamp(key.lastUsedAt) : 'never'}`}
            disabled={busy}
            menu={[{ key: 'revoke', title: 'Revoke', symbol: 'trash', destructive: true, onPress: () => revoke(key) }]}
          />
        ))}
      </Section>

      <Section label="pair a device">
        <Hint>
          Point the slopcoder app on another device at this code and it mints a key of its own. The code works once,
          for 90 seconds — it is not a key.
        </Hint>
        {pairing ? (
          <View style={{ gap: 8, paddingTop: 12, alignItems: 'flex-start' }}>
            <Body selectable style={{ fontFamily: font.mono, fontSize: 34, letterSpacing: 6, color: c.foreground }}>
              {pairing.code}
            </Body>
            <Body accessibilityLiveRegion="polite" style={{ fontFamily: font.mono, fontSize: 11.5, color: c.mutedForeground }}>
              Expires in {left}s
            </Body>
            <Button label="New code" variant="outline" onPress={pair} disabled={busy} />
          </View>
        ) : (
          <View style={{ paddingTop: 12, alignItems: 'flex-start' }}>
            <Button label="Show pairing code" onPress={pair} busy={busy} />
          </View>
        )}
      </Section>

      <Section label="mint a key">
        <View style={{ gap: 10, paddingTop: 8 }}>
          <Field
            value={name}
            onChangeText={setName}
            placeholder="What is it for? (e.g. CI)"
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={mint}
            accessibilityLabel="Key name"
          />
          <View style={{ alignItems: 'flex-start' }}>
            <Button label="Mint key" onPress={mint} disabled={name.trim().length === 0} busy={busy} />
          </View>
        </View>
      </Section>

      <Sheet visible={minted !== null} title="Copy this key now" onClose={() => setMinted(null)}>
        <Meta>it is shown exactly once</Meta>
        {minted ? <CopyBox value={minted} /> : null}
        <Button
          label="Share"
          variant="outline"
          onPress={() => minted && void Share.share(Platform.OS === 'ios' ? { message: minted } : { message: minted })}
        />
        <Button label="Done" onPress={() => setMinted(null)} />
      </Sheet>
    </SettingsPage>
  );
}
