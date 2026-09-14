/**
 * One tool call, rendered from its {@link ToolCard}.
 *
 * This file knows about blocks and nothing about tools. Every "what does
 * edit_file mean" decision lives in `buildToolCard`; teaching the transcript a
 * new tool must never come back here.
 *
 * The density rule is the card's own: the header line always shows, then any
 * block that asked to be open — diffs and failures, nothing else — and the rest
 * waits behind the chevron. A card with no open block therefore renders as the
 * one-line row the transcript had before cards existed, which is what keeps a
 * forty-call turn scrollable on a phone.
 *
 * Every mark here is ASCII (`+`, `-`, `>`) or drawn in {@link kit}. Geist Mono
 * ships without dingbats and React Native has no CSS fallback stack, so a `✓`
 * typed into this file would render as nothing at all — silently, and only on a
 * device. `__tests__/glyphs.test.ts` scans for it.
 */
import React, { useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, View } from 'react-native';
import type { DiffLine, ToolBlock, ToolCard as Card } from '../api/toolcard';
import { Body, Diamond, Dot, GLYPHS, Meta, Mono } from './kit';
import { font, mix, radius, useTheme } from '../theme';

/**
 * Which mark the card wears. Four states rather than two flags because the
 * fourth one is real and different: a call waiting for approval has not run, has
 * not failed and is not running — it is a proposal, and a tick would say the
 * opposite of what is true.
 */
export type ToolCardState = 'running' | 'ok' | 'failed' | 'pending';

/** Diff lines shown before "show the rest" — enough for a real edit, short enough to scroll past. */
const DIFF_PREVIEW = 12;

