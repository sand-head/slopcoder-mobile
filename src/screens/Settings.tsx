/**
 * The settings hub: what is true of this device, and a row into every
 * settings page the web has — the same list `Settings/Hub.razor` shows a
 * phone-width browser, with the same best-effort counts landing after the
 * list paints.
 *
 * Profile and SSO sign-ins are not here: they are Identity's cookie pages,
 * not the seam's, and a device key cannot reach them.
 */
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Alert, Platform, ScrollView, View } from 'react-native';
import { useAuth } from '../state/auth';
import { Body, Brand, Button, Meta, Mono, SectionLabel } from '../ui/kit';
import { HubRow } from '../ui/settings';
import { tapRefuse } from '../ui/haptics';
import { appVersion } from '../appInfo';
import { useTheme } from '../theme';

/** The workspace rows, in the web hub's order, each naming its screen. */
const PAGES: { route: string; label: string; count?: keyof Counts }[] = [
  { route: 'Connections', label: 'Connections', count: 'connections' },
  { route: 'McpServers', label: 'MCP servers' },
  { route: 'RemoteNodes', label: 'Remote nodes', count: 'nodes' },
  { route: 'Terminal', label: 'Terminal' },
  { route: 'Facets', label: 'Facets', count: 'facets' },
  { route: 'Hooks', label: 'Hooks' },
  { route: 'Memory', label: 'Memory' },
  { route: 'Skills', label: 'Skills', count: 'skills' },
  { route: 'Channels', label: 'Channels', count: 'channels' },
  { route: 'ApiKeys', label: 'API keys' },
];

interface Counts {
  connections?: string;
  nodes?: string;
  facets?: string;
  skills?: string;
  channels?: string;
}

export function SettingsScreen({ navigation }: { navigation: any }) {
  const credential = useAuth(s => s.credential);
  const seam = useAuth(s => s.seam);
  const signOut = useAuth(s => s.signOut);
  const [counts, setCounts] = useState<Counts>({});

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Settings' });
  }, [navigation]);

  // Each count is its own beat, so one slow call never holds the others, and
  // a count is decoration: a failed one leaves its row blank and still linked.
  const load = useCallback(() => {
    if (!seam) return;
    const count = (key: keyof Counts, read: () => Promise<string>) =>
      read()
        .then(value => setCounts(current => ({ ...current, [key]: value })))
        .catch(() => {});
    void count('connections', async () => {
      const [models, git] = await Promise.all([seam.connections(), seam.gitConnections().catch(() => [])]);
      return git.length > 0 ? `${models.length} · ${git.length} git` : String(models.length);
    });
    void count('nodes', async () => String((await seam.nodes()).length));
    void count('facets', async () => String((await seam.facets()).length));
    void count('skills', async () => String((await seam.skills()).length));
    void count('channels', async () => String((await seam.channels()).length));
  }, [seam]);

  useEffect(() => {
    load();
    return navigation.addListener('focus', load);
  }, [load, navigation]);

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
        <SectionLabel label="workspace" />
        {PAGES.map(page => (
          <HubRow
            key={page.route}
            label={page.label}
            count={page.count ? counts[page.count] ?? null : null}
            onPress={() => navigation.navigate(page.route)}
          />
        ))}
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
