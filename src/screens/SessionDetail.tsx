/**
 * The cockpit: a header, the transcript, and one composer whose button changes
 * meaning with the turn.
 *
 * The approval card is the reason this app exists on a phone. When the harness
 * blocks on a permission, the turn is stopped until someone answers — wherever
 * they are. Liveness comes from `state.pendingApprovalIds`, **never** from the
 * transcript: an approval resolved on the laptop is still in the scrollback here.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Markdown from '@ronradtke/react-native-markdown-display';
import {
  ApprovalMode,
  SessionStatus,
  type FacetOption,
  type ModelCandidate,
  type UserQuestionAnswer,
} from '../api/contracts';
import { buildProposalCard, buildToolCard } from '../api/toolcard';
import {
  groupSubagents,
  subagentDetail,
  subagentState,
  summarize,
  type Item,
  type Row,
  type SubagentGroup,
} from '../api/transcript';
import { useAuth } from '../state/auth';
import { useSessionHub } from '../state/hub';
import { useSession } from '../state/session';
import {
  Bars,
  Body,
  Button,
  Dot,
  Field,
  Fork,
  GLYPHS,
  GlassSurface,
  HalfDot,
  Meta,
  Mono,
  Screen,
  markdownStyles,
} from '../ui/kit';
import { animateNextLayout } from '../ui/motion';
import { Composer, type TurnOptions } from '../ui/Composer';
import { Sheet } from '../ui/Sheet';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { ToolCard } from '../ui/ToolCard';
import { useAtBottom } from '../ui/atBottom';
import { useKeyboardHeight } from '../ui/keyboard';
import { useHeaderInset } from '../navigation/headers';
import { tapConfirm, tapRefuse } from '../ui/haptics';
import { newTokens } from '../api/contracts';
import { font, mix, radius, useTheme } from '../theme';

export function SessionDetailScreen({ route, navigation }: { route: any; navigation: any }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const id: string = route.params.id;

  // The bar is transparent and this screen runs up under it, so the
  // transcript's visual top and the banner both start below it.
  const headerInset = useHeaderInset();

  // The composer clears the home indicator when the keyboard is down, and
  // sits straight on the keyboard when it is up — the inset is the phone's
  // bottom edge, and with the keyboard there the bottom edge is the keyboard.
  const keyboardHeight = useKeyboardHeight();
  const keyboardUp = keyboardHeight > 0;

  const seam = useAuth(s => s.seam);
  const { hub } = useSessionHub();
  const { state, items, live, loading, error, canLoadEarlier, loadEarlier } = useSession(
    seam,
    hub,
    id,
  );

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<ModelCandidate[]>([]);
  const [facets, setFacets] = useState<FacetOption[]>([]);
  const [options, setOptions] = useState<TurnOptions | null>(null);
  // Measured, not guessed: the composer grows with the text and with however
  // many dials are off default, and the transcript has to clear whatever it is.
  const [composerHeight, setComposerHeight] = useState(96);
  const listRef = useRef<FlatList<Row>>(null);

  // The list is inverted: index 0 is the newest line, and the platform keeps
  // it in view as lines arrive. This only says whether the reader is there.
  const { pinned, toBottom, props: bottom } = useAtBottom(listRef);
  const [usageOpen, setUsageOpen] = useState(false);

  useEffect(() => {
    if (!seam) return;
    void Promise.all([seam.models(), seam.facets()]).then(([m, f]) => {
      setModels(m);
      setFacets(f);
    });
  }, [seam]);

  // Seeded from the session, then owned here: the model rides on the next
  // turn's selection, while thinking, approvals and facet are session state the
  // server keeps, so changing those writes through immediately.
  useEffect(() => {
    if (!state || options !== null) return;
    setOptions({
      selection: {
        auto: state.autoRoute,
        connectionId: state.connectionId ?? null,
        modelId: state.selectedModel ?? null,
      },
      thinking: state.thinkingLevel ?? null,
      approval: state.approvalMode,
      facet: state.facetName ?? null,
    });
  }, [state, options]);

  const applyOptions = (next: TurnOptions) => {
    const previous = options;
    setOptions(next);
    if (!seam || !previous) return;

    if (next.thinking !== previous.thinking) {
      void seam.setThinking(id, { level: next.thinking });
    }
    if (next.approval !== previous.approval) {
      void seam.setApprovalMode(id, { mode: next.approval, useClassifier: true });
    }
    if (next.facet !== previous.facet) {
      void seam.setFacet(id, { facetName: next.facet });
    }
  };

  const running = state?.status === SessionStatus.Running;
  const action = running ? 'Steer' : 'Send';

  const send = async () => {
    if (!seam || !state) return;
    const prompt = draft.trim();
    if (!prompt) return;
    setSending(true);
    try {
      setDraft('');
      tapConfirm();

      // Steering only lands while a turn is in flight; a false means it ended
      // between the render and the tap, so start a new one instead.
      if (running && (await seam.steer(id, { prompt }))) return;

      await seam.start(id, {
        prompt,
        selection: options?.selection ?? {
          auto: state.autoRoute,
          connectionId: state.connectionId ?? null,
          modelId: state.selectedModel ?? null,
        },
      });
    } finally {
      setSending(false);
    }
  };

  const stop = () => {
    if (!seam) return;
    tapRefuse();
    void seam.stop(id);
  };

  const contextPercent = useMemo(() => {
    const usage = state?.lastUsage;
    if (!usage || usage.contextWindowTokens === 0) return null;
    const prompt =
      usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
    return Math.min(100, Math.round((100 * prompt) / usage.contextWindowTokens));
  }, [state?.lastUsage]);

  const subtitle = [
    running ? 'running' : 'idle',
    contextPercent === null ? null : `${contextPercent}%`,
    state?.usage.estimatedCost == null ? null : `$${state.usage.estimatedCost.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  // The bar is the platform's; the title inside it is ours — the session's
  // name over its status line, and a tap on it opens the usage sheet.
  const title = state?.title ?? 'Session';
  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerTitle: () => (
        <Pressable
          onPress={() => setUsageOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${title}. ${subtitle}. Session usage`}
          style={({ pressed }) => ({ alignItems: 'center', maxWidth: 240, opacity: pressed ? 0.6 : 1 })}>
          <Body numberOfLines={1} style={{ fontFamily: font.sansMedium, fontSize: 15 }}>
            {title}
          </Body>
          <Mono numberOfLines={1}>{subtitle}</Mono>
        </Pressable>
      ),
    });
  }, [navigation, title, subtitle]);

  // A gate opening or closing, a question answered: the card changes shape,
  // and the lines below it move rather than jump.
  const pendingCount = (state?.pendingApprovalIds.length ?? 0) + (state?.pendingQuestionIds.length ?? 0);
  useEffect(() => {
    animateNextLayout();
  }, [pendingCount]);

  // Each subagent's thread folded under its own row, then newest first for
  // the inverted list.
  const reversed = useMemo(() => groupSubagents(items).reverse(), [items]);

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        {error ? (
          <View style={{ padding: 20, paddingTop: headerInset + 20 }}>
            <Body accessibilityLiveRegion="polite" style={{ color: c.destructive }}>
              {error}
            </Body>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={reversed}
            inverted
            keyExtractor={item => item.key}
            // Dragging the transcript down takes the keyboard with it, as
            // every chat on the platform does.
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            // The composer floats on top, so the transcript scrolls under it
            // rather than stopping short — which is the whole point of a
            // material that refracts what is behind it. Inverted, so the
            // container's top is the visual bottom.
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: composerHeight + keyboardHeight + 16,
              paddingBottom: headerInset + 16,
              gap: 4,
            }}
            {...bottom}
            // The visual top: reaching it pulls in earlier scrollback.
            onEndReached={canLoadEarlier ? loadEarlier : undefined}
            onEndReachedThreshold={0.6}
            ListFooterComponent={
              canLoadEarlier || loading ? (
                <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                  <ActivityIndicator color={c.mutedForeground} />
                </View>
              ) : undefined
            }
            renderItem={({ item }) => (
              <RowView
                row={item}
                pendingApprovals={state?.pendingApprovalIds ?? []}
                pendingQuestions={state?.pendingQuestionIds ?? []}
                onApprove={(requestId, approved) => {
                  if (approved) tapConfirm();
                  else tapRefuse();
                  void seam?.approve(id, { requestId, approved });
                }}
                onAnswer={(requestId, answers) => {
                  tapConfirm();
                  void seam?.answer(id, { requestId, answers });
                }}
              />
            )}
            // The streaming tail, which in an inverted list is the header.
            ListHeaderComponent={
              live ? (
                <View style={{ gap: 6, paddingTop: 6 }}>
                  {live.thinking ? (
                    <Body style={{ fontStyle: 'italic', color: c.mutedForeground, fontSize: 13 }}>
                      {live.thinking}
                    </Body>
                  ) : null}
                  {live.text ? (
                    <Markdown style={markdownStyles(c)}>{live.text}</Markdown>
                  ) : null}
                </View>
              ) : undefined
            }
          />
        )}

        {/* Mounted, never faded: the glass is a UIVisualEffectView, and an
            ancestor animating its opacity leaves it drawing nothing at all —
            the arrow floated on its own with no circle behind it. */}
        {!pinned ? (
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: composerHeight + keyboardHeight + 8,
              alignItems: 'center',
            }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Jump to the latest"
              onPress={toBottom}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <GlassSurface
                cornerRadius={18}
                style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                <Body style={{ fontFamily: font.mono, fontSize: 15, lineHeight: 17 }}>↓</Body>
              </GlassSurface>
            </Pressable>
          </View>
        ) : null}

        {/* Over the transcript, below the bar: the banner is news, not a row. */}
        <View pointerEvents="box-none" style={{ position: 'absolute', top: headerInset, left: 0, right: 0 }}>
          <ConnectionBanner />
        </View>

        <View
          onLayout={event => setComposerHeight(event.nativeEvent.layout.height)}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            // Straight on the keyboard: the height is in this style because a
            // parent's padding would not move an absolute child at all.
            bottom: keyboardHeight,
            paddingHorizontal: 10,
            paddingBottom: (keyboardUp ? 0 : insets.bottom) + 10,
            paddingTop: 4,
          }}>
          <Composer
            value={draft}
            onChangeValue={setDraft}
            placeholder={running ? 'Steer the agent…' : 'Send a message…'}
            action={action}
            onAction={send}
            busy={sending}
            disabled={!draft.trim()}
            running={running}
            onStop={stop}
            stopping={state?.stopRequested}
            options={
              options ?? {
                selection: { auto: true, connectionId: null, modelId: null },
                thinking: null,
                approval: ApprovalMode.Dangerous,
                facet: null,
              }
            }
            onChangeOptions={applyOptions}
            models={models}
            facets={facets}
          />
        </View>
      </View>

      <Sheet visible={usageOpen} title="Session usage" onClose={() => setUsageOpen(false)}>
        {state ? (
          <>
            <View style={{ gap: 6 }}>
              <Meta>context</Meta>
              {state.lastUsage && state.lastUsage.contextWindowTokens > 0 ? (
                <>
                  <ContextBar percent={contextPercent ?? 0} />
                  <Mono>
                    last request used {contextPercent}% of{' '}
                    {state.lastUsage.contextWindowTokens.toLocaleString()} tokens
                  </Mono>
                </>
              ) : (
                <Mono>No request yet.</Mono>
              )}
            </View>

            <View style={{ gap: 6 }}>
              <Meta>this session</Meta>
              {/* A cost with no model rows is not "nothing spent" — the two
                  came from the same fold, and saying both is a contradiction. */}
              {state.usage.models.length === 0 && state.usage.estimatedCost == null ? (
                <Mono>Nothing spent yet.</Mono>
              ) : (
                state.usage.models.map(model => (
                  <View
                    key={model.model}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      minHeight: 44,
                      paddingVertical: 8,
                      borderTopWidth: 1,
                      borderTopColor: c.border,
                    }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Body numberOfLines={1} style={{ fontSize: 14 }}>
                        {model.model}
                      </Body>
                      <Mono>{model.completions} calls</Mono>
                    </View>
                    {/* New tokens, not the full footprint: in an agent loop the
                        prefix is re-read every step, so the larger number reads
                        as consumption it is not. */}
                    <Mono style={{ fontSize: 12.5, color: c.foreground }}>
                      {newTokens(model).toLocaleString()}
                    </Mono>
                  </View>
                ))
              )}
              {state.usage.estimatedCost != null ? (
                <Mono>estimated cost ${state.usage.estimatedCost.toFixed(2)}</Mono>
              ) : null}
            </View>
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

/** The ContextRing, unrolled: a phone has the width for a bar and not the ring. */
function ContextBar({ percent }: { percent: number }) {
  const { c, status } = useTheme();
  const tone = percent >= 90 ? c.destructive : percent >= 70 ? status.running : status.ok;

  return (
    <View
      style={{
        height: 6,
        borderRadius: 3,
        backgroundColor: mix(c.mutedForeground, 20),
        overflow: 'hidden',
      }}>
      <View style={{ width: `${Math.min(100, percent)}%`, height: 6, backgroundColor: tone }} />
    </View>
  );
}

interface RowHandlers {
  pendingApprovals: string[];
  pendingQuestions: string[];
  onApprove: (requestId: string, approved: boolean) => void;
  onAnswer: (requestId: string, answers: UserQuestionAnswer[] | null) => void;
}

function RowView({ row, ...handlers }: { row: Row } & RowHandlers) {
  return row.kind === 'subagent' ? (
    <SubagentBlock group={row} {...handlers} />
  ) : (
    <TranscriptRow item={row} {...handlers} />
  );
}

/**
 * A subagent's whole thread behind one row, closed by default, as on the web:
 * the fork, its number and task, and on the right what it has come to — or,
 * while it runs, what it is doing. Open, the thread hangs off a rail in the
 * subagent's colour so a nested tool row cannot be mistaken for the main
 * agent's. The row's own status is derived, never carried: a failure wins,
 * then a stop, then a clean finish.
 */
function SubagentBlock({ group, ...handlers }: { group: SubagentGroup } & RowHandlers) {
  const { c, status } = useTheme();
  const [open, setOpen] = useState(false);

  const state = subagentState(group.items);
  const failure = group.items.find((item): item is Extract<Item, { kind: 'error' }> => item.kind === 'error');
  const detail =
    state === 'failed'
      ? summarize(failure?.message || 'failed', 40)
      : state === 'cancelled'
        ? 'stopped'
        : state === 'done'
          ? 'done'
          : subagentDetail(group.items);
  const tone =
    state === 'failed'
      ? c.destructive
      : state === 'done'
        ? status.ok
        : state === 'cancelled'
          ? c.mutedForeground
          : status.running;

  return (
    <View>
      <Pressable
        onPress={() => {
          animateNextLayout();
          setOpen(!open);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Subagent ${group.subagentId}, ${group.task || 'no task'}, ${detail}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 6,
          paddingHorizontal: 6,
          borderRadius: radius.md,
          minHeight: 36,
          backgroundColor: pressed ? mix(c.mutedForeground, 10) : 'transparent',
        })}>
        <View style={{ width: 12, alignItems: 'center' }}>
          <Fork color={status.subagent} />
        </View>
        <Body style={{ flexShrink: 0, fontFamily: font.monoSemiBold, fontSize: 12.5 }}>
          subagent #{group.subagentId}
        </Body>
        <Mono numberOfLines={1} style={{ flex: 1 }}>
          {[group.model, summarize(group.task)].filter(Boolean).join(' · ')}
        </Mono>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 }}>
          {state === 'failed' ? (
            <Body style={{ fontFamily: font.mono, fontSize: 12, color: c.destructive }}>{GLYPHS.error}</Body>
          ) : (
            <Dot color={tone} filled={state !== 'cancelled'} size={7} />
          )}
          <Mono numberOfLines={1} style={{ fontSize: 11, color: tone, flexShrink: 1 }}>
            {detail}
          </Mono>
        </View>
        <Mono style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>&gt;</Mono>
      </Pressable>

      {open ? (
        <View
          style={{
            marginLeft: 11,
            paddingLeft: 10,
            borderLeftWidth: 2,
            borderLeftColor: mix(status.subagent, 45),
            gap: 4,
            paddingBottom: 4,
          }}>
          {group.items.length === 0 ? (
            <Mono style={{ paddingVertical: 4 }}>Nothing yet.</Mono>
          ) : (
            group.items.map(item => <TranscriptRow key={item.key} item={item} {...handlers} />)
          )}
        </View>
      ) : null}
    </View>
  );
}

