/**
 * Add a key-based provider: a name, a key, and for the API kinds a base URL.
 *
 * A form sheet, as the platform presents one: Cancel on the left, "Validate
 * & add" on the right. The key is validated by the server against the
 * provider before it is stored, so the error that comes back is the
 * provider's, worded by the server; this screen only refuses an empty form.
 * The Codex sign-in is not here — it is a flow, not a form.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProviderKind } from '../../api/contracts';
import { MODEL_CATALOG_PLACEHOLDER, PROVIDER_PRESETS, providerForm } from '../../api/settings';
import { useAuth } from '../../state/auth';
import { Body, Button, Hint, Mono, Screen } from '../../ui/kit';
import { Sheet, SheetGroup } from '../../ui/Sheet';
import { BarText, ChoiceRow, CodeBox, FormField, Problem } from '../../ui/settings';
import { ConnectionBanner } from '../../ui/ConnectionBanner';
import { useHeaderInset } from '../../navigation/headers';
import { tapConfirm, tapError } from '../../ui/haptics';
import { useTheme } from '../../theme';
import { KEYBOARD_GAP } from '../../ui/keyboard';

export function ProviderEditorScreen({ route, navigation }: { route: any; navigation: any }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const seam = useAuth(s => s.seam);

  const kind: ProviderKind = route.params?.kind ?? ProviderKind.Anthropic;
  const words = providerForm(kind);

  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [preset, setPreset] = useState('');
  const [presetSheet, setPresetSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The catalog box stays hidden until asked for — most endpoints list their
  // own models, and a JSON textarea over the key field is noise until it isn't.
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalog, setCatalog] = useState('');
  const leaving = useRef(false);

  const compatible = kind === ProviderKind.OpenAICompatible;
  const dirty = name.length > 0 || key.length > 0 || baseUrl.length > 0 || catalog.length > 0;
  const presetHint = PROVIDER_PRESETS.find(p => p.name === preset)?.hint;

  const submit = useRef<() => void>(() => {});
  submit.current = () => {
    void (async () => {
      if (!seam || busy) return;
      if (name.trim().length === 0 || key.trim().length === 0) {
        tapError();
        setError(kind === ProviderKind.ClaudeCode ? 'A name and the setup token are both required.' : 'A name and an API key are both required.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await seam.createConnection({
          kind,
          displayName: name.trim(),
          apiKey: key.trim(),
          baseUrl: baseUrl.trim().length > 0 ? baseUrl.trim() : null,
          // Only sent when the user filled it; absent is the default path.
          modelCatalogJson: compatible && catalog.trim().length > 0 ? catalog : null,
        });
        if (result.id === null) {
          tapError();
          setError(result.error ?? 'The server refused that connection.');
          // The endpoint answered but won't enumerate its models. That is
          // fixable right here, so open the box rather than leave a dead end.
          if (result.needsModelCatalog) {
            setCatalogOpen(true);
            setError(`${result.error ?? ''}\n\nPaste a model catalog below and try again.`.trim());
          }
          return;
        }
        tapConfirm();
        leaving.current = true;
        navigation.goBack();
      } catch (e) {
        tapError();
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  useLayoutEffect(() => {
    const cancel = () => navigation.goBack();
    const confirm = () => submit.current();
    const label = busy ? 'Validating…' : 'Validate & add';
    navigation.setOptions({
      title: words.title,
      headerLeft: () => (Platform.OS === 'ios' ? null : <BarText label="Cancel" onPress={cancel} />),
      headerRight: () => (Platform.OS === 'ios' ? null : <BarText label={label} onPress={confirm} disabled={busy} />),
      unstable_headerLeftItems: () => [{ type: 'button', label: 'Cancel', onPress: cancel }],
      unstable_headerRightItems: () => [{ type: 'button', label, variant: 'done', onPress: confirm, disabled: busy }],
    });
  }, [navigation, words.title, busy]);

  // A swipe down or Cancel with something typed asks first: a pasted key is
  // not something anyone wants to find again.
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e: any) => {
      if (!dirty || leaving.current) return;
      e.preventDefault();
      Alert.alert('Discard this connection?', undefined, [
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
        <Hint>{words.description}</Hint>
        {error ? <Problem>{error}</Problem> : null}

        {kind === ProviderKind.OpenAICompatible ? (
          <ChoiceRow
            label="preset"
            value={preset || 'none'}
            onPress={() => setPresetSheet(true)}
            disabled={busy}
            hint={presetHint ?? 'Optional — pick a service to prefill name and base URL.'}
          />
        ) : null}

        {kind === ProviderKind.ClaudeCode ? (
          <View style={{ gap: 6 }}>
            <Mono style={{ color: c.foreground }}>1. On a machine with a browser and Claude Code installed, run `claude setup-token`.</Mono>
            <Mono style={{ color: c.foreground }}>2. Sign in to your Claude plan when it opens the browser.</Mono>
            <Mono style={{ color: c.foreground }}>3. Paste the printed token below. It lasts a year and only authorizes model requests.</Mono>
            <Hint>
              This is for your own plan in your own slopcoder. Anthropic does not allow offering claude.ai login or subscription
              rate limits to other people through a third-party app, so don't share a Claude Code connection across users.
            </Hint>
          </View>
        ) : null}

        <FormField label="name" value={name} onChangeText={setName} placeholder={words.namePlaceholder} autoCapitalize="words" editable={!busy} accessibilityLabel="Name" />

        <FormField
          label={words.keyLabel.toLowerCase()}
          value={key}
          onChangeText={setKey}
          placeholder={words.keyPlaceholder}
          secure
          mono
          editable={!busy}
          accessibilityLabel={words.keyLabel}
        />

        {words.baseUrlLabel ? (
          <FormField
            label={words.baseUrlLabel.toLowerCase()}
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder={words.baseUrlPlaceholder}
            keyboardType="url"
            mono
            editable={!busy}
            accessibilityLabel="Base URL"
          />
        ) : null}

        {/* The Codex models.json shape, for an endpoint that won't answer
            GET /models. Hidden until asked for: most endpoints list their own,
            and a JSON textarea over the key field is noise until it isn't. */}
        {compatible ? (
          catalogOpen ? (
            <CodeBox
              label="model catalog"
              value={catalog}
              onChangeText={setCatalog}
              placeholder={MODEL_CATALOG_PLACEHOLDER}
              editable={!busy}
              accessibilityLabel="Model catalog"
              hint="The Codex models.json shape: a models array of entries with a slug, and optionally display_name, context_window and supported_reasoning_levels. slopcoder lists these instead of asking the endpoint."
            />
          ) : (
            <Button label="this endpoint doesn't list its models" variant="ghost" disabled={busy} onPress={() => setCatalogOpen(true)} />
          )
        ) : null}

        {busy ? <Body style={{ fontSize: 13 }}>Validating…</Body> : null}
      </KeyboardAwareScrollView>

      <Sheet visible={presetSheet} title="Preset" onClose={() => setPresetSheet(false)}>
        <SheetGroup
          options={PROVIDER_PRESETS.map(p => ({ key: p.name, label: p.name, description: p.baseUrl }))}
          selected={preset}
          onSelect={picked => {
            const found = PROVIDER_PRESETS.find(p => p.name === picked);
            if (found) {
              setPreset(found.name);
              setName(found.name);
              setBaseUrl(found.baseUrl);
            }
            setPresetSheet(false);
          }}
        />
      </Sheet>
    </Screen>
  );
}
