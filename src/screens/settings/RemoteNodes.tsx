/**
 * Remote nodes: real machines reached over SSH from the server. Each row is
 * a switch, a tap to edit, and a menu for the rest — test, the key to
 * install, the host-key pin, a new key, removal. A key's install line is
 * shown in a sheet, which the editor also opens after registering a node
 * with a generated key: that line is the one thing a fresh node needs.
 */
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Alert, Platform, Share } from 'react-native';
import { NodeKeyKind, type RemoteNodeSummary } from '../../api/contracts';
import { installCommand, nodeTarget, stamp } from '../../api/settings';
import { useAuth } from '../../state/auth';
import { Button, Hint, Mono } from '../../ui/kit';
import { Sheet } from '../../ui/Sheet';
import { BarText, CopyBox, Empty, ListRow, Section, SettingsPage, useFocusLoad } from '../../ui/settings';
import { barButton } from '../../navigation/headers';
import type { MenuItem } from '../../ui/menu';
import { tapConfirm, tapError, tapRefuse } from '../../ui/haptics';

interface Install {
  node: string;
  line: string;
}

export function RemoteNodesScreen({ route, navigation }: { route?: any; navigation: any }) {
  const seam = useAuth(s => s.seam);
  const [busy, setBusy] = useState(false);
  const [install, setInstall] = useState<Install | null>(null);

  const load = useCallback(() => seam!.nodes(), [seam]);
  const { data, error, refreshing, reload, refresh } = useFocusLoad(navigation, seam ? load : null);

  const add = useCallback(() => navigation.navigate('NodeEditor'), [navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Remote nodes',
      ...barButton({ label: 'Register a node', symbol: 'plus', onPress: add }, ({ onPress }) => (
        <BarText label="Add" onPress={onPress} />
      )),
    });
  }, [navigation, add]);

  // The editor hands a new node's install line over as a param; shown once,
  // then cleared so a later return to this screen does not show it again.
  const handed: Install | undefined = route?.params?.install;
  useEffect(() => {
    if (!handed) return;
    setInstall(handed);
    navigation.setParams({ install: undefined });
  }, [handed, navigation]);

  const run = async (command: () => Promise<unknown>) => {
    if (!seam || busy) return;
    setBusy(true);
    try {
      await command();
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const test = (node: RemoteNodeSummary) =>
    void run(async () => {
      const result = await seam!.testNode(node.id);
      if (result.ok) tapConfirm();
      else tapError();
      Alert.alert(result.ok ? 'Connected' : 'Could not connect', result.detail);
    });

  const resetPin = (node: RemoteNodeSummary) =>
    Alert.alert(
      'Reset the host key pin?',
      `Only do this if “${node.name}” was legitimately reinstalled. The next successful connection pins whatever key the machine presents.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset pin', style: 'destructive', onPress: () => void run(() => seam!.resetNodeHostKeyPin(node.id)) },
      ],
    );

  const regenerate = (node: RemoteNodeSummary) =>
    Alert.alert(
      'Generate a new key?',
      `The current key for “${node.name}” stops working once you replace the authorized_keys line on the node.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              const result = await seam!.regenerateNodeKey(node.id);
              if (result.error || !result.authorizedKeysLine) {
                tapError();
                Alert.alert('Could not generate a key', result.error ?? 'The server did not answer.');
                return;
              }
              tapConfirm();
              setInstall({ node: node.name, line: result.authorizedKeysLine });
            }),
        },
      ],
    );

  const remove = (node: RemoteNodeSummary) =>
    Alert.alert(
      'Remove this node?',
      `“${node.name}” detaches from sessions and its key is forgotten. The audit log of past commands is kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            tapRefuse();
            void run(() => seam!.deleteNode(node.id));
          },
        },
      ],
    );

  const edit = (node: RemoteNodeSummary) => navigation.navigate('NodeEditor', { node });

  const menuFor = (node: RemoteNodeSummary): MenuItem[] => [
    { key: 'test', title: 'Test', symbol: 'bolt', onPress: () => test(node) },
    ...(node.keyKind === NodeKeyKind.Generated && node.publicKey.length > 0
      ? [{ key: 'key', title: 'Show key', symbol: 'key', onPress: () => setInstall({ node: node.name, line: node.publicKey }) }]
      : []),
    ...(node.hostKeyFingerprint
      ? [{ key: 'pin', title: 'Reset pin', symbol: 'pin.slash', onPress: () => resetPin(node) }]
      : []),
    { key: 'newkey', title: 'New key', symbol: 'arrow.triangle.2.circlepath', onPress: () => regenerate(node) },
    { key: 'edit', title: 'Edit', symbol: 'pencil', onPress: () => edit(node) },
    { key: 'remove', title: 'Remove', symbol: 'trash', destructive: true, onPress: () => remove(node) },
  ];

  const shareLine = (line: string) => {
    const message = installCommand(line);
    void Share.share(Platform.OS === 'ios' ? { message } : { message });
  };

  return (
    <SettingsPage refreshing={refreshing} onRefresh={refresh} error={error} loading={data === null && !error}>
      <Hint>
        Real machines you own, reached over SSH from the server — the private key never leaves it. Attach a node to a
        session and the agent gets a run_on_node tool; every command it runs there asks for your approval first. Unlike
        a sandbox there is no undo.
      </Hint>

      <Section label="nodes" count={data?.length}>
        {data?.length === 0 ? <Empty>No remote nodes registered yet.</Empty> : null}
        {(data ?? []).map(node => (
          <ListRow
            key={node.id}
            title={node.name}
            tag={node.keyKind === NodeKeyKind.Generated ? 'generated' : 'pasted'}
            subtitle={nodeTarget(node)}
            warn={node.lastError}
            switchValue={node.enabled}
            onSwitch={on => void run(() => seam!.setNodeEnabled(node.id, on))}
            disabled={busy}
            dimmed={!node.enabled}
            onPress={() => edit(node)}
            menu={menuFor(node)}>
            <Mono numberOfLines={1}>
              {node.hostKeyFingerprint ?? 'unpinned'} · seen {node.lastConnectedAt ? stamp(node.lastConnectedAt) : 'never'}
            </Mono>
          </ListRow>
        ))}
      </Section>

      <Sheet visible={install !== null} title="Install this key" onClose={() => setInstall(null)}>
        {install ? (
          <>
            <Hint>Install this key on {install.node} — run as the login user on the node:</Hint>
            <CopyBox value={installCommand(install.line)} />
            <Button label="Share" variant="outline" onPress={() => shareLine(install.line)} />
            <Hint>The public key stays re-viewable here; the private key never leaves the server.</Hint>
            <Button label="Done" onPress={() => setInstall(null)} />
          </>
        ) : null}
      </Sheet>
    </SettingsPage>
  );
}
