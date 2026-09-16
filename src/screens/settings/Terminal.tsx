/**
 * The in-session terminal's personal defaults: which shell, which tools.
 * Two fields and a Save; the instance defaults sit in the placeholders, which
 * is what a blank field means.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '../../state/auth';
import { Hint } from '../../ui/kit';
import { BarText, FormField, Note, Problem, SettingsPage } from '../../ui/settings';
import { tapConfirm, tapError } from '../../ui/haptics';

export function TerminalScreen({ navigation }: { navigation: any }) {
  const seam = useAuth(s => s.seam);
  const [shell, setShell] = useState('');
  const [packages, setPackages] = useState('');
  const [defaults, setDefaults] = useState({ shell: '', packages: '' });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!seam) return;
    let live = true;
    Promise.all([seam.terminalDefaults(), seam.terminalPrefs()])
      .then(([d, prefs]) => {
        if (!live) return;
        if (d) setDefaults({ shell: d.shell, packages: d.packages });
        setShell(prefs.shell ?? '');
        setPackages(prefs.packages ?? '');
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
    setBusy(true);
    setError(null);
    seam
      .saveTerminalPrefs(packages, shell)
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
      title: 'Terminal',
      headerRight: () => (Platform.OS === 'ios' ? null : <BarText label="Save" onPress={confirm} disabled={!ready} />),
      unstable_headerRightItems: () => [{ type: 'button', label: 'Save', variant: 'done', onPress: confirm, disabled: !ready }],
    });
  }, [navigation, ready]);

  const touch = (set: (v: string) => void) => (value: string) => {
    set(value);
    setDirty(true);
    setSaved(false);
  };

  return (
    <SettingsPage keyboard loading={!loaded && !error}>
      {error ? <Problem>{error}</Problem> : null}
      <Hint>
        Personalize the in-session terminal. The first time a container's terminal opens, slopcoder installs these
        tools and launches your shell. Leave a field blank to use the instance default. Changes apply the next time a
        fresh terminal starts (after the sandbox respawns).
      </Hint>
      <FormField
        label="preferred shell"
        value={shell}
        onChangeText={touch(setShell)}
        placeholder={defaults.shell}
        hint={`e.g. fish, zsh, bash. Falls back to bash when the shell isn't in the image. Default: ${defaults.shell || '—'}.`}
      />
      <FormField
        label="dev tools"
        value={packages}
        onChangeText={touch(setPackages)}
        placeholder={defaults.packages}
        hint={`Space-separated apt packages, installed best-effort on first open. Default: ${defaults.packages || '—'}.`}
      />
      {saved ? <Note ok>saved — applies to the next fresh terminal</Note> : null}
      <Hint>
        A repo can also ship a .slopcoder/terminal-init.sh hook that runs after the tools install — for
        project-specific setup.
      </Hint>
    </SettingsPage>
  );
}
