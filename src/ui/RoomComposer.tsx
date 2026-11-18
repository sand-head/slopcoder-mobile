/**
 * The composer a room screen hangs at the foot of its transcript: one rounded
 * Discord-like input — `Message #room` — with an @ affordance and a send.
 *
 * Purely presentational: the screen owns nothing here but the send. The
 * component holds its own draft, busy and error state, and is deliberate about
 * all three. The draft clears only after `onSend` resolves, so a rejection
 * keeps the words where they were; the busy flag owns the send control so a
 * double tap can never post twice.
 *
 * Mentions are the one room-specific behaviour: a room only notifies the
 * agents its message @mentions, so typing `@` offers the room's members as
 * tappable completions, and an @ button beside the input does the same for a
 * thumb. Only the trailing token completes — `@ada` mid-sentence is settled,
 * and swapping it out from under the writer would be a different app.
 */
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { ChatRoomPresence } from '../api/contracts';
import { font, mix, radius, useTheme } from '../theme';
import { Body, Mono, SendButton, StatusDot } from './kit';

/** The `@…` token at the end of a draft, if that is what the draft ends on. */
export interface TrailingMention {
  /** Index of the `@` that opened the token. */
  start: number;
  /** What has been typed after it; '' for a bare `@`. */
  partial: string;
}

/**
 * The trailing mention of `text`, or null when the draft ends on anything
 * else. The `@` must open a word — at the start or after whitespace — so an
 * email address or a path never turns into a suggestion list.
 */
export function trailingMention(text: string): TrailingMention | null {
  const match = /(^|\s)@([a-zA-Z0-9_-]*)$/.exec(text);
  if (!match) return null;
  const partial = match[2];
  return { start: text.length - partial.length - 1, partial };
}

/** `text` with its trailing mention swapped for a completed `@handle `. */
export function completeMention(
  text: string,
  mention: TrailingMention,
  handle: string,
): string {
  return text.slice(0, mention.start) + `@${handle} `;
}

/**
 * Room members a partial mentions: prefix matches first, then substring, the
 * way a mention picker narrows. Capped — the panel floats over the transcript
 * and six rows is the comfortable maximum on a phone.
 */
export function matchingMembers(
  members: readonly ChatRoomPresence[],
  partial: string,
  limit = 6,
): ChatRoomPresence[] {
  const needle = partial.toLowerCase();
  const rank = (handle: string) => {
    const at = handle.toLowerCase();
    if (at.startsWith(needle)) return 0;
    return at.includes(needle) ? 1 : -1;
  };
  return members
    .map(member => ({ member, rank: rank(member.handle) }))
    .filter(entry => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.member.handle.localeCompare(b.member.handle))
    .map(entry => entry.member)
    .slice(0, limit);
}

export interface RoomComposerProps {
  roomName: string;
  members: readonly ChatRoomPresence[];
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
}

export function RoomComposer({ roomName, members, onSend, disabled }: RoomComposerProps) {
  const { c } = useTheme();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mention = trailingMention(draft);
  const suggestions = mention ? matchingMembers(members, mention.partial) : [];

  const send = async () => {
    const text = draft;
    if (busy || disabled || text.trim().length === 0) return;
    setBusy(true);
    try {
      await onSend(text);
      // Only a delivered message clears the box; a rejection keeps it.
      setDraft('');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const insertMention = () => {
    setDraft(current => (trailingMention(current) ? current : `${current}@`));
  };

  const inputLabel = `Message #${roomName}`;

  return (
    <View style={{ gap: 6 }}>
      {suggestions.length > 0 && mention ? (
        <View
          style={{
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.card,
            overflow: 'hidden',
          }}>
          {suggestions.map((member, index) => (
            <Pressable
              key={member.sessionId}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${member.handle}`}
              onPress={() => setDraft(current => {
                const at = trailingMention(current);
                return at ? completeMention(current, at, member.handle) : current;
              })}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 10,
                paddingVertical: 8,
                minHeight: 36,
                backgroundColor: pressed ? mix(c.mutedForeground, 10) : 'transparent',
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: c.border,
              })}>
              <StatusDot running={member.state === 'running'} />
              <Body numberOfLines={1} style={{ fontSize: 13.5, maxWidth: '55%' }}>
                {member.sessionTitle}
              </Body>
              <Mono numberOfLines={1} style={{ flex: 1 }}>
                @{member.handle}
              </Mono>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 8,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: c.input,
          backgroundColor: c.card,
          paddingLeft: 6,
          paddingRight: 8,
          paddingVertical: 6,
        }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mention an agent"
          accessibilityHint="Inserts @ and offers the room's members."
          onPress={insertMention}
          disabled={disabled}
          style={({ pressed }) => ({
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: mix(c.mutedForeground, pressed ? 22 : 10),
          })}>
          <Text style={{ fontFamily: font.mono, fontSize: 16, color: c.mutedForeground }}>
            @
          </Text>
        </Pressable>

        <TextInput
          value={draft}
          onChangeText={text => {
            setDraft(text);
            // Editing after a failure is a new attempt; the old refusal is stale.
            setError(null);
          }}
          placeholder={inputLabel}
          placeholderTextColor={c.mutedForeground}
          multiline
          editable={!disabled && !busy}
          accessibilityLabel={inputLabel}
          style={{
            flex: 1,
            minHeight: 32,
            maxHeight: 120,
            paddingVertical: 6,
            fontFamily: font.sans,
            fontSize: 15,
            color: c.foreground,
          }}
        />

        <SendButton
          mode="send"
          onPress={() => void send()}
          disabled={disabled || draft.trim().length === 0}
          busy={busy}
          accessibilityLabel="Send message"
        />
      </View>

      {error ? (
        <Mono numberOfLines={2} style={{ color: c.destructive }}>
          {error}
        </Mono>
      ) : null}
    </View>
  );
}
