/**
 * The cockpit: a header, the transcript, and one composer whose button changes
 * meaning with the turn.
 *
 * The approval card is the reason this app exists on a phone. When the harness
 * blocks on a permission, the turn is stopped until someone answers — wherever
 * they are. Liveness comes from `state.pendingApprovalIds`, **never** from the
 * transcript: an approval resolved on the laptop is still in the scrollback here.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import {
  ApprovalMode,
  SessionStatus,
  type FacetOption,
  type ModelCandidate,
  type SubSessionInfo,
  type UserQuestionAnswer,
} from '../api/contracts';
import { buildProposalCard, buildToolCard } from '../api/toolcard';
import type { SubSessionMention } from '../api/mentions';
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
  Prose,
} from '../ui/kit';
import { animateNextLayout } from '../ui/motion';
import { Composer, type TurnOptions } from '../ui/Composer';
import {
  MAX_IMAGES,
  pickImages,
  type ImageSource,
  type PendingImage,
} from '../ui/images';
import { Sheet } from '../ui/Sheet';
import { TerminalSheet } from '../ui/TerminalSheet';
import { useShake } from '../ui/shake';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { ToolCard } from '../ui/ToolCard';
import { SubSessionCard } from '../ui/SubSessionCard';
import { useAtBottom } from '../ui/atBottom';
import { useKeyboardHeight } from '../ui/keyboard';
import { useHeaderInset } from '../navigation/headers';
import { tapConfirm, tapError, tapRefuse } from '../ui/haptics';
import { newTokens } from '../api/contracts';
import { font, mix, radius, tintFor, useTheme } from '../theme';

export function SessionDetailScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
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
  const { state, items, live, loading, error, canLoadEarlier, loadEarlier } =
    useSession(seam, hub, id);

  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
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
  const [terminalOpen, setTerminalOpen] = useState(false);

  // Shake to open the terminal — see ui/shake.ts for why that gesture.
  // Only while this screen is the one on top: a shake on the settings tab
  // should not attach a shell to whatever session was last looked at. And not
  // while the terminal is already up, where a shake is just a shake.
  const focused = useIsFocused();
  useShake(focused && !terminalOpen && !usageOpen, () => {
    tapConfirm();
    setTerminalOpen(true);
  });

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
      void seam.setApprovalMode(id, {
        mode: next.approval,
        useClassifier: true,
      });
    }
    if (next.facet !== previous.facet) {
      void seam.setFacet(id, { facetName: next.facet });
    }
  };

  const running = state?.status === SessionStatus.Running;
  const action = running ? 'Steer' : 'Send';
  // A sub-session's prompts come from the agent that opened it: there is no
  // composer, and the prompts in the transcript are not the user's words.
  const parentDriven = !!state?.parentSessionId;

  const send = async () => {
    if (!seam || !state) return;
    const prompt = draft.trim();
    if (!prompt) return;
    setSending(true);
    try {
      setDraft('');
      tapConfirm();

      // Steering only lands while a turn is in flight; a false means it ended
      // between the render and the tap, so start a new one instead. Steering
      // is text-only, so the images stay put and go with the next real turn.
      if (running && (await seam.steer(id, { prompt }))) return;

      const images = pendingImages.length > 0 ? pendingImages.map(strip) : null;
      setPendingImages([]);
      setImageError(null);
      const started = await seam.start(id, {
        prompt,
        selection: options?.selection ?? {
          auto: state.autoRoute,
          connectionId: state.connectionId ?? null,
          modelId: state.selectedModel ?? null,
        },
        images,
      });
      // A refused start leaves what was typed and attached where it was.
      if (!started) {
        setDraft(prompt);
        setPendingImages(pendingImages);
        tapError();
      }
    } finally {
      setSending(false);
    }
  };

  const pick = async (source: ImageSource) => {
    setImageError(null);
    const result = await pickImages(source, MAX_IMAGES - pendingImages.length);
    if (result.images.length > 0) {
      animateNextLayout();
      setPendingImages(current =>
        [...current, ...result.images].slice(0, MAX_IMAGES),
      );
    }
    setImageError(result.error);
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
      usage.inputTokens +
      usage.cacheReadInputTokens +
      usage.cacheCreationInputTokens;
    return Math.min(
      100,
      Math.round((100 * prompt) / usage.contextWindowTokens),
    );
  }, [state?.lastUsage]);

  const subtitle = [
    parentDriven
      ? state?.closed
        ? 'sub-session · set aside'
        : 'sub-session'
      : null,
    running ? 'running' : 'idle',
    contextPercent === null ? null : `${contextPercent}%`,
    state?.usage.estimatedCost == null
      ? null
      : `$${state.usage.estimatedCost.toFixed(2)}`,
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
          style={({ pressed }) => ({
            alignItems: 'center',
            maxWidth: 240,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Body
            numberOfLines={1}
            style={{ fontFamily: font.sansMedium, fontSize: 15 }}
          >
            {title}
          </Body>
          <Mono numberOfLines={1}>{subtitle}</Mono>
        </Pressable>
      ),
    });
  }, [navigation, title, subtitle]);

  // A gate opening or closing, a question answered: the card changes shape,
  // and the lines below it move rather than jump.
  const pendingCount =
    (state?.pendingApprovalIds.length ?? 0) +
    (state?.pendingQuestionIds.length ?? 0);
  useEffect(() => {
    animateNextLayout();
  }, [pendingCount]);

  // Each subagent's thread folded under its own row, then newest first for
  // the inverted list. `items` only changes identity when the fold changed, so
  // this holds still through a whole streaming turn.
  const reversed = useMemo(() => groupSubagents(items).reverse(), [items]);

  // Everything a row is given, as one object that holds still.
  //
  // Rows are memoized, and a memoized row is only as good as the props handed
  // to it: `pendingApprovalIds` arrives as a fresh array on every push from the
  // hub, and an arrow written in the JSX is a new function on every render.
  // Either one alone would re-render every mounted row for the whole length of
  // a turn, which is the lag this screen had.
  const pendingApprovals = useStableIds(state?.pendingApprovalIds);
  const pendingQuestions = useStableIds(state?.pendingQuestionIds);

  const onOpenSubSession = useCallback(
    (subId: string) => navigation.push('Session', { id: subId }),
    [navigation],
  );
  const onApprove = useCallback(
    (requestId: string, approved: boolean) => {
      if (approved) tapConfirm();
      else tapRefuse();
      void seam?.approve(id, { requestId, approved });
    },
    [seam, id],
  );
  const onAnswer = useCallback(
    (requestId: string, answers: UserQuestionAnswer[] | null) => {
      tapConfirm();
      void seam?.answer(id, { requestId, answers });
    },
    [seam, id],
  );

  const roster = state?.subSessions ?? EMPTY_ROSTER;
  // Built from the transcript's own anchors rather than the live roster, so an
  // old session colours the way it did when it was written — and so the list is
  // stable while a turn streams.
  const mentions = useMemo<readonly SubSessionMention[]>(
    () =>
      items
        .filter(
          (item): item is Extract<Item, { kind: 'subsession' }> =>
            item.kind === 'subsession',
        )
        .filter(item => item.persona.length > 0)
        .map(item => ({ persona: item.persona, color: item.color })),
    [items],
  );
  const handlers = useMemo<RowHandlers>(
    () => ({
      parentDriven,
      roster,
      mentions,
      pendingApprovals,
      pendingQuestions,
      onApprove,
      onAnswer,
      onOpenSubSession,
    }),
    [
      parentDriven,
      roster,
      mentions,
      pendingApprovals,
      pendingQuestions,
      onApprove,
      onAnswer,
      onOpenSubSession,
    ],
  );

  const renderRow = useCallback(
    ({ item }: { item: Row }) => <RowView row={item} handlers={handlers} />,
    [handlers],
  );

  const transcriptStyle = useMemo(
    () => ({
      paddingHorizontal: 16,
      // The composer floats on top, so the transcript scrolls under it rather
      // than stopping short — which is the whole point of a material that
      // refracts what is behind it. Inverted, so the container's top is the
      // visual bottom.
      paddingTop: composerHeight + keyboardHeight + 16,
      paddingBottom: headerInset + 16,
      gap: 4,
    }),
    [composerHeight, keyboardHeight, headerInset],
  );

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        {error ? (
          <View style={{ padding: 20, paddingTop: headerInset + 20 }}>
            <Body
              accessibilityLiveRegion="polite"
              style={{ color: c.destructive }}
            >
              {error}
            </Body>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={reversed}
            inverted
            keyExtractor={keyOf}
            // Dragging the transcript down takes the keyboard with it, as
            // every chat on the platform does.
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={transcriptStyle}
            // How much of a long run is mounted at once. The default window is
            // ten screens either side of the viewport, and a row here is not a
            // row — it is a whole markdown document, a diff, a subagent's
            // folded thread. Four either side is still more than a fast flick
            // covers, and it is the difference between a hundred mounted cells
            // and four hundred. The batch numbers keep the fill from landing in
            // one frame when it does have to happen.
            windowSize={9}
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={50}
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
            renderItem={renderRow}
            // The streaming tail, which in an inverted list is the header.
            ListHeaderComponent={
              live ? (
                <View style={{ gap: 6, paddingTop: 6 }}>
                  {live.thinking ? (
                    <Body
                      style={{
                        fontStyle: 'italic',
                        color: c.mutedForeground,
                        fontSize: 13,
                      }}
                    >
                      {live.thinking}
                    </Body>
                  ) : null}
                  {live.text ? <Prose>{live.text}</Prose> : null}
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
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Jump to the latest"
              onPress={toBottom}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <GlassSurface
                cornerRadius={18}
                style={{
                  width: 36,
                  height: 36,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Body
                  style={{
                    fontFamily: font.mono,
                    fontSize: 15,
                    lineHeight: 17,
                  }}
                >
                  ↓
                </Body>
              </GlassSurface>
            </Pressable>
          </View>
        ) : null}

        {/* Over the transcript, below the bar: the banner is news, not a row. */}
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', top: headerInset, left: 0, right: 0 }}
        >
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
          }}
        >
          {parentDriven ? (
            <SubSessionNote closed={state?.closed === true} />
          ) : (
            <Composer
              value={draft}
              onChangeValue={setDraft}
              placeholder={running ? 'Steer the agent…' : 'Send a message…'}
              action={action}
              onAction={send}
              busy={sending}
              disabled={!draft.trim()}
              images={{
                pending: pendingImages,
                onPick: pick,
                onRemove: key => {
                  animateNextLayout();
                  setPendingImages(current =>
                    current.filter(image => image.key !== key),
                  );
                },
                error: imageError,
              }}
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
          )}
        </View>
      </View>

      <Sheet
        visible={usageOpen}
        title="Session usage"
        onClose={() => setUsageOpen(false)}
      >
        {state ? (
          <>
            <View style={{ gap: 6 }}>
              <Meta>context</Meta>
              {state.lastUsage && state.lastUsage.contextWindowTokens > 0 ? (
                <>
                  <ContextBar percent={contextPercent ?? 0} />
                  <Mono>
                    last request used {contextPercent}% of{' '}
                    {state.lastUsage.contextWindowTokens.toLocaleString()}{' '}
                    tokens
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
              {state.usage.models.length === 0 &&
              state.usage.estimatedCost == null ? (
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
                    }}
                  >
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
                <Mono>
                  estimated cost ${state.usage.estimatedCost.toFixed(2)}
                </Mono>
              ) : null}
            </View>
          </>
        ) : null}
      </Sheet>

      <TerminalSheet
        visible={terminalOpen}
        onClose={() => setTerminalOpen(false)}
        baseUrl={seam?.baseUrl ?? null}
        apiKey={seam?.apiKey ?? null}
        sessionId={id}
      />
    </Screen>
  );
}

