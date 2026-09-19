/**
 * Register or edit one remote node: a form presented as a sheet. A new node
 * either gets a key generated for it on the server — the recommended road,
 * since the private key then never exists anywhere else — or takes one
 * pasted in, which travels once in the request body and never back.
 *
 * Registering with a generated key answers the line to install on the host,
 * and this screen hands that line to the list, which shows it in a sheet:
 * the list is where the key can be re-viewed later, so it owns that sheet.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RemoteNodeSummary } from '../../api/contracts';
import { useAuth } from '../../state/auth';
import { Screen } from '../../ui/kit';
import { SheetSegments } from '../../ui/Sheet';
import { BarText, CodeBox, FormField, Problem } from '../../ui/settings';
import { ConnectionBanner } from '../../ui/ConnectionBanner';
import { useHeaderInset } from '../../navigation/headers';
import { tapConfirm, tapError, tapSelect } from '../../ui/haptics';
import { KEYBOARD_GAP } from '../../ui/keyboard';

export function NodeEditorScreen({ route, navigation }: { route: any; navigation: any }) {
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const seam = useAuth(s => s.seam);

  const node: RemoteNodeSummary | undefined = route.params?.node;
  const creating = node === undefined;

  const [name, setName] = useState(node?.name ?? '');
  const [host, setHost] = useState(node?.host ?? '');
  const [port, setPort] = useState(String(node?.port ?? 22));
  const [username, setUsername] = useState(node?.username ?? '');
  const [keySource, setKeySource] = useState<'generate' | 'paste'>('generate');
  const [privateKey, setPrivateKey] = useState('');

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leaving = useRef(false);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  const ready = name.trim().length > 0 && host.trim().length > 0 && username.trim().length > 0 && !saving;
  const save = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const cancel = () => navigation.goBack();
    const confirm = () => save.current();
    const confirmLabel = creating ? 'Register node' : 'Save changes';
    navigation.setOptions({
      title: creating ? 'Register a node' : `Edit "${node.name}"`,
      headerLeft: () => (Platform.OS === 'ios' ? null : <BarText label="Cancel" onPress={cancel} />),
      headerRight: () => (Platform.OS === 'ios' ? null : <BarText label={confirmLabel} onPress={confirm} disabled={!ready} />),
      unstable_headerLeftItems: () => [{ type: 'button', label: 'Cancel', onPress: cancel }],
      unstable_headerRightItems: () => [
        { type: 'button', label: confirmLabel, variant: 'done', onPress: confirm, disabled: !ready },
      ],
    });
  }, [navigation, creating, node, ready]);

  useEffect(() => {
    return navigation.addListener('beforeRemove', (e: any) => {
      if (!dirty || leaving.current) return;
      e.preventDefault();
      Alert.alert('Discard changes?', undefined, [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            leaving.current = true;
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
  }, [navigation, dirty]);

  save.current = () => {
    void (async () => {
      if (!seam || saving) return;
      const pasted = privateKey.trim().length === 0 ? null : privateKey;
      if (creating && keySource === 'paste' && pasted === null) {
        tapError();
        setError('Paste the private key, or switch to a generated one.');
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const request = {
          name: name.trim(),
          host: host.trim(),
          port: parseInt(port.trim(), 10) || 22,
          username: username.trim(),
          privateKeyPem: creating && keySource === 'generate' ? null : pasted,
        };
        if (!creating) {
          const problem = await seam.updateNode(node.id, request);
          if (problem) {
            tapError();
            setError(problem);
            return;
          }
          tapConfirm();
          leaving.current = true;
          navigation.goBack();
          return;
        }

        const created = await seam.createNode(request);
        if (created.error) {
          tapError();
          setError(created.error);
          return;
        }
        tapConfirm();
        leaving.current = true;
        navigation.goBack();
        if (created.authorizedKeysLine) {
          navigation.navigate('RemoteNodes', { install: { node: request.name, line: created.authorizedKeysLine } });
        }
      } catch (e) {
        tapError();
        setError(e instanceof Error && e.name !== 'SeamError' ? e.message : 'The server could not be reached. Nothing was saved.');
      } finally {
        setSaving(false);
      }
    })();
  };

  const showKey = !creating || keySource === 'paste';

  return (
    <Screen>
      <View pointerEvents="box-none" style={{ position: 'absolute', top: headerInset, left: 0, right: 0, zIndex: 1 }}>
        <ConnectionBanner />
      </View>

      <KeyboardAwareScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 18 }}
        keyboardShouldPersistTaps="handled"
        // Scrolls the field being typed in clear of the keyboard, and only
        // when the keyboard would actually cover it — see ui/keyboard.ts for
        // what the prop this replaced did instead. Layout mode keeps the
        // scroll view unwrapped, where the large title can find it.
        bottomOffset={KEYBOARD_GAP}
        mode="layout"
        keyboardDismissMode="interactive">
        {error ? <Problem>{error}</Problem> : null}

        <FormField
          label="name"
          value={name}
          onChangeText={touch(setName)}
          placeholder="pi-media"
          hint="The handle the agent uses — short, no spaces."
          accessibilityLabel="Name"
          editable={!saving}
        />

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <FormField
            label="host"
            value={host}
            onChangeText={touch(setHost)}
            placeholder="192.168.1.20"
            keyboardType="url"
            accessibilityLabel="Host"
            editable={!saving}
            style={{ flex: 1 }}
          />
          <FormField
            label="port"
            value={port}
            onChangeText={touch(setPort)}
            placeholder="22"
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="Port"
            editable={!saving}
            style={{ width: 88 }}
          />
        </View>

        <FormField label="username" value={username} onChangeText={touch(setUsername)} placeholder="pi" accessibilityLabel="Username" editable={!saving} />

        {creating ? (
          <SheetSegments
            label="ssh key"
            options={[
              { key: 'generate', label: 'Generate (recommended)' },
              { key: 'paste', label: 'Paste a private key' },
            ]}
            selected={keySource}
            onSelect={key => {
              tapSelect();
              touch(setKeySource)(key as 'generate' | 'paste');
            }}
          />
        ) : null}

        {showKey ? (
          <CodeBox
            label={creating ? 'private key' : 'replace private key'}
            value={privateKey}
            onChangeText={touch(setPrivateKey)}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            minHeight={140}
            editable={!saving}
            accessibilityLabel="Private key"
            hint={`Unencrypted OpenSSH, PKCS#8, or PuTTY format.${creating ? '' : ' Leave empty to keep the stored key.'}`}
          />
        ) : null}
      </KeyboardAwareScrollView>
    </Screen>
  );
}
