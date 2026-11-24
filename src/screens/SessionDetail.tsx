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
  type SlashCommandInfo,
  type SubSessionInfo,
  type UserQuestionAnswer,
} from '../api/contracts';
import { parseSlashCommand } from '../api/slash';
import { buildProposalCard, buildToolCard } from '../api/toolcard';
import type { SubSessionMention } from '../api/mentions';
import { handleTint } from '../api/sessionIdentity';
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
  stamp,
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
import { useTranscriptServices } from '../ui/transcriptServices';
import { createRowVisibility, RowVisibilityScope } from '../ui/visibility';
import { SubSessionCard } from '../ui/SubSessionCard';
import { useAtBottom } from '../ui/atBottom';
import { ChatSwitcher } from '../ui/ChatSwitcher';
import { OverflowMenu } from '../ui/menu';
import { useChatDirectory } from '../state/chatDirectory';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useKeyboardOffset } from '../ui/keyboard';
import { useHeaderInset } from '../navigation/headers';
import { tapConfirm, tapError, tapRefuse } from '../ui/haptics';
import { newTokens } from '../api/contracts';
import { font, mix, radius, reading, tintFor, useTheme } from '../theme';
import { approvalVerdict, planProgress, thoughtFor, toolRunPhrase, turnCompleteLabel } from '../api/captions';

type WorkspaceRepo = { repo: string; branch?: string | null; detached?: boolean; sandboxDown?: boolean; notARepository?: boolean; error?: string | null };

type ToolRun = { kind: 'tool-run'; key: string; tools: Extract<Item, { kind: 'tool' }>[] };
type DateRow = { kind: 'date-marker'; key: string; at: string };
type DisplayRow = Row | ToolRun | DateRow;

/** Group only known event times in the viewer's local calendar; never invent old dates. */
export function insertDateMarkers(rows: Row[]): (Row | DateRow)[] {
  const result: (Row | DateRow)[] = [];
  let lastDay: string | null = null;
  for (const row of rows) {
    const at = row.kind === 'subagent' ? row.items.find(item => item.at)?.at : row.at;
    if (at) {
      const date = new Date(at);
      if (!Number.isNaN(date.getTime())) {
        const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        if (day !== lastDay) { result.push({ kind: 'date-marker', key: `date:${row.key}`, at }); lastDay = day; }
      }
    }
    result.push(row);
  }
  return result;
}


