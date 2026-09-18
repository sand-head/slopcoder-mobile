/**
 * One sub-session, live, inside its parent's transcript: who it is, what it is
 * doing, and the last few things it did — prompts it was sent, replies it
 * gave, tools it ran. A sub-session is a whole session, so the card reads the
 * sub-session's own stream through the same hook the cockpit uses; nothing is
 * copied into the parent's scrollback. A tap on the head opens the
 * sub-session's own screen — the full transcript, without a composer.
 */
import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { SessionStatus } from '../api/contracts';
import { buildToolCard } from '../api/toolcard';
import type { Item, SubSessionItem } from '../api/transcript';
import { useAuth } from '../state/auth';
import { useSessionHub } from '../state/hub';
import { useSession } from '../state/session';
import { Body, Dot, Fork, GLYPHS, Meta, Mono, Prose } from './kit';
import { ToolCard } from './ToolCard';
import { font, mix, radius, tintFor, useTheme } from '../theme';

/** How many of the sub-session's latest items the card shows. */
const TAIL_LENGTH = 5;

/** A reply, clipped: the card shows its gist, the screen its whole. */
const REPLY_LIMIT = 500;

/**
 * The last few things worth a line: prompts, replies, tool calls, errors, a
 * pending gate, the plan. Turn notes and resolved gates are the connective
 * tissue the full screen shows.
 */
export function subSessionTail(
  items: readonly Item[],
  length = TAIL_LENGTH,
): Item[] {
  const shown: Item[] = [];
  for (let i = items.length - 1; i >= 0 && shown.length < length; i--) {
    const item = items[i];
    const shows =
      item.kind === 'user' ||
      item.kind === 'text' ||
      item.kind === 'tool' ||
      item.kind === 'error' ||
      item.kind === 'plan' ||
      (item.kind === 'approval' && item.approved === null) ||
      (item.kind === 'question' && !item.resolved);
    if (shows) shown.push(item);
  }
  return shown.reverse();
}

export function SubSessionCard({
  item,
  queued = 0,
  onOpen,
}: {
  item: SubSessionItem;
  /**
   * Messages still waiting in this partner's mailbox. Only the parent knows
   * it — a sub-session cannot see its own queue — so it is passed in. In an
   * asynchronous world it is the answer to "has my last prompt been seen yet".
   */
  queued?: number;
  onOpen: (id: string) => void;
}) {
  const { c, status, isDark } = useTheme();
  const seam = useAuth(s => s.seam);
  const { hub } = useSessionHub();
  const { state, items, error } = useSession(seam, hub, item.subSessionId);

  const tail = useMemo(() => subSessionTail(items), [items]);
  const running = state?.status === SessionStatus.Running;
  const closed = state?.closed === true;
  const waiting =
    (state?.pendingApprovalIds.length ?? 0) +
      (state?.pendingQuestionIds.length ?? 0) >
    0;
  // The partner's own colour, falling back to the generic sub-session accent
  // for one opened before tints existed.
  const tint = tintFor(item.color, isDark) ?? status.subagent;
  const tone = closed
    ? c.mutedForeground
    : waiting
    ? status.running
    : running
    ? tint
    : c.mutedForeground;
  const waitingFor = queued > 0 ? ` · ${queued} queued` : '';
  const label = error
    ? 'gone'
    : closed
    ? 'set aside'
    : waiting
    ? 'waiting for you'
    : running
    ? `working${waitingFor}`
    : state
    ? `idle${waitingFor}`
    : '…';
  // Who this is, and what they are on. The name carries the colour; the beat
  // beside it does not, so the thing that repeats down the transcript is the
  // thing that stands out.
  const who = item.persona || item.name;
  const beat =
    item.persona && item.name && item.name !== item.persona ? item.name : null;

  return (
    <View
      style={{
        marginVertical: 6,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: c.border,
        borderLeftWidth: 3,
        borderLeftColor: closed
          ? mix(c.mutedForeground, 45)
          : mix(tint, running ? 100 : 55),
        backgroundColor: closed ? 'transparent' : mix(c.mutedForeground, 6),
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={() => onOpen(item.subSessionId)}
        accessibilityRole="button"
        accessibilityLabel={`Sub-session ${who}${beat ? `, ${beat}` : ''}, ${
          item.profile
        }, ${label}. Open`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 8,
          paddingHorizontal: 10,
          minHeight: 40,
          backgroundColor: pressed ? mix(c.mutedForeground, 10) : 'transparent',
        })}
      >
        <View style={{ width: 12, alignItems: 'center' }}>
          <Fork color={tint} />
        </View>
        <Body
          numberOfLines={1}
          style={{
            flexShrink: 0,
            fontFamily: font.sansMedium,
            fontSize: 13.5,
            color: tint,
          }}
        >
          {who}
        </Body>
        {beat ? (
          <Body numberOfLines={1} style={{ flexShrink: 1, fontSize: 13.5 }}>
            {beat}
          </Body>
        ) : null}
        <Mono numberOfLines={1} style={{ flex: 1, fontSize: 11 }}>
          {item.profile} · {item.model}
        </Mono>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            flexShrink: 0,
          }}
        >
          <Dot color={tone} filled={running || waiting} size={7} />
          <Mono numberOfLines={1} style={{ fontSize: 11, color: tone }}>
            {label}
          </Mono>
        </View>
        <Mono style={{ fontSize: 12 }}>›</Mono>
      </Pressable>

      {tail.length > 0 ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: mix(c.border, 70),
            paddingHorizontal: 10,
            paddingVertical: 6,
            gap: 4,
          }}
        >
          {tail.map(entry => (
            <TailRow key={entry.key} item={entry} />
          ))}
        </View>
      ) : (
        <Meta style={{ paddingHorizontal: 10, paddingBottom: 8 }}>
          {error
            ? 'This sub-session is no longer available.'
            : state
            ? 'Nothing yet.'
            : 'Loading…'}
        </Meta>
      )}
    </View>
  );
}