export function ToolCard({
  card,
  state,
  forceOpen = false,
}: {
  card: Card;
  state: ToolCardState;
  /** Held open from outside; approvals use it so the call being gated is fully visible. */
  forceOpen?: boolean;
}) {
  const { c } = useTheme();
  const [tapped, setTapped] = useState(false);
  const expanded = tapped || forceOpen;

  const hidden = card.blocks.some(b => !b.open);
  const shown = card.blocks.filter(b => expanded || b.open);
  const failed = state === 'failed';

  const head = <Head card={card} state={state} expanded={expanded} hasChevron={hidden} />;

  return (
    <View
      style={
        shown.length > 0
          ? {
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: failed ? mix(c.destructive, 30) : c.border,
              backgroundColor: failed ? mix(c.destructive, 4) : mix(c.muted, 40),
              paddingBottom: 6,
            }
          : undefined
      }>
      {hidden ? (
        <Pressable
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setTapped(!tapped);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${card.verb} ${card.subject ?? ''}`.trim()}
          style={({ pressed }) => ({
            borderRadius: radius.md,
            backgroundColor: pressed ? mix(c.mutedForeground, 10) : 'transparent',
          })}>
          {head}
        </Pressable>
      ) : (
        head
      )}

      {shown.length > 0 ? (
        <View style={{ gap: 6, paddingHorizontal: 8 }}>
          {shown.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Head({
  card,
  state,
  expanded,
  hasChevron,
}: {
  card: Card;
  state: ToolCardState;
  expanded: boolean;
  hasChevron: boolean;
}) {
  const { c } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 34,
        paddingVertical: 5,
        paddingHorizontal: 6,
      }}>
      <View style={{ width: 12, alignItems: 'center' }}>
        <Mark state={state} />
      </View>

      <Body numberOfLines={1} style={{ flexShrink: 0, fontFamily: font.monoSemiBold, fontSize: 12.5 }}>
        {card.verb}
      </Body>

      {card.subject ? (
        <Mono
          numberOfLines={1}
          // A path is worth more from its tail than its head, so it truncates at
          // the front. RN gives us head/middle/tail directly; the web has to
          // reverse a box to get the same thing.
          ellipsizeMode={card.subjectStyle === 'path' ? 'head' : 'tail'}
          style={{ flexShrink: 1, color: c.foreground }}>
          {card.subject}
        </Mono>
      ) : null}

      {/* Chips give way before the verb and the subject do, and the row clips
          rather than spilling past the card's edge. */}
      <View style={{ flexDirection: 'row', gap: 4, flexShrink: 8, overflow: 'hidden' }}>
        {card.facets.map((facet, index) => (
          <Facet key={index} text={facet} />
        ))}
      </View>

      <View style={{ flex: 1, minWidth: 0 }} />

      {hasChevron ? (
        <Mono style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}>&gt;</Mono>
      ) : null}
    </View>
  );
}

function Mark({ state }: { state: ToolCardState }) {
  const { c, status } = useTheme();
  if (state === 'failed')
    return (
      <Body style={{ fontFamily: font.mono, fontSize: 13, color: c.destructive }}>{GLYPHS.error}</Body>
    );
  if (state === 'pending') return <Diamond color={status.running} />;
  return <Dot color={state === 'running' ? status.running : status.ok} size={8} />;
}

/** Counts earn colour; everything else is a neutral chip. */
function Facet({ text }: { text: string }) {
  const { c, status } = useTheme();
  const added = text.startsWith('+');
  const bad = text.startsWith('-') || (text.startsWith('exit ') && text !== 'exit 0');

  return (
    <View
      style={{
        borderRadius: radius.sm - 2,
        paddingHorizontal: 4,
        paddingVertical: 1,
        backgroundColor: added
          ? mix(status.ok, 16)
          : bad
            ? mix(c.destructive, 14)
            : mix(c.mutedForeground, 14),
      }}>
      <Mono style={{ fontSize: 10.5, color: added ? status.ok : bad ? c.destructive : c.mutedForeground }}>
        {text}
      </Mono>
    </View>
  );
}

function Block({ block }: { block: ToolBlock }) {
  const { c } = useTheme();

  const label =
    block.label != null && block.label.length > 0 ? <Meta style={{ fontSize: 10 }}>{block.label}</Meta> : null;

  switch (block.type) {
    case 'diff':
      return (
        <View style={{ gap: 3 }}>
          {label}
          <Diff lines={block.lines} />
        </View>
      );

    case 'code':
      return (
        <View style={{ gap: 3 }}>
          {label}
          {/* Output keeps its columns: wrapping a stack trace destroys the only
              structure it has, so this scrolls sideways instead. */}
          <Surface>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Body style={mono(c.foreground)}>{block.text}</Body>
            </ScrollView>
          </Surface>
        </View>
      );

    case 'text':
      return (
        <View style={{ gap: 3 }}>
          {label}
          <Surface error={block.tone === 'error'}>
            <Body
              style={{
                ...mono(block.tone === 'error' ? c.destructive : c.foreground),
                ...(block.tone === 'muted' ? { color: c.mutedForeground } : null),
              }}>
              {block.text}
            </Body>
          </Surface>
        </View>
      );

    case 'list':
      return (
        <View style={{ gap: 3 }}>
          {label}
          <View style={{ gap: 1 }}>
            {block.entries.map((entry, index) => (
              <View key={index} style={{ flexDirection: 'row', gap: 8 }}>
                <Mono style={{ color: c.foreground, flexShrink: 0 }}>{entry.text}</Mono>
                {entry.detail ? (
                  <Mono numberOfLines={1} style={{ flexShrink: 1 }}>
                    {entry.detail}
                  </Mono>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      );

    case 'pairs':
      return (
        <View style={{ gap: 3 }}>
          {label}
          <View style={{ gap: 2 }}>
            {block.pairs.map((pair, index) => (
              <View key={index} style={{ flexDirection: 'row', gap: 8 }}>
                <Mono style={{ flexShrink: 0, minWidth: 68 }}>{pair.key}</Mono>
                <Body style={{ flex: 1, fontSize: 12.5 }}>{pair.value}</Body>
              </View>
            ))}
          </View>
        </View>
      );
  }
}

function Diff({ lines }: { lines: DiffLine[] }) {
  const { c } = useTheme();
  const [full, setFull] = useState(false);
  const shown = full ? lines : lines.slice(0, DIFF_PREVIEW);
  const numbered = lines.some(l => l.oldNumber !== null || l.newNumber !== null);

  return (
    <View style={{ gap: 4 }}>
      <View
        style={{
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: mix(c.muted, 30),
          overflow: 'hidden',
        }}>
        {/* minWidth so a tinted row is a band across the card rather than a
            smear that stops at the end of its text. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ minWidth: '100%' }}>
          <View style={{ flex: 1 }}>
            {shown.map((line, index) => (
              <DiffRow key={index} line={line} numbered={numbered} />
            ))}
          </View>
        </ScrollView>
      </View>

      {lines.length > DIFF_PREVIEW && !full ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setFull(true);
          }}
          hitSlop={8}>
          <Mono>show {lines.length - DIFF_PREVIEW} more lines</Mono>
        </Pressable>
      ) : null}
    </View>
  );
}

function DiffRow({ line, numbered }: { line: DiffLine; numbered: boolean }) {
  const { c, status } = useTheme();

  const added = line.kind === 'add';
  const removed = line.kind === 'remove';
  const hunk = line.kind === 'hunk';

  const color = added ? status.ok : removed ? c.destructive : hunk ? c.mutedForeground : c.foreground;

  return (
    <View
      style={{
        flexDirection: 'row',
        paddingRight: 8,
        backgroundColor: added ? mix(status.ok, 10) : removed ? mix(c.destructive, 10) : 'transparent',
      }}>
      {numbered ? (
        <Mono style={{ width: 34, paddingLeft: 4, textAlign: 'right', fontSize: 11 }}>
          {(added ? line.newNumber : line.oldNumber) ?? ''}
        </Mono>
      ) : null}

      {/* The mark is drawn as well as coloured — colour alone leaves the diff
          unreadable to a reader who cannot separate the two. */}
      <Body style={{ ...mono(color), width: 14, paddingLeft: 4 }}>
        {added ? '+' : removed ? '-' : ' '}
      </Body>
      <Body style={mono(color)}>{line.text}</Body>
    </View>
  );
}

/**
 * The bordered ground a text or code block sits on. Scrolls vertically rather
 * than growing without limit: one 4000-line command output must not push the
 * rest of the turn off the end of the transcript.
 */
function Surface({ children, error }: { children: React.ReactNode; error?: boolean }) {
  const { c } = useTheme();
  return (
    <ScrollView
      nestedScrollEnabled
      style={{
        maxHeight: 260,
        borderWidth: 1,
        borderColor: error ? mix(c.destructive, 30) : c.border,
        backgroundColor: error ? mix(c.destructive, 5) : mix(c.muted, 30),
        borderRadius: radius.md,
      }}
      contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 6 }}>
      {children}
    </ScrollView>
  );
}

function mono(color: string) {
  return { fontFamily: font.mono, fontSize: 11.5, lineHeight: 17, color } as const;
}