/** Group adjacent actual calls only; no inferred summaries or counts. */
function groupToolRuns(rows: (Row | DateRow)[]): DisplayRow[] {
  const result: DisplayRow[] = [];
  for (let i = 0; i < rows.length;) {
    if (rows[i].kind !== 'tool') { result.push(rows[i++]); continue; }
    const tools: Extract<Item, { kind: 'tool' }>[] = [];
    while (i < rows.length && rows[i].kind === 'tool') tools.push(rows[i++] as Extract<Item, { kind: 'tool' }>);
    if (tools.length === 1) result.push(tools[0]);
    else result.push({ kind: 'tool-run', key: `tools:${tools[tools.length - 1].key}`, tools });
  }
  return result;
}

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
  // Everything that has to hold still against the keyboard — the transcript,
  // the composer, the jump button — takes this same offset, so they move as
  // one thing on the keyboard's own frames.
  const keyboardOffset = useKeyboardOffset();

  const seam = useAuth(s => s.seam);
  const { hub } = useSessionHub();
  const { state, items, live, loading, error, canLoadEarlier, loadEarlier } =
    useSession(seam, hub, id);

  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [jumpNotice, setJumpNotice] = useState<string | null>(null);
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);
  const [jumpSearching, setJumpSearching] = useState(false);
  const screenId = useRef(id);
  const screenActive = useRef(true);
  const currentState = useRef(state);
  screenId.current = id;
  currentState.current = state;
  useEffect(() => { screenActive.current = true; return () => { screenActive.current = false; }; }, []);
  const [models, setModels] = useState<ModelCandidate[]>([]);
  const [commands, setCommands] = useState<SlashCommandInfo[]>([]);
  const [facets, setFacets] = useState<FacetOption[]>([]);
  const [options, setOptions] = useState<TurnOptions | null>(null);
  // Measured, not guessed: the composer grows with the text and with however
  // many dials are off default, and the transcript has to clear whatever it is.
  const [composerHeight, setComposerHeight] = useState(96);
  const listRef = useRef<FlatList<DisplayRow>>(null);
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpRetries = useRef(0);
  const jumpKey = useRef<string | null>(null);
  const jumpRows = useRef<readonly DisplayRow[]>([]);
  useEffect(() => () => { if (jumpTimer.current) clearTimeout(jumpTimer.current); }, []);

  // The list is inverted: index 0 is the newest line, and the platform keeps
  // it in view as lines arrive. This only says whether the reader is there.
  const { pinned, toBottom, props: bottom } = useAtBottom(listRef);
  const [usageOpen, setUsageOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [repoDetails, setRepoDetails] = useState<WorkspaceRepo[] | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [addingRepo, setAddingRepo] = useState(false);
  const [repoMessage, setRepoMessage] = useState<string | null>(null);
  const [repoRevision, setRepoRevision] = useState(0);
  useEffect(() => {
    if (!contextOpen || !seam) return;
    let active = true;
    setRepoDetails(null);
    setRepoError(null);
    void seam.get<WorkspaceRepo[]>(`api/seam/sessions/${encodeURIComponent(id)}/workspace/changes`)
      .then(rows => { if (active) rows === null ? setRepoError('Workspace is unavailable.') : setRepoDetails(rows); })
      .catch(() => { if (active) setRepoError('Could not load workspace details.'); });
    return () => { active = false; };
  }, [contextOpen, seam, id, repoRevision]);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const directory = useChatDirectory(chatsOpen);

  // Shake to open the terminal — see ui/shake.ts for why that gesture.
  // Only while this screen is the one on top: a shake on the settings tab
  // should not attach a shell to whatever session was last looked at. And not
  // while the terminal is already up, where a shake is just a shake.
  const focused = useIsFocused();
  // Nor on an archived session, whose sandbox never starts again.
  useShake(focused && !terminalOpen && !usageOpen && !state?.archivedAt, () => {
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

  // The commands behind `/`: fetched when the screen opens, so the menu is
  // already there the instant a slash is typed, and again each time the menu
  // opens. Listing walks every repository's `.slopcoder/commands` through the
  // sandbox — which answers with the built-ins alone while the container is
  // still cold, and gains a template the moment one is added — so a list read
  // once at open would be the wrong one for the rest of the session. A failed
  // read keeps whatever we last had rather than emptying the menu.
  const loadCommands = useCallback(() => {
    if (!seam) return;
    seam.slashCommands(id).then(setCommands, () => {});
  }, [seam, id]);

  useEffect(() => {
    loadCommands();
  }, [loadCommands]);

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
  // Archived for going untouched too long: kept for its history and for
  // search, but read-only for good — no turn runs, the sandbox never returns.
  const archived = !!state?.archivedAt;

  const send = async () => {
    if (!seam || !state) return;
    const typed = draft.trim();
    if (!typed) return;
    setSending(true);
    setSendError(null);
    try {
      setDraft('');
      tapConfirm();

      // Slash commands run on the server — they want the sandbox, the facet
      // catalogue and the live model. Most of them answer into the scrollback
      // and there is nothing more to do; a repo template expands to a prompt,
      // which falls through and is sent as if it had been typed.
      let prompt = typed;
      if (parseSlashCommand(prompt)) {
        const result = await seam.runSlashCommand(id, prompt);
        if (!result?.promptToSend) return;
        prompt = result.promptToSend;
      }

      // Steering only lands while a turn is in flight; a false means it ended
      // between the render and the tap, so start a new one instead. Steering
      // is text-only, so the images stay put and go with the next real turn.
      if (running && (await seam.steer(id, { prompt }))) return;

      const images = pendingImages.length > 0 ? pendingImages.map(strip) : null;
      const started = await seam.start(id, {
        prompt,
        selection: options?.selection ?? {
          auto: state.autoRoute,
          connectionId: state.connectionId ?? null,
          modelId: state.selectedModel ?? null,
        },
        images,
      });
      if (!started) throw new Error('The session did not accept the message.');
      // Remove only attachments included in this request, not any picked while
      // it was in flight. Steering above intentionally keeps all images.
      const sentKeys = new Set(pendingImages.map(image => image.key));
      setPendingImages(current => current.filter(image => !sentKeys.has(image.key)));
      setImageError(null);
    } catch (sendFailure) {
      // Never replace text typed while the request was pending. Both the
      // refused message and the newer draft remain editable.
      setDraft(current => current ? `${typed}\n\n${current}` : typed);
      setSendError(sendFailure instanceof Error ? sendFailure.message : 'The message could not be sent.');
      tapError();
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

  // Native stack keeps its back control and platform chrome; the title area
  // follows the approved repository-context-over-session hierarchy.
  const title = state?.title ?? 'Session';
  const repoCount = state?.repoNames.length ?? 0;
  const contextLabel = repoCount === 0 ? 'No repositories' : `${repoCount} ${repoCount === 1 ? 'repository' : 'repositories'}`;
  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerTitle: () => (
        <Pressable onPress={() => setContextOpen(true)} accessibilityRole="button"
          accessibilityLabel={`${contextLabel}. ${title}. ${archived ? 'archived · read-only. ' : ''}Session context`} style={{ flexShrink: 1, maxWidth: '100%' }}>
          <Mono numberOfLines={1} style={{ color: c.mutedForeground }}>{contextLabel} ›</Mono>
          <Body numberOfLines={1} style={{ fontFamily: font.sansMedium, fontSize: 17 }}>{title}</Body>
        </Pressable>
      ),
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <OverflowMenu title="Session options" items={[
            ...(!archived ? [{ key: 'terminal', title: 'Open terminal', symbol: 'terminal', onPress: () => setTerminalOpen(true) }] : []),
            { key: 'sessions', title: 'Switch session', symbol: 'bubble.left.and.bubble.right', onPress: () => setChatsOpen(true) },
            { key: 'usage', title: 'Session usage', symbol: 'chart.bar', onPress: () => setUsageOpen(true) },
          ]}>
            <View accessibilityRole="button" accessibilityLabel="Session options" style={{ width: 36, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Body style={{ color: c.foreground, fontSize: 22 }}>…</Body>
            </View>
          </OverflowMenu>
        </View>
      ),
      unstable_headerRightItems: () => [
        { type: 'menu', label: 'Session options', icon: { type: 'sfSymbol', name: 'ellipsis' }, menu: { items: [
          ...(!archived ? [{ type: 'action', label: 'Open terminal', icon: { type: 'sfSymbol', name: 'terminal' }, onPress: () => setTerminalOpen(true) }] : []),
          { type: 'action', label: 'Switch session', icon: { type: 'sfSymbol', name: 'bubble.left.and.bubble.right' }, onPress: () => setChatsOpen(true) },
          { type: 'action', label: 'Session usage', icon: { type: 'sfSymbol', name: 'chart.bar' }, onPress: () => setUsageOpen(true) },
        ] } },
      ],
    });
  }, [navigation, title, contextLabel, c.mutedForeground, c.foreground, archived]);

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
  const reversed = useMemo(() => groupToolRuns(insertDateMarkers(groupSubagents(items)).reverse()), [items]);
  jumpRows.current = reversed;
  // Only offer a jump when the current server-authoritative request is in the
  // loaded transcript; an old resolved card must never be presented as live.
  const currentRequestIndex = reversed.findIndex(row =>
    row.kind === 'approval' ? (state?.pendingApprovalIds ?? []).includes(row.requestId) :
    row.kind === 'question' ? (state?.pendingQuestionIds ?? []).includes(row.requestId) : false);

  useEffect(() => {
    if (!jumpTarget) return;
    const index = reversed.findIndex(row => row.key === jumpTarget);
    if (index < 0) return;
    const row = reversed[index];
    const latest = currentState.current;
    const pending = row.kind === 'approval' ? latest?.pendingApprovalIds.includes(row.requestId) : row.kind === 'question' ? latest?.pendingQuestionIds.includes(row.requestId) : false;
    if (!pending) { setJumpTarget(null); setJumpNotice('The request is no longer pending.'); return; }
    jumpRetries.current = 0;
    jumpKey.current = jumpTarget;
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    setJumpTarget(null);
  }, [jumpTarget, reversed]);

  const jumpCurrent = async () => {
    if (jumpSearching || !state) return;
    const owner = id;
    const approvals = new Set(state.pendingApprovalIds);
    const questions = new Set(state.pendingQuestionIds);
    const findPending = (rows: readonly Item[]) => rows.find(row =>
      row.kind === 'approval' ? approvals.has(row.requestId) && currentState.current?.pendingApprovalIds.includes(row.requestId) :
      row.kind === 'question' ? questions.has(row.requestId) && currentState.current?.pendingQuestionIds.includes(row.requestId) : false);
    setJumpNotice(null);
    if (currentRequestIndex >= 0) { setJumpTarget(reversed[currentRequestIndex].key); return; }
    if (!canLoadEarlier) { setJumpNotice('Current request was not found in the available transcript.'); return; }
    setJumpSearching(true);
    try {
      for (let page = 0; page < 3; page++) {
        const result = await loadEarlier();
        if (!screenActive.current || screenId.current !== owner) return;
        const latest = currentState.current;
        const stillPending = latest && ([...approvals].some(value => latest.pendingApprovalIds.includes(value)) || [...questions].some(value => latest.pendingQuestionIds.includes(value)));
        if (!stillPending) { setJumpNotice('The request is no longer pending.'); return; }
        if (result.error) { setJumpNotice(`Could not load earlier messages: ${result.error}`); return; }
        if (!result.progress) { setJumpNotice('Could not find the request in earlier messages.'); return; }
        const target = findPending(result.items ?? []);
        if (target) { setJumpTarget(target.key); return; }
        if (!result.hasMore) { setJumpNotice('Current request was not found in the available transcript.'); return; }
      }
      setJumpNotice('Request not found in three earlier pages. Tap status to search further.');
    } finally { if (screenActive.current && screenId.current === owner) setJumpSearching(false); }
  };


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
  const switchSession = useCallback(
    (nextId: string) => {
      setChatsOpen(false);
      if (nextId !== id) navigation.replace('Session', { id: nextId });
    },
    [navigation, id],
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

  // Which rows have been on screen, so media in them loads when seen rather
  // than when mounted (the list mounts four screens either side).
  const visibility = useMemo(() => createRowVisibility(), []);
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: { key: string }[] }) =>
      visibility.show(viewableItems.map(v => v.key)),
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 1, minimumViewTime: 250 }).current;

  const renderRow = useCallback(
    ({ item }: { item: DisplayRow }) => (
      <RowVisibilityScope store={visibility} rowKey={keyOf(item)}>
        <RowView row={item} handlers={handlers} />
      </RowVisibilityScope>
    ),
    [handlers, visibility],
  );

  const transcriptStyle = useMemo(
    () => ({
      paddingHorizontal: reading.column,
      // The composer floats on top, so the transcript scrolls under it rather
      // than stopping short — which is the whole point of a material that
      // refracts what is behind it. Inverted, so the container's top is the
      // visual bottom.
      paddingTop: composerHeight + 16,
      paddingBottom: headerInset + 16,
      gap: 4,
    }),
    [composerHeight, headerInset],
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
          // The list moves with the keyboard rather than being re-padded by
          // it: inverted, it is pinned to its own bottom edge, so a translate
          // carries the newest line up on the keyboard's frames and costs no
          // re-layout of a transcript that can be hundreds of rows long.
          <KeyboardStickyView style={{ flex: 1 }} offset={keyboardOffset}>
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
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              onScrollToIndexFailed={({ index, averageItemLength }) => {
                // Variable-height transcript rows cannot use getItemLayout.
                listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
                if (jumpRetries.current++ < 3) {
                  if (jumpTimer.current) clearTimeout(jumpTimer.current);
                  jumpTimer.current = setTimeout(() => {
                    jumpTimer.current = null;
                    if (!screenActive.current || screenId.current !== id) return;
                    const target = jumpRows.current.findIndex(row => row.key === jumpKey.current);
                    if (target < 0) return;
                    const row = jumpRows.current[target];
                    const latest = currentState.current;
                    const pending = row.kind === 'approval' ? latest?.pendingApprovalIds.includes(row.requestId) : row.kind === 'question' ? latest?.pendingQuestionIds.includes(row.requestId) : false;
                    if (pending) listRef.current?.scrollToIndex({ index: target, animated: true, viewPosition: 0.5 });
                    else setJumpNotice('The request is no longer pending.');
                  }, 200);
                }
              }}
              // The streaming tail, which in an inverted list is the header.
              ListHeaderComponent={
                live ? (
                  <View style={{ gap: 6, paddingTop: 6, marginBottom: 8 }}>
                    {live.thinking ? <LiveThinking text={live.thinking} /> : null}
                    {live.text ? <Prose>{live.text}</Prose> : null}
                  </View>
                ) : undefined
              }
            />
          </KeyboardStickyView>
        )}

        {/* Mounted, never faded: the glass is a UIVisualEffectView, and an
            ancestor animating its opacity leaves it drawing nothing at all —
            the arrow floated on its own with no circle behind it. */}
        {!pinned && (archived || parentDriven) ? (
          <KeyboardStickyView
            pointerEvents="box-none"
            offset={keyboardOffset}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: composerHeight + 8,
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
          </KeyboardStickyView>
        ) : null}

        {/* Over the transcript, below the bar: the banner is news, not a row. */}
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', top: headerInset, left: 0, right: 0 }}
        >
          <ConnectionBanner />
        </View>

        <KeyboardStickyView
          onLayout={event => setComposerHeight(event.nativeEvent.layout.height)}
          offset={keyboardOffset}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: 10,
            // The indicator's strip, which the offset hands back to the
            // keyboard when it is up.
            paddingBottom: insets.bottom + 10,
            paddingTop: 4,
          }}
        >
          {archived ? (
            <ArchivedNote
              at={state?.archivedAt ?? null}
              onNewSession={() => navigation.navigate('Tabs', { screen: 'SessionsTab' })}
            />
          ) : parentDriven ? (
            <SubSessionNote closed={state?.closed === true} />
          ) : (
            <View style={{ gap: 6 }}>
            {sendError ? <Body accessibilityLiveRegion="polite" style={{ color: c.destructive }}>{sendError}</Body> : null}
            {jumpNotice ? <Body accessibilityLiveRegion="polite">{jumpNotice}</Body> : null}
            <Composer
              value={draft}
              onChangeValue={setDraft}
              placeholder={running ? 'Steer this conversation…' : `Message ${title}…`}
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
              sessionStatus={state ? (state.pendingApprovalIds.length ? 'Waiting for permission' : state.pendingQuestionIds.length ? 'Waiting for an answer' : state.stopRequested ? 'Stopping' : running ? 'Running' : 'Idle') : undefined}
              onJumpLatest={!pinned ? toBottom : undefined}
              onJumpStatus={state && (state.pendingApprovalIds.length > 0 || state.pendingQuestionIds.length > 0) && !jumpSearching ? () => void jumpCurrent() : undefined}
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
              routed={
                state?.autoRoute
                  ? { connectionId: state.connectionId, modelId: state.selectedModel }
                  : null
              }
              facets={facets}
              commands={{ list: commands, onNeeded: loadCommands }}
            />
            </View>
          )}
        </KeyboardStickyView>
      </View>

      <Sheet visible={contextOpen} title="Session context" onClose={() => setContextOpen(false)}>
        <View style={{ gap: 12, paddingHorizontal: 16, paddingBottom: 20 }}>
          <Body>{contextLabel}</Body>
          {(state?.repoNames ?? []).map(name => <Mono key={name} selectable>{name}</Mono>)}
          {repoError ? <Body accessibilityLiveRegion="polite">{repoError}</Body> : null}
          {repoDetails === null && !repoError ? <Body>Loading workspace details…</Body> : null}
          {(repoDetails ?? []).map(repo => <View key={repo.repo} style={{ gap: 2 }}>
            <Body selectable>{repo.repo}</Body>
            <Mono selectable>{repo.sandboxDown ? 'Workspace unavailable' : repo.notARepository ? 'Not a repository' : repo.error ? repo.error : repo.branch ? `${repo.detached ? 'Detached · ' : 'Branch · '}${repo.branch}` : 'Branch unknown'}</Mono>
          </View>)}
          {!archived ? <View style={{ gap: 8 }}>
            <Field value={repoUrl} onChangeText={setRepoUrl} autoCapitalize="none" placeholder="Repository URL" accessibilityLabel="Repository URL" />
            <Button label="Add repository" disabled={!repoUrl.trim() || addingRepo} busy={addingRepo} onPress={async () => {
              if (!seam || addingRepo || !repoUrl.trim()) return;
              setAddingRepo(true); setRepoMessage(null);
              try {
                const problem = await seam.addSessionRepository(id, repoUrl.trim());
                if (problem) setRepoMessage(problem);
                else { setRepoUrl(''); setRepoMessage('Repository added.'); setRepoRevision(value => value + 1); }
              } catch (repoFailure) { setRepoMessage(repoFailure instanceof Error ? repoFailure.message : 'Could not add repository.'); }
              finally { setAddingRepo(false); }
            }} />
            {repoMessage ? <Body accessibilityLiveRegion="polite">{repoMessage}</Body> : null}
          </View> : null}
          {state?.chatHandle ? <Mono selectable>Agent: {state.chatHandle}</Mono> : null}
          <Button label="Session usage" variant="ghost" onPress={() => { setContextOpen(false); setUsageOpen(true); }} />
        </View>
      </Sheet>

      <Sheet
        visible={usageOpen}
        title="Session usage"
        onClose={() => setUsageOpen(false)}
      >
        {state ? (
          <>
            <Button
              label="Open reviews"
              variant="ghost"
              onPress={() => {
                setUsageOpen(false);
                navigation.navigate('Reviews', { sessionId: id });
              }}
            />
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

            {state.chatHandle ? (
              <View style={{ gap: 6 }}>
                <Meta>agent handle</Meta>
                <Mono selectable style={{ fontSize: 12.5, color: c.foreground }}>@{state.chatHandle}</Mono>
              </View>
            ) : null}
          </>
        ) : null}
      </Sheet>

      <ChatSwitcher
        visible={chatsOpen}
        onClose={() => setChatsOpen(false)}
        sessions={directory.sessions}
        error={directory.error}
        selectedSessionId={id}
        onOpenSession={switchSession}
      />

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
 * Where the composer would be on an archived session: the reason there isn't
 * one, and the way on — a new session, since this one never runs again.
 */
