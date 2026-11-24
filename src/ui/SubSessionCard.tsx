/**
 * One sub-session, live, inside its parent's transcript: who it is, what it is
 * doing, and the last few things it did — prompts it was sent, replies it
 * gave, tools it ran. A sub-session is a whole session, so the card reads the
 * sub-session's own stream through the same hook the cockpit uses; nothing is
 * copied into the parent's scrollback. A tap on the head opens the
 * sub-session's own screen — the full transcript, without a composer.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { SessionStatus } from '../api/contracts';
import { buildToolCard } from '../api/toolcard';
import type { Item, SubSessionItem } from '../api/transcript';
import { useAuth } from '../state/auth';
import { useSessionHub } from '../state/hub';
import { useSession } from '../state/session';
import { Body, Chevron, Dot, Fork, GLYPHS, Meta, Mono, Prose } from './kit';
import { ToolCard } from './ToolCard';
import { font, mix, radius, reading, tintFor, useTheme } from '../theme';
import { ago } from '../api/captions';

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
  spent = 0,
  cost = null,
  onOpen,
}: {
  item: SubSessionItem;
  /**
   * Messages still waiting in this partner's mailbox. Only the parent knows
   * it — a sub-session cannot see its own queue — so it is passed in. In an
   * asynchronous world it is the answer to "has my last prompt been seen yet".
   */
  queued?: number;
  /**
   * What this partner has cost so far, from the parent's roster. Shown because
   * a team is easy to forget about and each member spends on its own clock;
   * absent (0) on a server that does not report it yet.
   */
  spent?: number;
  cost?: number | null;
  onOpen: (id: string) => void;
}) {
  const { c, status, isDark } = useTheme();
  const seam = useAuth(s => s.seam);
  const { hub } = useSessionHub();
  const { state, items, error } = useSession(seam, hub, item.subSessionId);

  const [expanded, setExpanded] = useState(true);
  // Only use prompts actually loaded from the child's stream; old pages may not be resident.
  const prompt = useMemo(() => items.find(entry => entry.kind === 'user'), [items]);
  const tail = useMemo(() => subSessionTail(items.filter(entry => entry.key !== prompt?.key)), [items, prompt]);
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
  // The web's status words: "idle · 1d ago" says how stale an idle partner
  // is; nothing at all while the state is still loading.
  const label = error
    ? 'gone'
    : closed
    ? 'set aside'
    : waiting
    ? 'waiting for you'
    : running
    ? 'working'
    : state
    ? `idle · ${ago(state.lastActivityAt)}`
    : '';
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
        borderColor: closed ? c.border : mix(tint, 45),
        backgroundColor: closed ? c.card : mix(tint, 5),
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={() => setExpanded(value => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        // The queue and the spend are not drawn — the web's card shows neither
        // (its hover title carries the detail) — but a screen reader still
        // hears them, the nearest thing a phone has to that title.
        accessibilityLabel={`Sub-session ${who}${beat ? `, ${beat}` : ''}, ${
          item.profile
        }, ${item.model}, ${label}${queued > 0 ? `, ${queued} queued` : ''}${
          spent > 0 ? `, ${spend(spent, cost)}` : ''
        }. ${expanded ? 'Collapse' : 'Expand'}`}
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
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 }}>
            <Body style={{ flexShrink: 1, fontSize: 13, lineHeight: 19 }}>
              <Body style={{ fontFamily: font.sansMedium, fontSize: 13, lineHeight: 19, color: tint }}>{who}</Body>
              {beat ? ` · ${beat}` : ''}
            </Body>
          </View>
          <Body style={{ ...reading.summary, color: c.mutedForeground }}>{item.profile} · {item.model}</Body>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            flexShrink: 0,
          }}
        >
          {running || waiting ? <Dot color={tone} filled size={7} /> : null}
          <Body numberOfLines={1} style={{ ...reading.summary, color: running || waiting ? tone : c.mutedForeground }}>
            {label}
          </Body>
        </View>
        <Chevron open={expanded} color={c.mutedForeground} />
      </Pressable>

      {expanded && prompt ? (
        <View style={{ borderTopWidth: 1, borderTopColor: mix(c.border, 70), paddingHorizontal: 10, paddingTop: 8, gap: 3 }}>
          <Body style={{ ...reading.summary, color: c.mutedForeground }}>→ Parent session → {who}</Body>
          <Body selectable style={{ color: c.foreground, fontSize: 13 }}>{prompt.text}</Body>
        </View>
      ) : null}
      {expanded ? (tail.length > 0 ? (
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
            <TailRow key={entry.key} item={entry} recipient={who} />
          ))}
        </View>
      ) : !prompt ? (
        <Meta style={{ paddingHorizontal: 10, paddingBottom: 8 }}>
          {error
            ? 'This sub-session is no longer available.'
            : state
            ? 'Nothing yet.'
            : 'Loading…'}
        </Meta>
      ) : null) : null}
      <Pressable onPress={() => onOpen(item.subSessionId)} accessibilityRole="button"
          accessibilityLabel={`Open ${who} activity`} hitSlop={4}
          style={{ alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 }}>
          <Body style={{ ...reading.summary, color: c.mutedForeground }}>Open activity ↗</Body>
      </Pressable>
    </View>
  );
}

/**
 * What a partner has cost, rounded hard: this is for noticing a team member
 * running away with the budget, not for accounting.
 */
function spend(tokens: number, cost: number | null): string {
  const figure =
    tokens < 1_000
      ? `${tokens}`
      : tokens < 1_000_000
      ? `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`
      : `${(tokens / 1_000_000).toFixed(1)}M`;
  return cost === null || cost === undefined
    ? `${figure} tok`
    : `${figure} tok ≈ $${cost.toFixed(2)}`;
}

/** One line of the tail, in the transcript's vocabulary but shorter. */
function TailRow({ item, recipient }: { item: Item; recipient: string }) {
  const { c, status } = useTheme();

  switch (item.kind) {
    case 'user':
      return (
        <View style={{ gap: 3 }}>
          <Body style={{ ...reading.summary, color: c.mutedForeground }}>→ Parent session → {recipient}</Body>
          <Body selectable style={{ fontSize: 13, color: c.foreground }}>{item.text}</Body>
        </View>
      );

    case 'text':
      return (
        <Prose size="small">
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