function TranscriptRow({
  item,
  pendingApprovals,
  pendingQuestions,
  onApprove,
  onAnswer,
}: { item: Item } & RowHandlers) {
  const { c, status, isDark } = useTheme();
  const [open, setOpen] = useState(false);

  switch (item.kind) {
    case 'user':
      return (
        <View
          style={{
            marginVertical: 8,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: mix(c.primary, 25),
            backgroundColor: mix(c.primary, isDark ? 8 : 4),
            padding: 12,
            gap: 4,
          }}>
          <Meta style={{ color: c.primary, fontSize: 10.5 }}>
            {item.steering ? 'you · steering' : 'you'}
          </Meta>
          <Body style={{ fontSize: 14 }}>{item.text}</Body>
        </View>
      );

    case 'text':
      // No bubble, no border: assistant prose is the page.
      return <Markdown style={markdownStyles(c)}>{item.text}</Markdown>;

    case 'think':
      return (
        <Collapsible
          mark={<Body style={{ fontFamily: font.mono, fontSize: 12, color: status.thinking }}>{GLYPHS.thinking}</Body>}
          name="thinking"
          meta={summarize(item.text)}
          open={open}
          onToggle={() => setOpen(!open)}>
          <Body style={{ fontStyle: 'italic', color: c.mutedForeground, fontSize: 12.5 }}>
            {item.text}
          </Body>
        </Collapsible>
      );

    case 'tool':
      return (
        <ToolCard
          card={buildToolCard(item.name, item.input, item.result, item.isError)}
          state={item.running ? 'running' : item.isError ? 'failed' : 'ok'}
        />
      );

    case 'plan':
      return (
        <View style={{ gap: 4, paddingVertical: 6 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Bars color={status.plan} />
            <Meta>
              plan · {item.steps.filter(s => s.status === 'done').length}/{item.steps.length} done
            </Meta>
          </View>
          {item.steps.map((step, index) => (
            <View key={index} style={{ flexDirection: 'row', gap: 8, paddingLeft: 20, alignItems: 'center' }}>
              <View style={{ width: 10, alignItems: 'center' }}>
                {step.status === 'done' ? (
                  <Dot color={status.ok} size={8} />
                ) : step.status === 'in_progress' ? (
                  <HalfDot color={status.running} size={9} />
                ) : (
                  <Dot color={c.mutedForeground} filled={false} size={8} />
                )}
              </View>
              <Body
                style={{
                  flex: 1,
                  fontSize: 12.5,
                  color: step.status === 'done' ? c.mutedForeground : c.foreground,
                  textDecorationLine: step.status === 'done' ? 'line-through' : 'none',
                }}>
                {step.text}
              </Body>
            </View>
          ))}
        </View>
      );

    case 'approval': {
      // The transcript remembers; only the state knows what is still blocking.
      const pending = pendingApprovals.includes(item.requestId);
      const tint = pending
        ? mix(status.running, 50)
        : item.approved === false
          ? mix(c.destructive, 30)
          : c.border;

      return (
        <View
          style={{
            marginVertical: 8,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: tint,
            backgroundColor: pending ? mix(status.running, 6) : mix(c.muted, 20),
            padding: 12,
            gap: 8,
          }}>
          {/* Only when there is something to say. The card below already names
              the tool, so an open gate needs no line of its own. */}
          {!pending || item.refused ? (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <Meta style={{ fontSize: 10 }}>
                {item.approved === true
                  ? 'approved'
                  : item.approved === false
                    ? 'denied'
                    : !pending
                      ? 'no longer pending'
                      : 'refused'}
              </Meta>
            </View>
          ) : null}

          {/* Never truncated: this is the evidence the decision rests on. */}
          {item.reason ? (
            <Body style={{ fontSize: 12.5, color: c.mutedForeground }}>{item.reason}</Body>
          ) : null}

          {/* Always 'pending', even after a verdict: a cross would say the tool
              failed and a tick would say it succeeded, and this card knows
              neither. The word above is the only thing that speaks to that. */}
          <ToolCard
            card={buildProposalCard(item.toolName, item.input)}
            state="pending"
            forceOpen
          />

          {pending ? (
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
              <Button
                label={item.refused ? 'Keep refused' : 'Deny'}
                variant="outline"
                onPress={() => onApprove(item.requestId, false)}
              />
              <Button
                label={item.refused ? 'Run anyway' : 'Approve'}
                variant={item.refused ? 'destructive' : 'primary'}
                onPress={() => onApprove(item.requestId, true)}
              />
            </View>
          ) : null}
        </View>
      );
    }

    case 'question': {
      const pending = pendingQuestions.includes(item.requestId);
      return (
        <QuestionCard
          item={item}
          pending={pending}
          onAnswer={answers => onAnswer(item.requestId, answers)}
        />
      );
    }

    case 'error':
      return (
        <View
          style={{
            marginVertical: 6,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: mix(c.destructive, 30),
            backgroundColor: mix(c.destructive, 5),
            padding: 10,
            gap: 6,
          }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Body style={{ color: c.destructive, fontFamily: font.mono, fontSize: 14 }}>{GLYPHS.error}</Body>
            <Body style={{ flex: 1, fontSize: 13, color: c.destructive }}>{item.message}</Body>
          </View>
          {item.detail ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                animateNextLayout();
                setOpen(!open);
              }}>
              <Meta>{open ? 'hide detail' : 'what the provider said'}</Meta>
            </Pressable>
          ) : null}
          {open && item.detail ? <Pre text={item.detail} error /> : null}
        </View>
      );

    case 'subagent-start':
      // Folded into its SubagentBlock by groupSubagents; nothing stands alone.
      return null;

    case 'divider':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
          <Meta style={{ fontSize: 10 }}>{item.label}</Meta>
          <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
        </View>
      );

    case 'note':
      return (
        <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 3, alignItems: 'center' }}>
          <View style={{ width: 12, alignItems: 'center' }}>
            <Dot
              color={item.tone === 'ok' ? status.ok : item.tone === 'warn' ? status.running : c.mutedForeground}
              filled={item.tone !== 'muted'}
              size={7}
            />
          </View>
          <Mono style={{ fontSize: 12 }}>{item.text}</Mono>
        </View>
      );

    default:
      return null;
  }
}