/** The ContextRing, unrolled: a phone has the width for a bar and not the ring. */
function ContextBar({ percent }: { percent: number }) {
  const { c, status } = useTheme();
  const tone =
    percent >= 90 ? c.destructive : percent >= 70 ? status.running : status.ok;

  return (
    <View
      style={{
        height: 6,
        borderRadius: 3,
        backgroundColor: mix(c.mutedForeground, 20),
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${Math.min(100, percent)}%`,
          height: 6,
          backgroundColor: tone,
        }}
      />
    </View>
  );
}

/** A stable empty roster, so a session with no partners does not remake the handlers. */
const EMPTY_ROSTER: readonly SubSessionInfo[] = [];

interface RowHandlers {
  /** A sub-session: the prompts are the driving agent's, not the user's. */
  parentDriven: boolean;
  /**
   * This session's partners, live. A sub-session card reads the child's own
   * state for everything except the one thing only the parent knows: how many
   * of the agent's messages are still waiting in that partner's mailbox.
   */
  roster: readonly SubSessionInfo[];
  /** Who the agent may name in its prose, and in what colour. */
  mentions: readonly SubSessionMention[];
  pendingApprovals: readonly string[];
  pendingQuestions: readonly string[];
  onApprove: (requestId: string, approved: boolean) => void;
  onAnswer: (requestId: string, answers: UserQuestionAnswer[] | null) => void;
  onOpenSubSession: (id: string) => void;
}

/**
 * Where the composer would be on a sub-session: the reason there isn't one.
 * The way back to the parent is the bar's own back button — the card that
 * opened this screen is on the parent.
 */
function SubSessionNote({ closed }: { closed: boolean }) {
  const { c, status } = useTheme();
  return (
    <GlassSurface
      cornerRadius={radius.xl}
      style={{ paddingHorizontal: 14, paddingVertical: 12 }}
    >
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <View style={{ width: 12, alignItems: 'center', paddingTop: 3 }}>
          <Fork color={status.subagent} />
        </View>
        <Body style={{ flex: 1, fontSize: 13, color: c.mutedForeground }}>
          This is a sub-session: its prompts come from the agent in its parent
          session
          {closed ? ', which has set it aside for now' : ''}. Watch it work and
          approve what it asks — the conversation is the parent's.
        </Body>
      </View>
    </GlassSurface>
  );
}

/** The list's key, out here so the list is not handed a new one each render. */
function keyOf(row: Row): string {
  return row.key;
}

const NO_IDS: readonly string[] = [];

/**
 * The same array until its contents change.
 *
 * The session state arrives whole off the wire, so its id arrays are new
 * objects on every push even when nobody's approval changed. A memoized row
 * compares by identity and would see every one of those as news.
 */
function useStableIds(ids: readonly string[] | undefined): readonly string[] {
  const held = useRef<readonly string[]>(NO_IDS);
  const next = ids ?? NO_IDS;
  if (
    next.length !== held.current.length ||
    next.some((value, at) => value !== held.current[at])
  ) {
    held.current = next;
  }
  return held.current;
}

/**
 * One row of the transcript, and the reason a long run stays smooth.
 *
 * Memoized on `row` and on the one handlers object, which together is the whole
 * contract: `TranscriptFolder` replaces an item rather than writing through it,
 * so a row's identity changes exactly when the row changed. Without that this
 * memo would be a bug — a tool call's result would land in an item React had no
 * reason to look at again.
 */
const RowView = React.memo(
  ({ row, handlers }: { row: Row; handlers: RowHandlers }) =>
    row.kind === 'subagent' ? (
      <SubagentBlock group={row} handlers={handlers} />
    ) : (
      <TranscriptRow item={row} handlers={handlers} />
    ),
);
RowView.displayName = 'RowView';

/**
 * A subagent's whole thread behind one row, closed by default, as on the web:
 * the fork, its number and task, and on the right what it has come to — or,
 * while it runs, what it is doing. Open, the thread hangs off a rail in the
 * subagent's colour so a nested tool row cannot be mistaken for the main
 * agent's. The row's own status is derived, never carried: a failure wins,
 * then a stop, then a clean finish.
 */
function SubagentBlock({
  group,
  handlers,
}: {
  group: SubagentGroup;
  handlers: RowHandlers;
}) {
  const { c, status } = useTheme();
  const [open, setOpen] = useState(false);

  const state = subagentState(group.items);
  const failure = group.items.find(
    (item): item is Extract<Item, { kind: 'error' }> => item.kind === 'error',
  );
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
        accessibilityLabel={`Subagent ${group.subagentId}, ${
          group.task || 'no task'
        }, ${detail}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 6,
          paddingHorizontal: 6,
          borderRadius: radius.md,
          minHeight: 36,
          backgroundColor: pressed ? mix(c.mutedForeground, 10) : 'transparent',
        })}
      >
        <View style={{ width: 12, alignItems: 'center' }}>
          <Fork color={status.subagent} />
        </View>
        <Body
          style={{
            flexShrink: 0,
            fontFamily: font.monoSemiBold,
            fontSize: 12.5,
          }}
        >
          subagent #{group.subagentId}
        </Body>
        <Mono numberOfLines={1} style={{ flex: 1 }}>
          {[group.model, summarize(group.task)].filter(Boolean).join(' · ')}
        </Mono>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            flexShrink: 1,
          }}
        >
          {state === 'failed' ? (
            <Body
              style={{
                fontFamily: font.mono,
                fontSize: 12,
                color: c.destructive,
              }}
            >
              {GLYPHS.error}
            </Body>
          ) : (
            <Dot color={tone} filled={state !== 'cancelled'} size={7} />
          )}
          <Mono
            numberOfLines={1}
            style={{ fontSize: 11, color: tone, flexShrink: 1 }}
          >
            {detail}
          </Mono>
        </View>
        <Mono style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          &gt;
        </Mono>
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
          }}
        >
          {group.items.length === 0 ? (
            <Mono style={{ paddingVertical: 4 }}>Nothing yet.</Mono>
          ) : (
            group.items.map(item => (
              <TranscriptRow key={item.key} item={item} handlers={handlers} />
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

/** The wire's shape: the chip key stays on the phone. */
function strip({ mediaType, base64Data }: PendingImage) {
  return { mediaType, base64Data };
}

/**
 * The images a prompt carried, in the scrollback. Thumbnails in a row; a tap
 * opens one at the width of the bubble, and another tap folds it back.
 */
function PromptImages({
  images,
}: {
  images: readonly { mediaType: string; base64Data: string }[];
}) {
  const { c } = useTheme();
  const [open, setOpen] = useState<number | null>(null);

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {images.map((image, index) => (
          <Pressable
            key={index}
            onPress={() => {
              animateNextLayout();
              setOpen(open === index ? null : index);
            }}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Attached image ${index + 1} of ${
              images.length
            }`}
            style={{
              width: open === index ? '100%' : 72,
              aspectRatio: open === index ? undefined : 1,
              height: open === index ? 240 : undefined,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: mix(c.primary, 25),
              overflow: 'hidden',
            }}
          >
            <Image
              source={{
                uri: `data:${image.mediaType};base64,${image.base64Data}`,
              }}
              resizeMode={open === index ? 'contain' : 'cover'}
              style={{ width: '100%', height: '100%' }}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const TranscriptRow = React.memo(function Transcript({
  item,
  handlers: {
    parentDriven,
    roster,
    mentions,
    pendingApprovals,
    pendingQuestions,
    onApprove,
    onAnswer,
    onOpenSubSession,
  },
}: {
  item: Item;
  handlers: RowHandlers;
}) {
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
          }}
        >
          <Meta style={{ color: c.primary, fontSize: 10.5 }}>
            {parentDriven
              ? item.steering
                ? 'parent agent · mid-turn'
                : 'parent agent'
              : item.steering
              ? 'you · steering'
              : 'you'}
          </Meta>
          {item.images.length > 0 ? (
            <PromptImages images={item.images} />
          ) : null}
          {item.text ? (
            <Body selectable style={{ fontSize: 14 }}>
              {item.text}
            </Body>
          ) : null}
        </View>
      );

    case 'subsession-reply': {
      // A partner's reply reads the way a prompt does — a card with a name on
      // it — in their colour rather than the user's. Never the 'you' card:
      // nobody typed this. One that arrived mid-turn says so, because the same
      // card inside a turn means something different from one at the top of it:
      // it did not start what follows, it interrupted it.
      const tint = tintFor(item.color, isDark) ?? status.subagent;
      const who = item.persona || item.name;
      return (
        <View
          style={{
            marginVertical: 8,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: mix(tint, 25),
            backgroundColor: mix(tint, isDark ? 8 : 4),
            padding: 12,
            gap: 4,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Fork color={tint} />
            <Meta style={{ color: tint, fontSize: 10.5 }}>
              {who}
              {item.name && item.name !== who ? ` · ${item.name}` : ''}
              {item.isError ? ' · hit an error' : ''}
              {item.interjected ? ' · mid-turn' : ''}
            </Meta>
          </View>
          <Body
            selectable
            style={{
              fontSize: 14,
              color: item.isError ? c.destructive : c.foreground,
            }}
          >
            {item.text}
          </Body>
        </View>
      );
    }

    case 'text':
      // No bubble, no border: assistant prose is the page.
      return <Prose mentions={mentions}>{item.text}</Prose>;

    case 'think':
      return (
        <Collapsible
          mark={
            <Body
              style={{
                fontFamily: font.mono,
                fontSize: 12,
                color: status.thinking,
              }}
            >
              {GLYPHS.thinking}
            </Body>
          }
          name="thinking"
          meta={summarize(item.text)}
          open={open}
          onToggle={() => setOpen(!open)}
        >
          <Body
            selectable
            style={{
              fontStyle: 'italic',
              color: c.mutedForeground,
              fontSize: 12.5,
            }}
          >
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
              plan · {item.steps.filter(s => s.status === 'done').length}/
              {item.steps.length} done
            </Meta>
          </View>
          {item.steps.map((step, index) => (
            <View
              key={index}
              style={{
                flexDirection: 'row',
                gap: 8,
                paddingLeft: 20,
                alignItems: 'center',
              }}
            >
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
                  color:
                    step.status === 'done' ? c.mutedForeground : c.foreground,
                  textDecorationLine:
                    step.status === 'done' ? 'line-through' : 'none',
                }}
              >
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
            backgroundColor: pending
              ? mix(status.running, 6)
              : mix(c.muted, 20),
            padding: 12,
            gap: 8,
          }}
        >
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
            <Body style={{ fontSize: 12.5, color: c.mutedForeground }}>
              {item.reason}
            </Body>
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
            <View
              style={{
                flexDirection: 'row',
                gap: 8,
                justifyContent: 'flex-end',
              }}
            >
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
          }}
        >
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Body
              style={{
                color: c.destructive,
                fontFamily: font.mono,
                fontSize: 14,
              }}
            >
              {GLYPHS.error}
            </Body>
            <Body
              selectable
              style={{ flex: 1, fontSize: 13, color: c.destructive }}
            >
              {item.message}
            </Body>
          </View>
          {item.detail ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                animateNextLayout();
                setOpen(!open);
              }}
            >
              <Meta>{open ? 'hide detail' : 'what the provider said'}</Meta>
            </Pressable>
          ) : null}
          {open && item.detail ? <Pre text={item.detail} error /> : null}
        </View>
      );

    case 'subagent-start':
      // Folded into its SubagentBlock by groupSubagents; nothing stands alone.
      return null;

    case 'subsession': {
      const known = roster.find(sub => sub.id === item.subSessionId);
      return (
        <SubSessionCard
          item={item}
          queued={known?.queued ?? 0}
          spent={known?.newTokens ?? 0}
          cost={known?.cost ?? null}
          onOpen={onOpenSubSession}
        />
      );
    }

    case 'divider':
      return (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 8,
          }}
        >
          <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
          <Meta style={{ fontSize: 10 }}>{item.label}</Meta>
          <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
        </View>
      );

    case 'note':
      return (
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            paddingVertical: 3,
            alignItems: 'center',
          }}
        >
          <View style={{ width: 12, alignItems: 'center' }}>
            <Dot
              color={
                item.tone === 'ok'
                  ? status.ok
                  : item.tone === 'warn'
                  ? status.running
                  : c.mutedForeground
              }
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
});
TranscriptRow.displayName = 'TranscriptRow';

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
  const answerFor = (index: number) =>
    picked[index] ?? (typed[index]?.trim() || undefined);
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
      }}
    >
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
                    borderColor:
                      picked[index] === option ? c.primary : c.border,
                    backgroundColor:
                      picked[index] === option
                        ? mix(c.primary, 8)
                        : 'transparent',
                    borderRadius: radius.md,
                    padding: 10,
                    minHeight: 44,
                    justifyContent: 'center',
                  }}
                >
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
                  placeholder={
                    question.options.length > 0
                      ? 'Or type an answer…'
                      : 'Type an answer…'
                  }
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
        <View
          style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}
        >
          <Button
            label="Dismiss"
            variant="outline"
            onPress={() => onAnswer(null)}
          />
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
        })}
      >
        <View style={{ width: 12, alignItems: 'center' }}>{mark}</View>
        <Body style={{ fontFamily: font.monoSemiBold, fontSize: 12.5 }}>
          {name}
        </Body>
        <Mono numberOfLines={1} style={{ flex: 1 }}>
          {meta}
        </Mono>
      </Pressable>
      {open ? (
        <View style={{ paddingLeft: 24, paddingRight: 4, paddingBottom: 6 }}>
          {children}
        </View>
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
      nestedScrollEnabled
    >
      <Body
        selectable
        style={{
          fontFamily: font.mono,
          fontSize: 11.5,
          lineHeight: 17,
          padding: 8,
          color: error ? c.destructive : c.foreground,
        }}
      >
        {text}
      </Body>
    </ScrollView>
  );
}
