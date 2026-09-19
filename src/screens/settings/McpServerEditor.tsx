/**
 * Add or edit one MCP server: a form presented as a sheet, Cancel on the
 * left, Add or Save on the right. One screen for both routes — an edit is
 * the same form with its fields already answered, and with its secrets
 * blank, because stored values never come back across the seam.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { McpTransportKind, type McpServerSummary } from '../../api/contracts';
import { parseSecrets, splitLines } from '../../api/settings';
import { useAuth } from '../../state/auth';
import { Hint, Screen } from '../../ui/kit';
import { SheetSegments } from '../../ui/Sheet';
import { BarText, CodeBox, FormField, Problem, SwitchRow } from '../../ui/settings';
import { ConnectionBanner } from '../../ui/ConnectionBanner';
import { useHeaderInset } from '../../navigation/headers';
import { tapConfirm, tapError, tapSelect } from '../../ui/haptics';
import { View } from 'react-native';
import { KEYBOARD_GAP } from '../../ui/keyboard';

const ARGS_PLACEHOLDER = '-y\n@modelcontextprotocol/server-filesystem\n/workspace';

export function McpServerEditorScreen({ route, navigation }: { route: any; navigation: any }) {
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const seam = useAuth(s => s.seam);

  const server: McpServerSummary | undefined = route.params?.server;
  const creating = server === undefined;

  const [name, setName] = useState(server?.displayName ?? '');
  const [kind, setKind] = useState<McpTransportKind>(server?.kind ?? McpTransportKind.Stdio);
  const [command, setCommand] = useState(server?.command ?? '');
  const [args, setArgs] = useState(server?.args.join('\n') ?? '');
  const [url, setUrl] = useState(server?.url ?? '');
  const [secrets, setSecrets] = useState('');
  const [clearSecrets, setClearSecrets] = useState(false);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leaving = useRef(false);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  const ready = name.trim().length > 0 && !saving;
  const save = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const cancel = () => navigation.goBack();
    const confirm = () => save.current();
    const confirmLabel = creating ? 'Add server' : 'Save changes';
    navigation.setOptions({
      title: creating ? 'Add an MCP server' : `Edit "${server.displayName}"`,
      headerLeft: () => (Platform.OS === 'ios' ? null : <BarText label="Cancel" onPress={cancel} />),
      headerRight: () => (Platform.OS === 'ios' ? null : <BarText label={confirmLabel} onPress={confirm} disabled={!ready} />),
      unstable_headerLeftItems: () => [{ type: 'button', label: 'Cancel', onPress: cancel }],
      unstable_headerRightItems: () => [
        { type: 'button', label: confirmLabel, variant: 'done', onPress: confirm, disabled: !ready },
      ],
    });
  }, [navigation, creating, server, ready]);

  // A swipe down or Cancel with unsaved changes asks first; the platform's
  // ordinary question, since nothing is lost until the form is saved.
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e: any) => {
      if (!dirty || leaving.current) return;
      e.preventDefault();
      Alert.alert('Discard changes?', undefined, [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            leaving.current = true;
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
  }, [navigation, dirty]);

  save.current = () => {
    void (async () => {
      if (!seam || saving) return;
      const parsed = parseSecrets(secrets);
      if (parsed.error) {
        tapError();
        setError(parsed.error);
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const request = {
          displayName: name.trim(),
          kind,
          command: command.trim(),
          args: splitLines(args),
          url: kind === McpTransportKind.Http ? url.trim() || null : null,
          // Null keeps the stored cipher: the form never round-trips values.
          secrets: creating ? parsed.secrets : clearSecrets || Object.keys(parsed.secrets).length > 0 ? parsed.secrets : null,
        };
        const problem = creating
          ? (await seam.createMcpServer(request)).error
          : await seam.updateMcpServer(server.id, request);
        if (problem) {
          tapError();
          setError(problem);
          return;
        }
        tapConfirm();
        leaving.current = true;
        navigation.goBack();
      } catch (e) {
        tapError();
        setError(e instanceof Error && e.name !== 'SeamError' ? e.message : 'The server could not be reached. Nothing was saved.');
      } finally {
        setSaving(false);
      }
    })();
  };

  const stdio = kind === McpTransportKind.Stdio;

  return (
    <Screen>
      <View pointerEvents="box-none" style={{ position: 'absolute', top: headerInset, left: 0, right: 0, zIndex: 1 }}>
        <ConnectionBanner />
      </View>

      <KeyboardAwareScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 18 }}
        keyboardShouldPersistTaps="handled"
        // Scrolls the field being typed in clear of the keyboard, and only
        // when the keyboard would actually cover it — see ui/keyboard.ts for
        // what the prop this replaced did instead. Layout mode keeps the
        // scroll view unwrapped, where the large title can find it.
        bottomOffset={KEYBOARD_GAP}
        mode="layout"
        keyboardDismissMode="interactive">
        {error ? <Problem>{error}</Problem> : null}

        <FormField label="name" value={name} onChangeText={touch(setName)} placeholder="github" accessibilityLabel="Name" editable={!saving} />

        <SheetSegments
          label="transport"
          options={[
            { key: 'stdio', label: 'stdio · in the sandbox' },
            { key: 'http', label: 'HTTP · remote' },
          ]}
          selected={stdio ? 'stdio' : 'http'}
          onSelect={key => {
            tapSelect();
            touch(setKind)(key === 'stdio' ? McpTransportKind.Stdio : McpTransportKind.Http);
          }}
        />

        {stdio ? (
          <>
            <FormField label="command" value={command} onChangeText={touch(setCommand)} placeholder="npx" accessibilityLabel="Command" editable={!saving} />
            <CodeBox
              label="arguments (one per line)"
              value={args}
              onChangeText={touch(setArgs)}
              placeholder={ARGS_PLACEHOLDER}
              minHeight={90}
              editable={!saving}
              accessibilityLabel="Arguments"
            />
          </>
        ) : (
          <FormField
            label="url"
            value={url}
            onChangeText={touch(setUrl)}
            placeholder="https://mcp.example.com/sse"
            keyboardType="url"
            accessibilityLabel="URL"
            editable={!saving}
          />
        )}

        <CodeBox
          label={stdio ? 'environment variables (KEY=value per line)' : 'headers (Name=value per line)'}
          value={secrets}
          onChangeText={touch(setSecrets)}
          placeholder="API_TOKEN=…"
          minHeight={90}
          editable={!saving}
          accessibilityLabel="Secrets"
          hint={
            !creating && server.hasSecrets ? (
              <View style={{ gap: 8 }}>
                <Hint>Stored values are never shown. Leave empty to keep them, or enter new ones to replace them.</Hint>
                <SwitchRow label="Clear stored values" value={clearSecrets} onChange={touch(setClearSecrets)} disabled={saving} />
              </View>
            ) : undefined
          }
        />
      </KeyboardAwareScrollView>
    </Screen>
  );
}