function QuestionCard({
  item,
  pending,
  onAnswer,
}: {
  item: Extract<Item, { kind: 'question' }>;
  pending: boolean;
  onAnswer: (answers: UserQuestionAnswer[] | null) => void;
}) {
  const { c } = useTheme();
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [typed, setTyped] = useState<Record<number, string>>({});

  // A typed answer counts once it has words in it; picking an option clears
  // it, and typing clears the pick, so a question has one answer.
  const answerFor = (index: number) => picked[index] ?? (typed[index]?.trim() || undefined);
  const complete = item.questions.every((_, index) => answerFor(index));

  return (
    <View
      style={{
        marginVertical: 8,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: pending ? mix(c.primary, 40) : c.border,
        padding: 12,
        gap: 10,
      }}>
      <Meta>{pending ? 'question' : 'answered'}</Meta>

      {item.questions.map((question, index) => (
        <View key={index} style={{ gap: 6 }}>
          <Body style={{ fontSize: 13.5 }}>{question.text}</Body>
          {pending ? (
            <View style={{ gap: 6 }}>
              {question.options.map(option => (
                <Pressable
                  key={option}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: picked[index] === option }}
                  onPress={() => {
                    setPicked({ ...picked, [index]: option });
                    setTyped({ ...typed, [index]: '' });
                  }}
                  style={{
                    borderWidth: 1,
                    borderColor: picked[index] === option ? c.primary : c.border,
                    backgroundColor: picked[index] === option ? mix(c.primary, 8) : 'transparent',
                    borderRadius: radius.md,
                    padding: 10,
                    minHeight: 44,
                    justifyContent: 'center',
                  }}>
                  <Body style={{ fontSize: 13 }}>{option}</Body>
                </Pressable>
              ))}
              {question.allowFreeText ? (
                <Field
                  value={typed[index] ?? ''}
                  onChangeText={text => {
                    setTyped({ ...typed, [index]: text });
                    if (text.trim() && picked[index]) {
                      const rest = { ...picked };
                      delete rest[index];
                      setPicked(rest);
                    }
                  }}
                  placeholder={question.options.length > 0 ? 'Or type an answer…' : 'Type an answer…'}
                  autoCapitalize="sentences"
                  accessibilityLabel={`Answer to: ${question.text}`}
                />
              ) : null}
            </View>
          ) : (
            <Mono>{item.answers?.[index]?.answer ?? 'dismissed'}</Mono>
          )}
        </View>
      ))}

      {pending ? (
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
          <Button label="Dismiss" variant="outline" onPress={() => onAnswer(null)} />
          <Button
            label="Answer"
            disabled={!complete}
            onPress={() =>
              onAnswer(
                item.questions.map((question, index) => ({
                  question: question.text,
                  answer: answerFor(index)!,
                })),
              )
            }
          />
        </View>
      ) : null}
    </View>
  );
}