function ArchivedNote({ at, onNewSession }: { at: string | null; onNewSession: () => void }) {
  const { c } = useTheme();
  return (
    <GlassSurface
      cornerRadius={radius.xl}
      style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 6 }}
    >
      <Body style={{ fontSize: 13, color: c.mutedForeground }}>
        Archived{at ? ` ${stamp(at)}` : ''} after a long stretch without
        activity. It is read-only now — its sandbox won't start again — but it
        stays searchable until you delete it.
      </Body>
      <Button label="Start a new session" variant="ghost" onPress={onNewSession} />
    </GlassSurface>
  );
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
function keyOf(row: DisplayRow): string {
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
  ({ row, handlers }: { row: DisplayRow; handlers: RowHandlers }) =>
    row.kind === 'date-marker' ? (
      <DateMarker at={row.at} />
    ) : row.kind === 'tool-run' ? (
      <ToolRunBlock group={row} handlers={handlers} />
    ) : row.kind === 'subagent' ? (
      <SubagentBlock group={row} handlers={handlers} />
    ) : (
      <TranscriptRow item={row} handlers={handlers} />
    ),
);
RowView.displayName = 'RowView';

/**
 * A message someone else wrote into this transcript — a partner's reply, a
 * direct agent message, a room mention: the web's hairline-topped row with the
 * name on it, not a tinted card. The tint stays on the glyph and the name.
 */
