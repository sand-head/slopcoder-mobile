/**
 * MCP servers: the list, each row a switch, a tap to edit, a long press for
 * the rest. Adding and editing is a form, and a form is a sheet over this
 * page (`McpServerEditor`), which reloads when the sheet goes down.
 */
import React, { useCallback, useLayoutEffect, useState } from 'react';
import { Alert } from 'react-native';
import { McpTransportKind, type McpServerSummary } from '../../api/contracts';
import { mcpTarget } from '../../api/settings';
import { useAuth } from '../../state/auth';
import { Hint } from '../../ui/kit';
import { BarText, Empty, ListRow, Section, SettingsPage, useFocusLoad } from '../../ui/settings';
import { barButton } from '../../navigation/headers';
import { tapRefuse } from '../../ui/haptics';

export function McpServersScreen({ navigation }: { route?: any; navigation: any }) {
  const seam = useAuth(s => s.seam);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => seam!.mcpServers(), [seam]);
  const { data, error, refreshing, reload, refresh } = useFocusLoad(navigation, seam ? load : null);

  const add = useCallback(() => navigation.navigate('McpServerEditor'), [navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'MCP servers',
      ...barButton({ label: 'Add server', symbol: 'plus', onPress: add }, ({ onPress }) => (
        <BarText label="Add" onPress={onPress} />
      )),
    });
  }, [navigation, add]);

  /** One command at a time; the row's switch is the only thing that moves. */
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

  const remove = (server: McpServerSummary) =>
    Alert.alert('Remove this MCP server?', `“${server.displayName}” detaches from new sessions and its stored secrets are forgotten.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          tapRefuse();
          void run(() => seam!.deleteMcpServer(server.id));
        },
      },
    ]);

  const edit = (server: McpServerSummary) => navigation.navigate('McpServerEditor', { server });

  return (
    <SettingsPage refreshing={refreshing} onRefresh={refresh} error={error} loading={data === null && !error}>
      <Hint>
        Every enabled server attaches to each of your sessions. Stdio servers run inside the session's sandbox; HTTP
        servers are called directly. Tools appear to the agent as mcp__&lt;server&gt;__&lt;tool&gt;.
      </Hint>

      <Section label="servers" count={data?.length}>
        {data?.length === 0 ? <Empty>No MCP servers configured yet.</Empty> : null}
        {(data ?? []).map(server => (
          <ListRow
            key={server.id}
            title={server.displayName}
            tag={server.kind === McpTransportKind.Stdio ? 'stdio' : 'http'}
            subtitle={mcpTarget(server)}
            switchValue={server.enabled}
            onSwitch={on => void run(() => seam!.setMcpServerEnabled(server.id, on))}
            disabled={busy}
            dimmed={!server.enabled}
            onPress={() => edit(server)}
            menu={[
              { key: 'edit', title: 'Edit', symbol: 'pencil', onPress: () => edit(server) },
              { key: 'remove', title: 'Remove', symbol: 'trash', destructive: true, onPress: () => remove(server) },
            ]}
          />
        ))}
      </Section>
    </SettingsPage>
  );
}