function Collapsible({
  mark,
  name,
  meta,
  open,
  onToggle,
  children,
}: {
  mark: React.ReactNode;
  name: string;
  meta: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View>
      <Pressable
        onPress={() => {
          animateNextLayout();
          onToggle();
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 6,
          paddingHorizontal: 6,
          borderRadius: radius.md,
          minHeight: 36,
          backgroundColor: pressed ? mix(c.mutedForeground, 10) : 'transparent',
        })}>
        <View style={{ width: 12, alignItems: 'center' }}>{mark}</View>
        <Body style={{ fontFamily: font.monoSemiBold, fontSize: 12.5 }}>{name}</Body>
        <Mono numberOfLines={1} style={{ flex: 1 }}>
          {meta}
        </Mono>
      </Pressable>
      {open ? (
        <View style={{ paddingLeft: 24, paddingRight: 4, paddingBottom: 6 }}>{children}</View>
      ) : null}
    </View>
  );
}

function Pre({ text, error }: { text: string; error?: boolean }) {
  const { c } = useTheme();
  return (
    <ScrollView
      style={{
        maxHeight: 260,
        borderWidth: 1,
        borderColor: error ? mix(c.destructive, 30) : c.border,
        backgroundColor: error ? mix(c.destructive, 5) : mix(c.muted, 30),
        borderRadius: radius.md,
      }}
      nestedScrollEnabled>
      <Body
        style={{
          fontFamily: font.mono,
          fontSize: 11.5,
          lineHeight: 17,
          padding: 8,
          color: error ? c.destructive : c.foreground,
        }}>
        {text}
      </Body>
    </ScrollView>
  );
}