/** One line of the tail, in the transcript's vocabulary but shorter. */
function TailRow({ item }: { item: Item }) {
  const { c, status } = useTheme();

  switch (item.kind) {
    case 'user':
      return (
        <View
          style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}
        >
          <Mono style={{ fontSize: 12, color: c.primary }}>▷</Mono>
          <Mono
            numberOfLines={2}
            style={{ flex: 1, fontSize: 12, color: mix(c.foreground, 80) }}
          >
            {item.text}
          </Mono>
        </View>
      );

    case 'text':
      return (
        <Prose>
          {item.text.length > REPLY_LIMIT
            ? `${item.text.slice(0, REPLY_LIMIT)}…`
            : item.text}
        </Prose>
      );

    case 'tool':
      return (
        <ToolCard
          card={buildToolCard(item.name, item.input, item.result, item.isError)}
          state={item.running ? 'running' : item.isError ? 'failed' : 'ok'}
        />
      );

    case 'error':
      return (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Body
            style={{
              color: c.destructive,
              fontFamily: font.mono,
              fontSize: 13,
            }}
          >
            {GLYPHS.error}
          </Body>
          <Body
            numberOfLines={2}
            style={{ flex: 1, fontSize: 12.5, color: c.destructive }}
          >
            {item.message}
          </Body>
        </View>
      );

    case 'approval':
      return (
        <Mono numberOfLines={1} style={{ fontSize: 12, color: status.running }}>
          ! waiting for approval: {item.toolName} — open to decide
        </Mono>
      );

    case 'question':
      return (
        <Mono numberOfLines={1} style={{ fontSize: 12, color: status.running }}>
          ? {item.questions[0]?.text ?? 'asked a question'} — open to answer
        </Mono>
      );

    case 'plan':
      return (
        <Mono numberOfLines={1} style={{ fontSize: 12 }}>
          plan · {item.steps.filter(step => step.status === 'done').length}/
          {item.steps.length} done
        </Mono>
      );

    default:
      return null;
  }
}
