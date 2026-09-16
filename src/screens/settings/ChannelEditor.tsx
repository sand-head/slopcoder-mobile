/**
 * Connect or edit one channel, as a form sheet: Cancel on the left, Connect
 * or Save on the right, the kind's fields down the page.
 *
 * The form is `ChannelForm` from `api/settings.ts`, and what it writes is the
 * same settings blob `Channels.razor` writes — key for key, so a channel set
 * up here reads back identically in a browser. The credential is the one
 * field that never comes back: editing shows a blank "Replace" box, and a
 * blank box on save keeps what is stored.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Alert, Platform, ScrollView, View } from 'react-native';
import { ChannelKind, type ChannelDraft, type ChannelSummary } from '../../api/contracts';
import { CHANNEL_KINDS, channelFormOf, channelSettingsJson, emptyChannelForm, type ChannelForm } from '../../api/settings';
import { useAuth } from '../../state/auth';
import { Hint, Screen } from '../../ui/kit';
import { Sheet, SheetGroup, SheetSegments } from '../../ui/Sheet';
import { BarText, ChoiceRow, FormField, Problem } from '../../ui/settings';
import { ConnectionBanner } from '../../ui/ConnectionBanner';
import { useHeaderInset } from '../../navigation/headers';
import { tapConfirm, tapError, tapSelect } from '../../ui/haptics';

function kindLabel(kind: ChannelKind): string {
  return CHANNEL_KINDS.find(k => k.kind === kind)?.label ?? 'Channel';
}

export function ChannelEditorScreen({ route, navigation }: { route: any; navigation: any }) {
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const seam = useAuth(s => s.seam);

  /** The channel being edited; undefined on a create. */
  const channel: ChannelSummary | undefined = route.params?.channel;
  const creating = channel === undefined;

  const [form, setForm] = useState<ChannelForm>(() => (channel ? channelFormOf(channel) : emptyChannelForm()));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kindSheet, setKindSheet] = useState(false);
  const leaving = useRef(false);

  const patch = useCallback((change: Partial<ChannelForm>) => {
    setForm(current => ({ ...current, ...change }));
    setDirty(true);
  }, []);

  const editing = channel !== undefined;

  // ---- saving ----

  const save = useRef<() => void>(() => {});
  save.current = () => {
    void (async () => {
      if (!seam || saving) return;
      setSaving(true);
      setError(null);
      try {
        const secret = form.secret.trim();
        const draft: ChannelDraft = {
          kind: form.kind,
          displayName: form.displayName.trim(),
          secret: secret.length > 0 ? secret : null,
          settings: channelSettingsJson(form),
          enabled: channel?.enabled ?? true,
        };
        const problem = channel ? await seam.updateChannel(channel.id, draft) : await seam.createChannel(draft);
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

  // ---- the bar ----

  const ready = form.displayName.trim().length > 0 && !saving;

  useLayoutEffect(() => {
    const cancel = () => navigation.goBack();
    const confirm = () => save.current();
    const confirmLabel = creating ? 'Connect' : 'Save changes';
    navigation.setOptions({
      title: creating ? 'Connect a channel' : `Edit '${channel.displayName}'`,
      headerLeft: () => (Platform.OS === 'ios' ? null : <BarText label="Cancel" onPress={cancel} />),
      headerRight: () => (Platform.OS === 'ios' ? null : <BarText label={confirmLabel} onPress={confirm} disabled={!ready} />),
      unstable_headerLeftItems: () => [{ type: 'button', label: 'Cancel', onPress: cancel }],
      unstable_headerRightItems: () => [{ type: 'button', label: confirmLabel, variant: 'done', onPress: confirm, disabled: !ready }],
    });
  }, [navigation, creating, channel, ready]);

  // A swipe down, a Cancel or Android's back with unsaved changes asks first.
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

  // ---- the kind's fields ----

  const keep = editing ? ' Leave empty to keep the stored one.' : '';
  const secretLabel = (what: string) => (editing ? `Replace ${what}` : what[0].toUpperCase() + what.slice(1));

  const fields = (() => {
    switch (form.kind) {
      case ChannelKind.Telegram:
        return (
          <FormField
            label={secretLabel('bot token')}
            value={form.secret}
            onChangeText={secret => patch({ secret })}
            placeholder="123456:ABC-DEF…"
            secure
            editable={!saving}
            hint={`Create a bot with @BotFather, paste the token, then message the bot to get a pairing code.${keep}`}
          />
        );
      case ChannelKind.Email:
        return (
          <>
            <FormField label="SMTP host" value={form.smtpHost} onChangeText={smtpHost => patch({ smtpHost })} placeholder="smtp.gmail.com" keyboardType="url" mono editable={!saving} />
            <FormField label="SMTP port" value={form.smtpPort} onChangeText={smtpPort => patch({ smtpPort })} keyboardType="numbers-and-punctuation" mono editable={!saving} />
            <SheetSegments
              label="SMTP security"
              options={[
                { key: 'starttls', label: 'STARTTLS (587)' },
                { key: 'ssl', label: 'SSL/TLS (465)' },
                { key: 'none', label: 'None' },
              ]}
              selected={form.smtpSecurity}
              onSelect={smtpSecurity => {
                tapSelect();
                patch({ smtpSecurity });
              }}
            />

            <FormField
              label="IMAP host"
              value={form.imapHost}
              onChangeText={imapHost => patch({ imapHost })}
              placeholder="imap.gmail.com"
              keyboardType="url"
              mono
              editable={!saving}
              hint="Use an app password, not your account password. Leave the IMAP host blank for delivery-only — the channel will send notifications and never read the mailbox."
            />
            {form.imapHost.trim().length > 0 ? (
              <>
                <FormField label="IMAP port" value={form.imapPort} onChangeText={imapPort => patch({ imapPort })} keyboardType="numbers-and-punctuation" mono editable={!saving} />
                <SheetSegments
                  label="IMAP security"
                  options={[
                    { key: 'ssl', label: 'SSL/TLS (993)' },
                    { key: 'starttls', label: 'STARTTLS (143)' },
                  ]}
                  selected={form.imapSecurity}
                  onSelect={imapSecurity => {
                    tapSelect();
                    patch({ imapSecurity });
                  }}
                />
                <FormField label="Folder" value={form.folder} onChangeText={folder => patch({ folder })} placeholder="INBOX" mono editable={!saving} />
                <FormField
                  label="Poll every (seconds)"
                  value={form.pollSeconds}
                  onChangeText={pollSeconds => patch({ pollSeconds })}
                  keyboardType="numbers-and-punctuation"
                  mono
                  editable={!saving}
                  hint="At least 30 — a mailbox is not a websocket."
                />
              </>
            ) : null}

            <FormField label="From address" value={form.fromAddress} onChangeText={fromAddress => patch({ fromAddress })} placeholder="assistant@example.com" keyboardType="email-address" mono editable={!saving} />
            <FormField label="From name" value={form.fromName} onChangeText={fromName => patch({ fromName })} placeholder="slopcoder" autoCapitalize="words" editable={!saving} />
            <FormField label="Username" value={form.username} onChangeText={username => patch({ username })} placeholder="same as the from address" keyboardType="email-address" mono editable={!saving} />
            <FormField
              label={secretLabel('password')}
              value={form.secret}
              onChangeText={secret => patch({ secret })}
              placeholder="app password"
              secure
              editable={!saving}
              hint={`Gmail, Fastmail and a self-hosted Dovecot all take an app password here.${keep}`}
            />
            <FormField
              label="Allow from"
              value={form.allowFrom}
              onChangeText={allowFrom => patch({ allowFrom })}
              placeholder="you@example.com, phone@example.com"
              keyboardType="email-address"
              mono
              editable={!saving}
              hint="Addresses you list here are paired without a code. Anyone else who writes in gets a code and nothing else."
            />
          </>
        );
      case ChannelKind.Discord:
      case ChannelKind.Fluxer: {
        const discord = form.kind === ChannelKind.Discord;
        return (
          <>
            <FormField
              label={secretLabel('bot token')}
              value={form.secret}
              onChangeText={secret => patch({ secret })}
              placeholder="paste the bot token"
              secure
              editable={!saving}
              hint={
                (discord
                  ? 'Create an application at discord.com/developers/applications, add a bot, enable the Message Content intent, invite it with the bot and applications.commands scopes, then DM it for a pairing code.'
                  : 'Create an application on your Fluxer instance (fluxer.app unless you self-host) and paste the bot token it hands back, then DM the bot for a pairing code.') + keep
              }
            />
            <FormField
              label="Listen in channels"
              value={form.listenChannelIds}
              onChangeText={listenChannelIds => patch({ listenChannelIds })}
              placeholder="optional — 1234567890, 9876543210"
              keyboardType="numbers-and-punctuation"
              mono
              editable={!saving}
              hint={
                'Server channel ids, comma-separated. DMs always work; a server channel is only read if it is listed here. Turn on Developer Mode to copy a channel id.' +
                (discord
                  ? " Your automations' chat commands are registered as slash commands in the servers listed here: they appear in those servers immediately and in DMs within an hour. Use a bot application that is slopcoder's alone — registering replaces every command that application had."
                  : '')
              }
            />
            <FormField
              label="Deliver to channels"
              value={form.deliverToChannelIds}
              onChangeText={deliverToChannelIds => patch({ deliverToChannelIds })}
              placeholder="optional — 1234567890"
              keyboardType="numbers-and-punctuation"
              mono
              editable={!saving}
              hint="Automation notifications and relayed answers are posted here as well as DM'd to everyone paired."
            />
            {!discord ? (
              <FormField
                label="Instance URL"
                value={form.instance}
                onChangeText={instance => patch({ instance })}
                placeholder="optional — https://fluxer.example"
                keyboardType="url"
                mono
                editable={!saving}
                hint="Your self-hosted instance's web address, e.g. https://fluxer.example — slopcoder reads its /.well-known/fluxer to find the API and gateway. It must be https. Leave empty for fluxer.app."
              />
            ) : null}
          </>
        );
      }
      default:
        return (
          <>
            <FormField label="Server" value={form.server} onChangeText={server => patch({ server })} placeholder="https://ntfy.sh" keyboardType="url" mono editable={!saving} />
            <FormField
              label="Topic"
              value={form.topic}
              onChangeText={topic => patch({ topic })}
              placeholder="slopcoder-a1b2c3"
              mono
              editable={!saving}
              hint="Anyone who knows a topic name can read it — pick an unguessable one."
            />
            <FormField
              label={secretLabel('access token')}
              value={form.secret}
              onChangeText={secret => patch({ secret })}
              placeholder="optional — tk_…"
              secure
              editable={!saving}
              hint={`Only needed for a protected topic.${keep}`}
            />
          </>
        );
    }
  })();

  return (
    <Screen>
      <View pointerEvents="box-none" style={{ position: 'absolute', top: headerInset, left: 0, right: 0, zIndex: 1 }}>
        <ConnectionBanner />
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 18 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive">
        {error ? <Problem>{error}</Problem> : null}

        <ChoiceRow
          label="kind"
          value={kindLabel(form.kind)}
          onPress={() => setKindSheet(true)}
          disabled={editing || saving}
          hint={editing ? 'A channel keeps its kind; connect a new one to change it.' : undefined}
        />

        <FormField
          label="Name"
          value={form.displayName}
          onChangeText={displayName => patch({ displayName })}
          placeholder="phone"
          autoCapitalize="words"
          editable={!saving}
          accessibilityLabel="Name"
        />

        {fields}

        {creating ? <Hint>Nobody reaches the agent until you pair them: an unknown sender gets a code and nothing else.</Hint> : null}
      </ScrollView>

      <Sheet visible={kindSheet} title="Kind" onClose={() => setKindSheet(false)}>
        <SheetGroup
          options={CHANNEL_KINDS.map(k => ({ key: String(k.kind), label: k.label }))}
          selected={String(form.kind)}
          onSelect={key => {
            tapSelect();
            // A new kind is a new form: the fields it had no longer apply, and
            // the defaults the next kind wants (ports, the ntfy server) come back.
            const kind = Number(key) as ChannelKind;
            setForm(current => ({ ...emptyChannelForm(kind), displayName: current.displayName }));
            setDirty(true);
            setKindSheet(false);
          }}
        />
      </Sheet>
    </Screen>
  );
}
