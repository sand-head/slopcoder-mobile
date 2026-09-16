/**
 * What the agent remembers across sessions, grouped the way the prompt sees
 * it: user-scoped entries first, then one group per repository. Pinning is a
 * row action, because it is the one thing here that costs tokens on every
 * request and the one thing a review is most likely to want to flip.
 */
import React, { useCallback, useLayoutEffect, useState } from 'react';
import { Alert } from 'react-native';
import type { MemorySummary } from '../../api/contracts';
import { groupMemories, stamp } from '../../api/settings';
import { useAuth } from '../../state/auth';
import { Hint } from '../../ui/kit';
import { BarText, Empty, ListRow, Section, SettingsPage, useFocusLoad } from '../../ui/settings';
import { barButton } from '../../navigation/headers';
import { tapConfirm, tapError } from '../../ui/haptics';

export function MemoryScreen({ navigation }: { navigation: any }) {
  const seam = useAuth(s => s.seam);
  const [busy, setBusy] = useState(false);
  const list = useFocusLoad(navigation, seam ? () => seam.memories() : null);

  const add = useCallback(() => navigation.navigate('DocEditor', { kind: 'memory' }), [navigation]);
  const edit = (entry: MemorySummary) => navigation.navigate('DocEditor', { kind: 'memory', entry });

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Memory',
      ...barButton({ label: 'New entry', symbol: 'plus', onPress: add }, ({ onPress }) => <BarText label="Add" onPress={onPress} />),
    });
  }, [navigation, add]);

  const run = (work: Promise<unknown>) => {
    setBusy(true);
    work
      .then(() => tapConfirm())
      .catch(() => tapError())
      .finally(() => {
        setBusy(false);
        void list.reload();
      });
  };

  /** Flip one entry's pin without opening the editor: a save of the same body. */
  const togglePin = (entry: MemorySummary) => {
    if (!seam) return;
    run(
      seam.saveMemory({
        repoKey: entry.repoKey,
        name: entry.name,
        description: entry.description,
        content: entry.content,
        pinned: !entry.pinned,
      }),
    );
  };

  const remove = (entry: MemorySummary) =>
    Alert.alert(`Delete ‘${entry.name}’?`, 'The agent forgets it; it may save it again if it learns it afresh.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => seam && run(seam.deleteMemory(entry.id)) },
    ]);

  const groups = list.data ? groupMemories(list.data) : [];

  return (
    <SettingsPage refreshing={list.refreshing} onRefresh={list.refresh} error={list.error} loading={list.data === null && !list.error}>
      <Hint>
        What the agent remembers across sessions. User-scoped entries apply everywhere; repo-scoped entries only join
        sessions on that repository. A pinned entry has its whole body in every system prompt instead of a one-line
        index entry; pin only what the agent must have without asking for it.
      </Hint>
      {list.data?.length === 0 ? <Empty>Nothing remembered yet. The agent saves entries as it works.</Empty> : null}
      {groups.map(group => (
        <Section key={group.key} label={group.title} count={group.entries.length}>
          {group.entries.map(entry => (
            <ListRow
              key={entry.id}
              title={entry.name}
              subtitle={entry.description.length > 0 ? entry.description : `updated ${stamp(entry.updatedAt)}`}
              tag={entry.pinned ? 'pinned' : undefined}
              tagTone="ok"
              chevron
              disabled={busy}
              onPress={() => edit(entry)}
              menu={[
                { key: 'pin', title: entry.pinned ? 'Unpin' : 'Pin', symbol: entry.pinned ? 'pin.slash' : 'pin', onPress: () => togglePin(entry) },
                { key: 'edit', title: 'Edit', symbol: 'pencil', onPress: () => edit(entry) },
                { key: 'delete', title: 'Delete', symbol: 'trash', destructive: true, onPress: () => remove(entry) },
              ]}
            />
          ))}
        </Section>
      ))}
    </SettingsPage>
  );
}
