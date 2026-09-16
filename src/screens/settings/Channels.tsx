/**
 * Where the assistant can be reached, and reach you — a port of
 * `Settings/Channels.razor`.
 *
 * Each channel is a card: its kind and name up top with the switch that pauses
 * it, the facts the web's definition list shows underneath, then the people
 * paired to it and the code field that pairs one more. The bot token and the
 * mail password are write-only: a card says whether one is set, never what it
 * is. Edit and delete live behind the card's `…` and nowhere else, and the form
 * itself is a sheet over this page.
 */
import React, { useCallback, useLayoutEffect, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { ChannelKind, type ChannelSummary } from '../../api/contracts';
import { channelFacts, channelLabel, channelPairs } from '../../api/settings';
import { useAuth } from '../../state/auth';
import { Body, Button, Card, Field, Hint, Meta, Mono } from '../../ui/kit';
import { BarText, Empty, Problem, RowMenuButton, SettingsPage, Tag, useFocusLoad } from '../../ui/settings';
import { barButton } from '../../navigation/headers';
import { tapConfirm, tapError, tapRefuse, tapSuccess } from '../../ui/haptics';
import { font, mix, useTheme } from '../../theme';

/** "17:24" — when the newest pending code was issued. */
function clock(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function ChannelsScreen({ navigation }: { navigation: any }) {
  const seam = useAuth(s => s.seam);
  const load = useCallback(() => (seam ? seam.channels() : Promise.resolve([] as ChannelSummary[])), [seam]);
  const { data, error, refreshing, reload, refresh } = useFocusLoad(navigation, seam ? load : null);
  const [busy, setBusy] = useState(false);

  const add = useCallback(() => navigation.navigate('ChannelEditor'), [navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      ...barButton({ label: 'Connect a channel', symbol: 'plus', onPress: add }, ({ onPress }) => (
        <BarText label="Add" onPress={onPress} />
      )),
    });
  }, [navigation, add]);

  /**
   * Every command answers a sentence when it refused, and nothing when it
   * worked. The card reloads either way: a failed test still updates the
   * channel's last error, and that is worth showing.
   */
  const run = async (command: () => Promise<string | null>, done?: string) => {
    if (!seam || busy) return;
    setBusy(true);
    try {
      const problem = await command();
      if (problem) {
        tapError();
        Alert.alert('That did not work', problem);
      } else if (done) {
        tapSuccess();
        Alert.alert(done);
      }
      await reload();
    } catch (e) {
      tapError();
      Alert.alert('Could not reach slopcoder', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (channel: ChannelSummary) =>
    Alert.alert(
      'Delete this channel?',
      `“${channel.displayName}” stops receiving and its credential is forgotten. The conversation it fed stays in your session list.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            tapRefuse();
            void run(async () => ((await seam!.deleteChannel(channel.id)) ? null : 'That channel is already gone.'));
          },
        },
      ],
    );

  return (
    <SettingsPage refreshing={refreshing} onRefresh={refresh} error={error} loading={data === null && !error}>
      <Hint>
        Where your assistant can be reached, and reach you. Discord, Fluxer and Telegram bots are two-way: paired
        people talk to one ongoing conversation, in DMs and in the server channels you list, and its answers,
        approvals and questions come back to them. Email is the same conversation over SMTP and IMAP, in whatever
        mail app you already use. ntfy is delivery only — a topic for automation notifications. Nobody reaches the
        agent until you pair them: an unknown sender gets a code and nothing else.
      </Hint>

      {(data ?? []).map(channel => (
        <ChannelCard
          key={channel.id}
          channel={channel}
          busy={busy}
          onToggle={on => void run(() => seam!.setChannelEnabled(channel.id, on))}
          onTest={() => void run(() => seam!.testChannel(channel.id), 'Test message sent.')}
          onEdit={() => navigation.navigate('ChannelEditor', { channel })}
          onDelete={() => confirmDelete(channel)}
          onUnpair={peer => void run(() => seam!.unpairChannel(channel.id, peer))}
          onPair={code => {
            if (code.trim().length === 0) {
              Alert.alert('Enter the code the bot sent you.');
              return Promise.resolve(false);
            }
            return (async () => {
              let paired = false;
              await run(async () => {
                const problem = await seam!.pairChannel(channel.id, code.trim());
                paired = problem === null;
                return problem;
              });
              if (paired) tapConfirm();
              return paired;
            })();
          }}
        />
      ))}

      {data && data.length === 0 ? <Empty>No channels connected yet.</Empty> : null}
    </SettingsPage>
  );
}

function ChannelCard({
  channel,
  busy,
  onToggle,
  onTest,
  onEdit,
  onDelete,
  onUnpair,
  onPair,
}: {
  channel: ChannelSummary;
  busy: boolean;
  onToggle: (on: boolean) => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUnpair: (peer: string) => void;
  /** Resolves true when the code took, so the field can clear itself. */
  onPair: (code: string) => Promise<boolean>;
}) {
  const { c } = useTheme();
  const [code, setCode] = useState('');
  const pairs = channelPairs(channel.kind);
  const pending = channel.pendingPairings;

  return (
    <Card style={{ gap: 12, opacity: channel.enabled ? 1 : 0.7 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Tag>{channelLabel(channel.kind)}</Tag>
        <Body numberOfLines={1} style={{ flex: 1, fontFamily: font.sansMedium, fontSize: 15 }}>
          {channel.displayName}
        </Body>
        <Switch
          value={channel.enabled}
          disabled={busy}
          accessibilityLabel={`${channel.displayName} enabled`}
          onValueChange={onToggle}
          trackColor={{ true: c.primary, false: mix(c.mutedForeground, 30) }}
        />
        <RowMenuButton
          title={channel.displayName}
          items={[
            { key: 'test', title: 'Send test', symbol: 'paperplane', onPress: onTest },
            { key: 'edit', title: 'Edit', symbol: 'pencil', onPress: onEdit },
            { key: 'delete', title: 'Delete', symbol: 'trash', destructive: true, onPress: onDelete },
          ]}
        />
      </View>

      {!channel.hasSecret ? <Mono style={{ color: c.destructive }}>no credential set</Mono> : null}

      <View style={{ gap: 4 }}>
        {channelFacts(channel).map(fact => (
          <View key={fact.label} style={{ flexDirection: 'row', gap: 10, alignItems: 'baseline' }}>
            <Meta style={{ width: 84 }}>{fact.label}</Meta>
            {fact.mono ? (
              <Mono numberOfLines={1} style={{ flex: 1, color: c.foreground }}>
                {fact.value}
              </Mono>
            ) : (
              <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5 }}>
                {fact.value}
              </Body>
            )}
          </View>
        ))}
      </View>

      {channel.lastError ? <Problem>{channel.lastError}</Problem> : null}

      {channel.pairedPeers.length > 0 ? (
        <View style={{ gap: 2 }}>
          <Meta>paired</Meta>
          {channel.pairedPeers.map(peer => (
            <View key={peer} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 }}>
              <Mono numberOfLines={1} selectable style={{ flex: 1, color: c.foreground }}>
                {peer}
              </Mono>
              <Button
                label="Unpair"
                variant="link-destructive"
                disabled={busy}
                accessibilityLabel={`Unpair ${peer}`}
                onPress={() => onUnpair(peer)}
              />
            </View>
          ))}
        </View>
      ) : null}

      {pairs ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Field
              value={code}
              onChangeText={setCode}
              placeholder="pairing code"
              keyboardType="numbers-and-punctuation"
              returnKeyType="done"
              accessibilityLabel={`Pairing code for ${channel.displayName}`}
              onSubmitEditing={() => void onPair(code).then(ok => ok && setCode(''))}
              style={{ flex: 1 }}
            />
            <Button
              label="Pair"
              disabled={busy}
              accessibilityLabel={`Pair with ${channel.displayName}`}
              onPress={() => void onPair(code).then(ok => ok && setCode(''))}
            />
          </View>
          <Mono>
            {pending.length > 0
              ? `${pending.length} code(s) waiting, newest issued ${clock(pending[0].issuedAt)}`
              : channel.kind === ChannelKind.Email
                ? 'Write to the mailbox to get a code.'
                : 'Message the bot to get a code.'}
          </Mono>
        </View>
      ) : null}
    </Card>
  );
}
