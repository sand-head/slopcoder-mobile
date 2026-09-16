/**
 * Skills: procedures the agent loads on demand, stored against the account.
 * The agent writes most of these itself; this page is where a wrong one gets
 * fixed or thrown away.
 */
import React, { useCallback, useLayoutEffect, useState } from 'react';
import { Alert } from 'react-native';
import type { UserSkillSummary } from '../../api/contracts';
import { describeSkill, stamp } from '../../api/settings';
import { useAuth } from '../../state/auth';
import { Hint } from '../../ui/kit';
import { BarText, Empty, ListRow, Section, SettingsPage, useFocusLoad } from '../../ui/settings';
import { barButton } from '../../navigation/headers';
import { tapConfirm, tapError } from '../../ui/haptics';

export function SkillsScreen({ navigation }: { navigation: any }) {
  const seam = useAuth(s => s.seam);
  const [busy, setBusy] = useState(false);
  const list = useFocusLoad(navigation, seam ? () => seam.skills() : null);

  const add = useCallback(() => navigation.navigate('DocEditor', { kind: 'skill' }), [navigation]);
  const edit = (entry: UserSkillSummary) => navigation.navigate('DocEditor', { kind: 'skill', entry });

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Skills',
      ...barButton({ label: 'New skill', symbol: 'plus', onPress: add }, ({ onPress }) => <BarText label="Add" onPress={onPress} />),
    });
  }, [navigation, add]);

  const remove = (entry: UserSkillSummary) =>
    Alert.alert(`Delete ‘${entry.name}’?`, 'The agent can write it again if it works the procedure out afresh.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (!seam) return;
          setBusy(true);
          seam
            .deleteSkill(entry.id)
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
        Procedures the agent can load on demand, available in every session. The agent writes these itself with
        save_skill after working something out; yours win over a repository's skill of the same name.
      </Hint>
      <Section label="skills" count={list.data?.length}>
        {list.data?.length === 0 ? <Empty>No skills saved yet. The agent writes them as it learns procedures.</Empty> : null}
        {list.data?.map(skill => {
          const description = describeSkill(skill.content);
          return (
            <ListRow
              key={skill.id}
              title={skill.name}
              subtitle={description.length > 0 ? `${description} · ${stamp(skill.updatedAt)}` : `updated ${stamp(skill.updatedAt)}`}
              chevron
              disabled={busy}
              onPress={() => edit(skill)}
              menu={[
                { key: 'edit', title: 'Edit', symbol: 'pencil', onPress: () => edit(skill) },
                { key: 'delete', title: 'Delete', symbol: 'trash', destructive: true, onPress: () => remove(skill) },
              ]}
            />
          );
        })}
      </Section>
    </SettingsPage>
  );
}
