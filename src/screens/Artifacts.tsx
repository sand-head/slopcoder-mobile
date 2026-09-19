/**
 * What the agent published: reports it wrote up, files a routine generated.
 *
 * These are the one thing in the app that is not about a session — they outlive
 * the session that made them, which is the whole reason they exist rather than
 * being files in a sandbox nobody can reach from a phone. So this is a tab of
 * its own rather than a row inside Settings.
 *
 * A card each, and the card shows the document rather than describing it. A
 * list of titles makes you remember which report was which; the opening of each
 * one, drawn small, does not.
 */
import React, { useLayoutEffect } from 'react';
import { Alert, View } from 'react-native';
import type { ArtifactSummary } from '../api/contracts';
import { useAuth } from '../state/auth';
import { ArtifactCard, artifactMeta, bytes } from '../ui/ArtifactCard';
import { Empty, SettingsPage, useFocusLoad } from '../ui/settings';
import { tapConfirm, tapError } from '../ui/haptics';

export { artifactMeta, bytes };

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
      {list.data?.length === 0 ? (
        <Empty>Nothing published yet. Ask the agent to write something up and publish it.</Empty>
      ) : null}
      {list.data && list.data.length > 0 ? (
        <View style={{ gap: 14 }}>
          {list.data.map(artifact => (
            <ArtifactCard
              key={artifact.id}
              artifact={artifact}
              onPress={() => open(artifact)}
              menu={[
                { key: 'open', title: 'Open', symbol: 'doc.text', onPress: () => open(artifact) },
                { key: 'delete', title: 'Delete', symbol: 'trash', destructive: true, onPress: () => remove(artifact) },
              ]}
            />
          ))}
        </View>
      ) : null}
    </SettingsPage>
  );
}
