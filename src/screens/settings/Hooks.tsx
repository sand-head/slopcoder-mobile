/**
 * The two global documents the harness reads on every session: the lifecycle
 * hooks and the permission rules. Each is a row here and a full-screen editor
 * when tapped; the row's second line says what the document holds so a glance
 * answers "do I have any".
 */
import React, { useLayoutEffect } from 'react';
import { checkHooks } from '../../api/settings';
import { useAuth } from '../../state/auth';
import { Hint } from '../../ui/kit';
import { ListRow, Section, SettingsPage, useFocusLoad } from '../../ui/settings';

function describeRules(yaml: string | null): string {
  const lines = (yaml ?? '').split('\n').filter(line => line.trim().length > 0).length;
  return lines === 0 ? 'empty' : `${lines} line${lines === 1 ? '' : 's'}`;
}

export function HooksScreen({ navigation }: { navigation: any }) {
  const seam = useAuth(s => s.seam);
  const docs = useFocusLoad(
    navigation,
    seam ? async () => ({ hooks: await seam.hooks(), permissions: await seam.permissions() }) : null,
  );

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Hooks' });
  }, [navigation]);

  const hooksLine = docs.data ? checkHooks(docs.data.hooks ?? '').message : undefined;

  return (
    <SettingsPage refreshing={docs.refreshing} onRefresh={docs.refresh} error={docs.error} loading={docs.data === null && !docs.error}>
      <Hint>
        Your global lifecycle hooks and permission rules, merged with each repo's own .slopcoder files. Handlers run
        inside the session's sandbox; only rules saved here may allow a tool past the approval gate.
      </Hint>
      <Section label="documents">
        <ListRow
          title="Hooks"
          subtitle={hooksLine ? `hooks.json · ${hooksLine}` : 'hooks.json'}
          chevron
          onPress={() => navigation.navigate('DocEditor', { kind: 'hooks' })}
        />
        <ListRow
          title="Permission rules"
          subtitle={docs.data ? `permissions.yaml · ${describeRules(docs.data.permissions)}` : 'permissions.yaml'}
          chevron
          onPress={() => navigation.navigate('DocEditor', { kind: 'permissions' })}
        />
      </Section>
    </SettingsPage>
  );
}
