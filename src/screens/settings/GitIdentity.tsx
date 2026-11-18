/**
 * The author a user's sessions commit as by default — `Settings/GitIdentity.razor`.
 * Two fields and a Save, the same shape as the Terminal page.
 *
 * Checked here before it is sent (`gitIdentityProblem`, a port of the
 * contract's own check), because the server refuses a bad value with a bare
 * 400 that would otherwise reach the phone as a status code.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { gitIdentityProblems } from '../../api/settings';
import { useAuth } from '../../state/auth';
import { Hint } from '../../ui/kit';
import { BarText, FormField, Note, Problem, SettingsPage } from '../../ui/settings';
import { tapConfirm, tapError } from '../../ui/haptics';

export function GitIdentityScreen({ navigation }: { navigation: any }) {
  const seam = useAuth(s => s.seam);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!seam) return;
    let live = true;
    seam
      .gitIdentity()
      .then(prefs => {
        if (!live) return;
        setName(prefs.name ?? '');
        setEmail(prefs.email ?? '');
        setLoaded(true);
        setError(null);
      })
      .catch(e => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [seam]);

  const save = useRef<() => void>(() => {});
  save.current = () => {
    if (!seam || busy) return;
    const problem = gitIdentityProblems(name, email);
    if (problem) {
      tapError();
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    seam
      .saveGitIdentity(name, email)
      .then(() => {
        tapConfirm();
        setDirty(false);
        setSaved(true);
      })
      .catch(e => {
        tapError();
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
  };

  const ready = loaded && dirty && !busy;

  useLayoutEffect(() => {
    const confirm = () => save.current();
    navigation.setOptions({
      title: 'Git identity',
      headerRight: () => (Platform.OS === 'ios' ? null : <BarText label="Save" onPress={confirm} disabled={!ready} />),
      unstable_headerRightItems: () => [{ type: 'button', label: 'Save', variant: 'done', onPress: confirm, disabled: !ready }],
    });
  }, [navigation, ready]);

  const touch = (set: (v: string) => void) => (value: string) => {
    set(value);
    setDirty(true);
    setSaved(false);
    setError(null);
  };

  return (
    <SettingsPage keyboard loading={!loaded && !error}>
      {error ? <Problem>{error}</Problem> : null}
      <Hint>
        The author your sessions commit as by default. slopcoder writes it into each workspace repo's user.name and
        user.email when the sandbox is provisioned. A value set in a repo by hand (git config user.email …) is never
        replaced. Changes reach existing sessions at their next turn.
      </Hint>
      <FormField
        label="name"
        value={name}
        onChangeText={touch(setName)}
        placeholder="Ada Lovelace"
        autoCapitalize="words"
        editable={!busy}
        accessibilityLabel="Name"
      />
      <FormField
        label="email"
        value={email}
        onChangeText={touch(setEmail)}
        placeholder="ada@example.com"
        keyboardType="email-address"
        mono
        editable={!busy}
        accessibilityLabel="Email"
        hint="Use the address your git host links to your account (or its no-reply address) so commits are attributed to you. Leave both blank to set nothing."
      />
      {saved ? <Note ok>saved — applies from each session's next turn</Note> : null}
    </SettingsPage>
  );
}
