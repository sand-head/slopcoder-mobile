/**
 * What the agent published: reports it wrote up, files a routine generated.
 *
 * These are the one thing in the app that is not about a session — they outlive
 * the session that made them, which is the whole reason they exist rather than
 * being files in a sandbox nobody can reach from a phone. So this is a tab of
 * its own rather than a row inside Settings.
 */
import React, { useLayoutEffect } from 'react';
import { Alert } from 'react-native';
import type { ArtifactSummary } from '../api/contracts';
import { useAuth } from '../state/auth';
import { Hint } from '../ui/kit';
import { Empty, ListRow, Section, SettingsPage, useFocusLoad } from '../ui/settings';
import { tapConfirm, tapError } from '../ui/haptics';

/** "12.4 KB" — the same wording the cockpit and `slop` use. */
export function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${trim(size / 1024)} KB`;
  return `${trim(size / (1024 * 1024))} MB`;
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

/** "battery-landscape · 12.4 KB · v3 · 17 Sep" — what a row says under its title. */
export function artifactMeta(artifact: ArtifactSummary): string {
  const parts = [artifact.slug, bytes(artifact.size)];
  if (artifact.version > 1) parts.push(`v${artifact.version}`);
  parts.push(
    new Date(artifact.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  );
  return parts.join(' · ');
}

export function ArtifactsScreen({ navigation }: { navigation: any }) {
  const seam = useAuth(s => s.seam);
  const list = useFocusLoad(navigation, seam ? () => seam.artifacts() : null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Artifacts' });
  }, [navigation]);

  const remove = (artifact: ArtifactSummary) =>
    Alert.alert(`Delete ‘${artifact.title}’?`, 'The artifact and its share link, if it has one, are gone for good.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (!seam) return;
          seam
            .deleteArtifact(artifact.id)
            .then(() => tapConfirm())
            .catch(() => tapError())
            .finally(() => void list.reload());
        },
      },
    ]);

  const open = (artifact: ArtifactSummary) =>
    navigation.navigate('Artifact', { id: artifact.id, title: artifact.title });

  return (
    <SettingsPage
      refreshing={list.refreshing}
      onRefresh={list.refresh}
      error={list.error}
      loading={list.data === null && !list.error}>
      <Hint>
        What the agent published — research it wrote up, files a routine generated. These outlive the session that made
        them. Open one to read it, or to give it an unlisted link anyone can read.
      </Hint>
      {list.data?.length === 0 ? (
        <Empty>Nothing published yet. Ask the agent to write something up and publish it.</Empty>
      ) : null}
      {list.data && list.data.length > 0 ? (
        <Section label="published" count={list.data.length}>
          {list.data.map(artifact => (
            <ListRow
              key={artifact.id}
              title={artifact.title}
              subtitle={artifactMeta(artifact)}
              tag={artifact.shared ? 'shared' : artifact.format}
              tagTone={artifact.shared ? 'ok' : 'muted'}
              chevron
              onPress={() => open(artifact)}
              menu={[
                { key: 'open', title: 'Open', symbol: 'doc.text', onPress: () => open(artifact) },
                { key: 'delete', title: 'Delete', symbol: 'trash', destructive: true, onPress: () => remove(artifact) },
              ]}
            />
          ))}
        </Section>
      ) : null}
    </SettingsPage>
  );
}
