/**
 * Personal facets: personas available in every session. The rows are the
 * list; writing one is the document editor, presented over this page.
 */
import React, { useCallback, useLayoutEffect, useState } from 'react';
import { Alert } from 'react-native';
import type { UserFacetSummary } from '../../api/contracts';
import { stamp } from '../../api/settings';
import { useAuth } from '../../state/auth';
import { Hint } from '../../ui/kit';
import { BarText, Empty, ListRow, Section, SettingsPage, useFocusLoad } from '../../ui/settings';
import { barButton } from '../../navigation/headers';
import { tapConfirm, tapError } from '../../ui/haptics';

export function FacetsScreen({ navigation }: { navigation: any }) {
  const seam = useAuth(s => s.seam);
  const [busy, setBusy] = useState(false);
  const list = useFocusLoad(navigation, seam ? () => seam.userFacets() : null);

  const add = useCallback(() => navigation.navigate('DocEditor', { kind: 'facet' }), [navigation]);
  const edit = (entry: UserFacetSummary) => navigation.navigate('DocEditor', { kind: 'facet', entry });

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Facets',
      ...barButton({ label: 'New facet', symbol: 'plus', onPress: add }, ({ onPress }) => <BarText label="Add" onPress={onPress} />),
    });
  }, [navigation, add]);

  const remove = (entry: UserFacetSummary) =>
    Alert.alert(`Delete ‘${entry.name}’?`, 'Sessions using it fall back to the default facet.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (!seam) return;
          setBusy(true);
          seam
            .deleteFacet(entry.id)
            .then(() => tapConfirm())
            .catch(() => tapError())
            .finally(() => {
              setBusy(false);
              void list.reload();
            });
        },
      },
    ]);

  return (
    <SettingsPage refreshing={list.refreshing} onRefresh={list.refresh} error={list.error} loading={list.data === null && !list.error}>
      <Hint>
        Personal personas, available in every session. Precedence: repo facets beat these; these beat the shipped
        plan/execute.
      </Hint>
      <Section label="facets" count={list.data?.length}>
        {list.data?.length === 0 ? <Empty>No personal facets yet.</Empty> : null}
        {list.data?.map(facet => (
          <ListRow
            key={facet.id}
            title={facet.name}
            subtitle={`updated ${stamp(facet.updatedAt)}`}
            chevron
            disabled={busy}
            onPress={() => edit(facet)}
            menu={[
              { key: 'edit', title: 'Edit', symbol: 'pencil', onPress: () => edit(facet) },
              { key: 'delete', title: 'Delete', symbol: 'trash', destructive: true, onPress: () => remove(facet) },
            ]}
          />
        ))}
      </Section>
    </SettingsPage>
  );
}