function attributedRow(border: string) {
  return { borderTopWidth: 1, borderTopColor: border, paddingTop: 8, marginTop: 12, marginBottom: 4, gap: 4 } as const;
}

/** The date between turns, in the web's quiet sans and its numeric form. */
function DateMarker({ at }: { at: string }) {
  const { c } = useTheme();
  const when = new Date(at);
  return (
    <View style={{ alignItems: 'center', paddingVertical: 10 }}>
      <Body style={{ ...reading.date, color: c.mutedForeground }}>
        {when.toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' })}{' '}
        {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
      </Body>
    </View>
  );
}

function LiveThinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return <Collapsible chevron="leading" name="Thinking…"
    open={open} onToggle={() => setOpen(!open)}>
    <Body selectable style={{ fontSize: 13 }}>{text}</Body>
  </Collapsible>;
}

function ToolRunBlock({ group, handlers }: { group: ToolRun; handlers: RowHandlers }) {
  const [open, setOpen] = useState(false);
  const { c } = useTheme();
  const running = group.tools.some(tool => tool.running);
  const failed = group.tools.some(tool => tool.isError);
  // The web's sentence for the run, oldest call first: "Read 2 files, edited
  // 2 files, ran 2 commands", with a failure count and a trailing ellipsis
  // while a call is still running. It names what the tools are, never whether
  // tests passed.
  const phrase = toolRunPhrase([...group.tools].reverse());
  return <Collapsible mark={<Dot color={failed ? c.destructive : c.mutedForeground} size={7} />}
    name={`${phrase}${running ? '…' : ''}`} weight="regular" chevron="trailing"
    open={open} onToggle={() => setOpen(!open)}>
    {[...group.tools].reverse().map(tool => <TranscriptRow key={tool.key} item={tool} handlers={handlers} />)}
  </Collapsible>;
}


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
 * opens one full screen, with pinch and double-tap zoom.
 */
function PromptImages({
  images,
}: {
  images: readonly { mediaType: string; base64Data: string }[];
}) {
  const { c } = useTheme();
  const { ImageViewer } = useTranscriptServices();
  const [open, setOpen] = useState<number | null>(null);
  const viewing = open !== null ? images[open] : undefined;

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {images.map((image, index) => (
          <Pressable
            key={index}
            testID="prompt-image"
            onPress={ImageViewer ? () => setOpen(index) : undefined}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Attached image ${index + 1} of ${
              images.length
            }`}
            accessibilityHint="Opens full screen"
            style={{
              width: 72,
              aspectRatio: 1,
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
              resizeMode="cover"
              resizeMethod="resize"
              style={{ width: '100%', height: '100%' }}
            />
          </Pressable>
        ))}
      </View>
      {ImageViewer && viewing && open !== null ? (
        <ImageViewer
          source={{ uri: `data:${viewing.mediaType};base64,${viewing.base64Data}` }}
          label={`Attached image ${open + 1} of ${images.length}`}
          onClose={() => setOpen(null)}
        />
      ) : null}
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
        <View style={{ alignItems: 'flex-end', marginVertical: 12 }}>
          <View
            style={{
              maxWidth: '93%',
              borderRadius: 18,
              borderBottomRightRadius: 4,
              backgroundColor: c.userBubble,
              paddingHorizontal: 15,
              paddingVertical: 13,
              gap: 6,
            }}
          >
            {item.images.length > 0 ? (
              <PromptImages images={item.images} />
            ) : null}
            {item.text ? (
              <Body selectable style={reading.user}>
                {item.text}
              </Body>
            ) : null}
          </View>
          {parentDriven || item.steering ? (
            <Meta style={{ marginTop: 4, paddingHorizontal: 3, fontSize: 9.5 }}>
              {parentDriven
                ? item.steering
                  ? 'parent agent · mid-turn'
                  : 'parent agent'
                : 'you · steering'}
            </Meta>
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
        <View style={attributedRow(c.border)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Fork color={tint} />
            <Body style={{ ...reading.summary, flexShrink: 1, color: c.mutedForeground }}>
              <Body style={{ ...reading.summary, fontFamily: font.sansMedium, color: c.foreground }}>{who}</Body>
              {' replied'}
              {item.name && item.name !== who ? ` · ${item.name}` : ''}
              {item.isError ? ' · hit an error' : ''}
              {item.interjected ? ' · mid-turn' : ''}
            </Body>
          </View>
          <Body
            selectable
            style={{
              ...reading.proseSmall,
              paddingLeft: 18,
              color: item.isError ? c.destructive : c.foreground,
            }}
          >
            {item.text}
          </Body>
        </View>
      );
    }

    case 'direct-message': {
      const tint = tintFor(handleTint(item.sender), isDark) ?? status.subagent;
      return (
        <View style={attributedRow(c.border)}>
          {item.senderSessionId ? (
            <Pressable accessibilityRole="link" accessibilityLabel={`Open agent session for ${item.sender}`}
              onPress={() => onOpenSubSession(item.senderSessionId!)}>
              <Body style={{ ...reading.caption, color: c.mutedForeground }}><Body style={{ ...reading.caption, fontFamily: font.sansMedium, color: tint }}>@</Body><Body style={{ ...reading.caption, fontFamily: font.sansMedium, color: c.foreground }}>{item.sender}</Body> · direct agent message{item.interjected ? ' · mid-turn' : ''}</Body>
            </Pressable>
          ) : (
            <Body style={{ ...reading.caption, color: c.mutedForeground }}><Body style={{ ...reading.caption, fontFamily: font.sansMedium, color: tint }}>@</Body><Body style={{ ...reading.caption, fontFamily: font.sansMedium, color: c.foreground }}>{item.sender}</Body> · direct agent message{item.interjected ? ' · mid-turn' : ''}</Body>
          )}
          <Body selectable style={{ ...reading.caption, paddingLeft: 18 }}>{item.text}</Body>
        </View>
      );
    }

    case 'chat-mention': {
      // A room message pushed into this session. Human provenance is visible:
      // an owner's display name is not an agent handle and must not get one.
      const tint = item.fromUser
        ? c.primary
        : tintFor(handleTint(item.sender), isDark) ?? status.subagent;
      return (
        <View
          accessibilityLabel={`${item.sender} mentioned this agent in former room #${item.room}`}
          style={attributedRow(c.border)}
        >
          <Body style={{ ...reading.caption, color: c.mutedForeground }}>
            {item.fromUser ? null : <Body style={{ ...reading.caption, fontFamily: font.sansMedium, color: tint }}>@</Body>}
            <Body style={{ ...reading.caption, fontFamily: font.sansMedium, color: c.foreground }}>
              {item.fromUser ? `${item.sender} · owner` : item.sender}
            </Body>
            {` · #${item.room} · message ${item.seq}`}
            {item.interjected ? ' · mid-turn' : ''}
          </Body>
          <Body selectable style={{ ...reading.caption, paddingLeft: 18 }}>
            {item.text}
          </Body>
        </View>
      );
    }

    case 'text':
      // Claude-like calm: the answer is prose, not another avatar/name row or
      // a bubble. Structured work around it keeps its own rendering.
      return (
        // The web's prose sits 18 under a group and 26 above a note; the
        // paragraphs inside already carry half the paragraph gap at each end.
        <View style={{ marginTop: 6, marginBottom: 10 }}>
          <Prose mentions={mentions}>{item.text}</Prose>
        </View>
      );

    case 'think':
      return (
        <Collapsible
          chevron="leading"
          name={thoughtFor(item.durationMs)}
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
        <Collapsible mark={<Bars color={c.mutedForeground} />} name={planProgress(item.steps)}
          strong chevron="trailing" open={open} onToggle={() => setOpen(!open)}>
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
        </Collapsible>
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
          {/* The web's heading, with the verdict beside it once there is one;
              an open gate has none, and the card below names the tool. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <Body style={{ flex: 1, minWidth: 140, fontFamily: font.sansMedium, fontSize: 12.5, lineHeight: 20 }}>
              Permission request
            </Body>
            {approvalVerdict(item.approved, pending, !!item.refused) ? (
              <Body style={{ fontFamily: font.sansMedium, fontSize: 10, lineHeight: 16, color: c.mutedForeground }}>
                {approvalVerdict(item.approved, pending, !!item.refused)}
              </Body>
            ) : null}
          </View>

          {/* Never truncated: this is the evidence the decision rests on. */}
          {item.reason ? (
            <Body style={{ fontSize: 12, lineHeight: 20, color: c.mutedForeground }}>
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

          {/* A tool that always asks (posting to a forge) says exactly what
              approving it posts: the rendered text, as text, in full — never
              truncated, because this is the evidence the verdict rests on. */}
          {item.preview ? (
            <View
              style={{
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: mix(c.muted, 40),
                padding: 8,
                gap: 4,
              }}>
              <Meta style={{ fontSize: 10 }}>
                What will be posted — read it before approving
              </Meta>
              <Body selectable style={{ fontFamily: font.mono, fontSize: 11.5, lineHeight: 20 }}>
                {item.preview}
              </Body>
            </View>
          ) : null}

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
            // The web leaves 26 between a reply and the note that closes it.
            marginTop: 5,
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
          <Body style={{ ...reading.note, flexShrink: 1, color: c.mutedForeground }}>
            {item.turn === 'completed' ? turnCompleteLabel(item.durationMs, item.sub != null) : item.text}
          </Body>
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
  weight = 'medium',
  strong = false,
  chevron,
  open,
  onToggle,
  children,
}: {
  /** A glyph in the left gutter; a leading chevron takes its place. */
  mark?: React.ReactNode;
  name: string;
  meta?: string;
  /** The web sets thinking and plan captions at 500, a tool run's at 400. */
  weight?: 'medium' | 'regular';
  /** The plan's caption reads in the foreground colour, the others muted. */
  strong?: boolean;
  /** The web's disclosure mark: › before a thinking row, ⌄ after a group. */
  chevron?: 'leading' | 'trailing';
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
        <View style={{ width: 12, alignItems: 'center' }}>
          {chevron === 'leading' ? (
            <Body style={{ ...reading.summary, color: c.mutedForeground, transform: [{ rotate: open ? '90deg' : '0deg' }] }}>›</Body>
          ) : mark}
        </View>
        {/* The web's disclosure rows are quiet sans at 12, so a run of them
            reads as one muted band under the prose. */}
        <Body numberOfLines={meta ? undefined : 1} style={{
          ...reading.summary,
          flexShrink: 1,
          fontFamily: weight === 'medium' ? font.sansMedium : font.sans,
          color: strong ? c.foreground : c.mutedForeground,
        }}>
          {name}
        </Body>
        {meta ? (
          <Body numberOfLines={1} style={{ ...reading.summary, flex: 1, color: c.mutedForeground }}>
            {meta}
          </Body>
        ) : <View style={{ flex: 1 }} />}
        {chevron === 'trailing' ? (
          <Body style={{ ...reading.summary, color: c.mutedForeground, transform: [{ rotate: open ? '180deg' : '0deg' }] }}>⌄</Body>
        ) : null}
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
