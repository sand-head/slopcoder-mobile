/**
 * Code reviews on a phone: the reviews one session started or commented on,
 * and one review opened in full — its findings to accept, dismiss or reopen.
 *
 * Ports the web's Reviews panel and ReviewView (Web.Client/Sessions/Reviews):
 * the same server records, the same words, the same decision rules. Findings
 * stay alphabetical to the server's rank order; the anchored diff and the
 * claim arrive with their slices. Nothing here enqueues a review — reviews are
 * requested by an agent's tools, on the laptop or from the composer.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CodeReviewAnalysisState,
  CodeReviewCaptureCompleteness,
  CodeReviewDiffLineKind,
  CodeReviewElevationTarget,
  CodeReviewFindingDiffStatus,
  CodeReviewFindingDisposition,
  CodeReviewFindingProvenance,
  CodeReviewFindingUpdateStatus,
  CodeReviewMode,
  CodeReviewPublicationEvent,
  CodeReviewPublicationItemState,
  CodeReviewPublicationPlacement,
  CodeReviewPublicationState,
  CodeReviewPublishStatus,
  CodeReviewSeverity,
  CodeReviewSuggestionStatus,
  CodeReviewTargetKind,
  type CodeReviewDetail,
  type CodeReviewFindingDetail,
  type CodeReviewFindingDiff,
  type CodeReviewFindingList,
  type CodeReviewFindingSummary,
  type CodeReviewFindingSuggestion,
  type CodeReviewPublicationOverview,
  type CodeReviewPublicationPreview,
  type CodeReviewPublicationPreviewItem,
  type CodeReviewPublicationView,
  type CodeReviewPublishableFinding,
  type CodeReviewSessionReview,
} from '../api/contracts';
import { useAuth } from '../state/auth';
import type { Seam } from '../api/seam';
import {
  Body,
  Button,
  Check,
  Hint,
  Meta,
  Mono,
  Skeleton,
  StatusDot,
} from '../ui/kit';
import { useHeaderInset } from '../navigation/headers';
import { Problem } from '../ui/settings';
import { Sheet } from '../ui/Sheet';
import { font, mix, radius, useTheme } from '../theme';
import type { Theme } from '../theme';

type Review = CodeReviewSessionReview['review'];

// The wording shared with the web (`ReviewText`/`ReviewFormat`), so the two
// say the same thing about the same review.

/** Still moving through the pipeline: polled, and cancellable. */
export function reviewIsActive(state: CodeReviewAnalysisState): boolean {
  switch (state) {
    case CodeReviewAnalysisState.Queued:
    case CodeReviewAnalysisState.Snapshotting:
    case CodeReviewAnalysisState.Captured:
    case CodeReviewAnalysisState.Planning:
    case CodeReviewAnalysisState.Investigating:
    case CodeReviewAnalysisState.Validating:
    case CodeReviewAnalysisState.Falsifying:
    case CodeReviewAnalysisState.Consolidating:
      return true;
    default:
      return false;
  }
}

function stateLabel(state: CodeReviewAnalysisState): string {
  switch (state) {
    case CodeReviewAnalysisState.Queued:
      return 'queued';
    case CodeReviewAnalysisState.Snapshotting:
      return 'capturing';
    case CodeReviewAnalysisState.Captured:
      return 'captured';
    case CodeReviewAnalysisState.Planning:
      return 'planning';
    case CodeReviewAnalysisState.Investigating:
      return 'reviewing';
    case CodeReviewAnalysisState.Validating:
      return 'validating';
    case CodeReviewAnalysisState.Falsifying:
      return 'verifying';
    case CodeReviewAnalysisState.Consolidating:
      return 'consolidating';
    case CodeReviewAnalysisState.Completed:
      return 'completed';
    case CodeReviewAnalysisState.Partial:
      return 'partial';
    case CodeReviewAnalysisState.Failed:
      return 'failed';
    case CodeReviewAnalysisState.Cancelled:
      return 'cancelled';
    case CodeReviewAnalysisState.Superseded:
      return 'superseded';
    default:
      return 'unknown';
  }
}

/** A state as an agent review reads it: a finished one is ready for comments, not "completed". */
function stateLabelFor(state: CodeReviewAnalysisState, mode: CodeReviewMode): string {
  return mode === CodeReviewMode.Agent && state === CodeReviewAnalysisState.Completed
    ? 'ready for comments'
    : stateLabel(state);
}

function modeLabel(mode: CodeReviewMode): string {
  return mode === CodeReviewMode.Agent ? 'agent review' : 'pipeline review';
}

function kindLabel(target: Review['target']): string {
  switch (target.kind) {
    case CodeReviewTargetKind.PullRequest:
      return 'pull request';
    case CodeReviewTargetKind.CommitRange:
      return 'commit range';
    case CodeReviewTargetKind.WorkingChanges:
      return 'uncommitted changes';
    case CodeReviewTargetKind.Snapshot:
      return 'files snapshot';
    default:
      return 'review';
  }
}

const LOCAL_AUTHORITY = 'local';

/** The repository, `owner/name`, or "local workspace" for code no forge knows. */
function where(target: Review['target']): string {
  return target.canonicalAuthority === LOCAL_AUTHORITY
    ? 'local workspace'
    : `${target.repositoryOwner}/${target.repositoryName}`;
}

function shortSha(sha: string | null | undefined): string {
  return sha && sha.length > 10 ? sha.slice(0, 10) : (sha ?? '—');
}

/** `owner/name#7`; `owner/name base..head` for a range; the others name themselves. */
function targetLabel(target: Review['target']): string {
  switch (target.kind) {
    case CodeReviewTargetKind.PullRequest:
      return `${where(target)}#${target.pullRequestNumber}`;
    case CodeReviewTargetKind.CommitRange:
      return `${where(target)} ${shortSha(target.rangeBaseSha)}..${shortSha(target.headSha)}`;
    case CodeReviewTargetKind.WorkingChanges:
      return `${where(target)} · uncommitted changes on ${shortSha(target.rangeBaseSha)}`;
    case CodeReviewTargetKind.Snapshot:
      return `${where(target)} · files snapshot`;
    default:
      return where(target);
  }
}

function location(path: string, side: number, start: number, end: number): string {
  const lines = start === end ? `${start}` : `${start}-${end}`;
  return `${path}:${lines}${side === 1 ? ' (base)' : ''}`;
}

function dispositionLabel(disposition: CodeReviewFindingDisposition): string {
  switch (disposition) {
    case CodeReviewFindingDisposition.Accepted:
      return 'accepted';
    case CodeReviewFindingDisposition.Dismissed:
      return 'dismissed';
    default:
      return 'open';
  }
}

function incompleteReasonText(reason: number): string {
  switch (reason) {
    case 6:
      return 'some files were left out at a size or count limit, or could not be read';
    case 1:
      return 'the list of changed files was cut off at its page limit';
    case 4:
      return 'a page of changed files was too large to read';
    case 5:
      return 'fewer files were listed than the pull request reports';
    case 2:
      return 'the source could not be read in full';
    case 3:
      return 'the source returned something that could not be read';
    default:
      return '';
  }
}

/** Coverage in one line, honest about what nobody looked at. */
function coverageLine(review: CodeReviewSessionReview): string {
  const item = review.review;
  if (item.mode === CodeReviewMode.Agent) {
    return 'agent comments only · no automated coverage';
  }
  if (!review.coverage) {
    return reviewIsActive(item.state)
      ? 'not yet planned'
      : completenessLabel(item.reviewCompleteness);
  }
  let line = `${completenessLabel(item.reviewCompleteness)} · ${review.coverage.reviewed} reviewed`;
  if (review.coverage.notReviewed > 0) line += ` · ${review.coverage.notReviewed} not reviewed`;
  if (review.coverage.excluded > 0) line += ` · ${review.coverage.excluded} excluded`;
  if (review.coverage.inProgress > 0) line += ` · ${review.coverage.inProgress} in progress`;
  return line;
}

function completenessLabel(completeness: number | null): string {
  switch (completeness) {
    case 1:
      return 'complete';
    case 2:
      return 'complete, with exclusions';
    case 3:
      return 'partial';
    case 4:
      return 'stale';
    case 0:
      return 'pending';
    case 5:
      return 'no automated coverage';
    default:
      return '—';
  }
}

/** The sentence for a refused decision, in words; null when it went through. */
export function decisionMessage(status: CodeReviewFindingUpdateStatus | null): string | null {
  switch (status) {
    case CodeReviewFindingUpdateStatus.Updated:
    case CodeReviewFindingUpdateStatus.Unchanged:
      return null;
    case CodeReviewFindingUpdateStatus.VersionConflict:
      return 'Not saved: this finding changed since you opened it (another tab or device?). It has been reloaded — check it and decide again.';
    case CodeReviewFindingUpdateStatus.ConsolidationChanged:
      return 'Not saved: the review’s findings were rebuilt since you loaded them. The list has been reloaded.';
    case CodeReviewFindingUpdateStatus.Superseded:
      return 'Not saved: a newer commit of this pull request has been captured, so this review no longer takes decisions. Open the newer review to decide there.';
    case CodeReviewFindingUpdateStatus.Invalid:
      return 'Not saved: that is not a decision this page can make.';
    default:
      return 'Not saved: the review or finding is gone, or is not yours.';
  }
}

/** Only a finished review that no newer head has superseded takes decisions. */
export function findingsDecidable(list: CodeReviewFindingList): boolean {
  return (
    !list.superseded &&
    list.consolidationDigest != null &&
    (list.state === CodeReviewAnalysisState.Completed ||
      list.state === CodeReviewAnalysisState.Partial)
  );
}

// Publication wording, ported from the web's PublicationActions so the two
// say the same thing about the same result.

function eventLabel(reviewEvent: CodeReviewPublicationEvent): string {
  return reviewEvent === CodeReviewPublicationEvent.RequestChanges
    ? 'request changes'
    : 'comment';
}

function publicationStateLabel(state: CodeReviewPublicationState): string {
  return state === CodeReviewPublicationState.PartiallyPublished
    ? 'partially published'
    : CodeReviewPublicationState[state].toLowerCase();
}

function itemStateLabel(state: CodeReviewPublicationItemState): string {
  return state === CodeReviewPublicationItemState.NotPublishable
    ? 'not publishable'
    : CodeReviewPublicationItemState[state].toLowerCase();
}

function placementLabel(placement: CodeReviewPublicationPlacement | null): string {
  switch (placement) {
    case CodeReviewPublicationPlacement.Inline:
      return 'inline';
    case CodeReviewPublicationPlacement.Summary:
      return 'summary';
    case CodeReviewPublicationPlacement.Issue:
      return 'issue';
    default:
      return '—';
  }
}

/** A checkbox only for a finding the server says can be published. */
/** Whether one of the review's findings could be published, and where it would go. */
function publishable(place: CodeReviewPublishableFinding | null | undefined): boolean {
  return place != null && place.placement != null && place.refusal == null && place.publishedIn == null;
}

/** Where a previewed comment goes, in words: "src/a.cs, new line 3" or "lines 3–5". */
export function previewWhere(item: CodeReviewPublicationPreviewItem): string {
  const place = `${item.path}, ${item.side === 1 ? 'old' : 'new'} `;
  return item.startLine != null
    ? `${place}lines ${item.startLine}–${item.line}`
    : `${place}line ${item.line}`;
}

/**
 * What a publish or retry request did, in words — the web's PublicationActions
 * message, character for character where a phone screen allows.
 */
export function publishMessage(result: {
  status: CodeReviewPublishStatus;
  reason: string | null;
  publication: CodeReviewPublicationView | null;
} | null): string {
  if (result == null) return 'This review is gone, or is not yours.';
  if (result.status === CodeReviewPublishStatus.Replayed) {
    return 'This was already sent; showing that publication.';
  }
  if (result.status === CodeReviewPublishStatus.Ran && result.publication) {
    const p = result.publication;
    switch (p.state) {
      case CodeReviewPublicationState.Published:
        return p.target === CodeReviewElevationTarget.Issues
          ? 'Opened as issues in the repository.'
          : 'Published to the pull request.';
      case CodeReviewPublicationState.PartiallyPublished:
        return 'Published in part: some findings were not posted (see below). You can retry the rest.';
      case CodeReviewPublicationState.Obsolete:
        return 'The review was superseded while publishing. Whatever reached the forge is recorded below.';
      default:
        return `Nothing was published. ${p.error ?? ''}`.trim();
    }
  }
  if (result.reason && result.reason.length > 0) return result.reason;
  return 'Nothing was published.';
}

/** `crypto.randomUUID` where it exists, an RFC4122-v4-shaped id otherwise. */
export function newRequestId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`;
}

/** P0 destructive, P1 amber, P2/P3 foreground — the web's `sev-*` classes. */
function severityColor(
  severity: number,
  c: Theme['c'],
): string {
  switch (severity) {
    case 0:
      return c.destructive;
    case 1:
      return '#e17100';
    default:
      return c.foreground;
  }
}

function tally(counts: { p0: number; p1: number; p2: number; p3: number }): string {
  return (
    [
      ['P0', counts.p0],
      ['P1', counts.p1],
      ['P2', counts.p2],
      ['P3', counts.p3],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name} ${n}`)
    .join(' · ');
}

// ---------------------------------------------------------------------------
// The list screen
// ---------------------------------------------------------------------------

export function ReviewsScreen({ route, navigation }: { route: any; navigation: any }) {
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const seam = useAuth(s => s.seam);
  const sessionId: string = route.params.sessionId;

  const [reviews, setReviews] = useState<CodeReviewSessionReview[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const read = useCallback(async () => {
    if (!seam) return;
    try {
      const list = await seam.sessionReviews(sessionId);
      if (list === null) {
        // A 404: another owner's session, or none. What is shown stays.
        setTrouble('These reviews are gone, or are not yours.');
      } else {
        setReviews(list);
        setTrouble(null);
      }
    } catch {
      setTrouble('Could not read this session’s reviews.');
    } finally {
      setRefreshing(false);
    }
  }, [seam, sessionId]);

  useEffect(() => {
    void read();
  }, [read]);

  // While any review still runs, read again every 3s — the web's cadence.
  const running = (reviews ?? []).some(r => reviewIsActive(r.review.state));
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void read(), 3000);
    return () => clearInterval(t);
  }, [running, read]);

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
        paddingTop: headerInset + 20,
        paddingBottom: insets.bottom + 32,
        gap: 14,
      }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void read(); }} />
      }
    >
      {trouble ? <Problem>{trouble}</Problem> : null}
      {reviews === null && !trouble ? <Skeleton rows={3} /> : null}
      {reviews?.length === 0 ? (
        <Hint>
          No code reviews in this session yet. Ask the agent to review a pull request, a commit range, uncommitted changes or a directory’s files; each review shows up here.
        </Hint>
      ) : null}
      {(reviews ?? []).map(review => (
        <ReviewRow key={review.review.id} review={review} navigation={navigation} />
      ))}
    </ScrollView>
  );
}

function ReviewRow({
  review,
  navigation,
}: {
  review: CodeReviewSessionReview;
  navigation: any;
}) {
  const { c } = useTheme();
  const item = review.review;
  const active = reviewIsActive(item.state);
  const counts = item.findings;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Review ${targetLabel(item.target)}, ${stateLabelFor(item.state, item.mode)}`}
      onPress={() => navigation.push('ReviewDetail', { reviewId: item.id, title: targetLabel(item.target) })}
      style={({ pressed }) => ({
        gap: 6,
        padding: 14,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: pressed ? mix(c.muted, 60) : c.background,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Mono numberOfLines={1} style={{ color: c.foreground, fontSize: 12.5 }}>
            {targetLabel(item.target)}
          </Mono>
          <Mono numberOfLines={1}>
            {kindLabel(item.target)} · {modeLabel(item.mode)}
            {review.startedHere ? '' : ' · commented on here'}
          </Mono>
        </View>
        {active ? <StatusDot running /> : null}
        <Mono style={{ color: active ? c.mutedForeground : c.foreground }}>
          {stateLabelFor(item.state, item.mode)}
        </Mono>
      </View>
      <Mono numberOfLines={2}>{coverageLine(review)}</Mono>
      {counts && review.findingTotal > 0 ? (
        <Mono numberOfLines={1} style={{ color: c.foreground }}>
          {tally(counts)} · {counts.open} open
        </Mono>
      ) : null}
      {item.captureCompleteness === CodeReviewCaptureCompleteness.Incomplete ? (
        <Mono numberOfLines={2}>capture incomplete: {incompleteReasonText(review.incompleteReason)}</Mono>
      ) : null}
      {item.supersededByRunId ? <Mono>stale: a newer head was captured</Mono> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// The detail screen
// ---------------------------------------------------------------------------

export function ReviewDetailScreen({ route, navigation }: { route: any; navigation: any }) {
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const seam = useAuth(s => s.seam);
  const reviewId: string = route.params.reviewId;

  // The list names the target on the button that pushed this screen; the bar
  // repeats it so the reader knows which review they are in.
  useLayoutEffect(() => {
    if (route.params.title) navigation.setOptions({ title: route.params.title });
  }, [navigation, route.params.title]);

  const [detail, setDetail] = useState<CodeReviewDetail | null>(null);
  const [findings, setFindings] = useState<CodeReviewFindingList | null>(null);
  const [missing, setMissing] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!seam) return;
    try {
      const d = await seam.reviewDetail(reviewId);
      if (d === null) {
        setMissing(true);
        return;
      }
      setDetail(d);
      const list = await seam.reviewFindings(reviewId);
      if (list !== null) setFindings(list);
    } catch {
      setTrouble('Could not load the review.');
    }
  }, [seam, reviewId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while it runs, like the web's ReviewView.
  const running = detail != null && reviewIsActive(detail.state);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [running, load]);

  const cancel = useCallback(() => {
    if (!seam) return;
    setBusy(true);
    void (async () => {
      try {
        const result = await seam.cancelReview(reviewId);
        if (result === null) {
          setMissing(true);
        } else if (!result.cancelled) {
          setTrouble(`The review had already ended (${stateLabel(result.state)}).`);
        }
        await load();
      } catch {
        setTrouble('Could not cancel the review.');
      } finally {
        setBusy(false);
      }
    })();
  }, [seam, reviewId, load]);

  // Before the early return below: hooks must run in the same order on every
  // render, and `missing` returns first.
  const { c: themeColor } = useTheme();
  // Line colours must survive a light surface, like the transcript's code.
  const dark = themeColor.background === '#0a0a0a' || themeColor.background === '#000000';

  if (missing) {
    return (
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: headerInset + 20,
          paddingBottom: insets.bottom + 32,
        }}
      >
        <Body>No such review: it does not exist, or it belongs to someone else.</Body>
      </ScrollView>
    );
  }

  const agent = detail?.mode === CodeReviewMode.Agent;

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
        paddingTop: headerInset + 20,
        paddingBottom: insets.bottom + 32,
        gap: 16,
      }}
    >
      {detail === null ? <Skeleton rows={4} /> : null}
      {detail ? <ReviewSummaryBlock detail={detail} busy={busy} onCancel={cancel} /> : null}
      {trouble ? <Problem>{trouble}</Problem> : null}

      {/* One card per finding, always open, with publishing fused in: the
          web's findings list and its publication select are one surface on a
          phone — no second card per finding, no collapsible rows. */}
      {detail != null ? (
        <View style={{ gap: 10 }}>
          <Meta>{agent ? 'Comments' : 'Findings'}</Meta>
          {findings === null && !trouble ? (
            <Skeleton rows={2} height={40} />
          ) : (
            <FindingsBlock
              findings={findings}
              detail={detail}
              seam={seam}
              dark={dark}
              onDecided={() => void load()}
              onChanged={() => void load()}
            />
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Findings and publishing, fused — the web's FindingList, FindingPanel,
// ReviewPublishing, PublicationPanel and PublicationSelect as one surface.
// ---------------------------------------------------------------------------

/**
 * One card per finding, always open, with its own publish checkbox; a publish
 * bar at the bottom of the list. Nothing is sent without the confirmation's
 * own button. Rendered only where the web renders it: a review with
 * consolidated findings whose target a connected forge knows.
 */
// One confirmation: which event, and the preview the server rendered for the
// chosen findings. `event` survives while the preview loads (and after it
// fails), so a retry press knows what to ask for again.
type PendingPublication = {
  event: CodeReviewPublicationEvent;
  preview: CodeReviewPublicationPreview | null;
};

function PublicationPanel({
  reviewId,
  detail,
  findings,
  seam,
  dark,
  agent,
  onDecided,
  onChanged,
}: {
  reviewId: string;
  detail: CodeReviewDetail;
  findings: CodeReviewFindingList;
  seam: Seam | null;
  dark: boolean;
  agent: boolean;
  onDecided: () => void;
  onChanged: () => void;
}) {
  const { c } = useTheme();
  const [overview, setOverview] = useState<CodeReviewPublicationOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Which findings the checkboxes picked, in the server's rank order.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // What the checked findings will be submitted as — the web's select box.
  const [event, setEvent] = useState<CodeReviewPublicationEvent>(
    CodeReviewPublicationEvent.Comment,
  );
  const [pending, setPending] = useState<PendingPublication | null>(null);
  const [busy, setBusy] = useState(false);
  // Failure words for the LAST press of the publish bar: they render at the
  // bar, where the thumb is — never below the fold.
  const [barMessage, setBarMessage] = useState<string | null>(null);
  const [sheetMessage, setSheetMessage] = useState<string | null>(null);
  const requestId = useRef<string>('');

  const load = useCallback(async () => {
    if (!seam) return;
    try {
      const o = await seam.reviewPublications(reviewId);
      setOverview(o);
      setLoadError(o === null ? 'This review is gone, or is not yours.' : null);
      // Only what is still publishable stays selected — the web's rule.
      if (o != null) {
        setSelected(prev => {
          const next = new Set(
            [...prev].filter(id => publishable(o.findings.find(f => f.findingId === id))),
          );
          return next.size === prev.size ? prev : next;
        });
      }
    } catch {
      setLoadError('Could not check what can be published.');
    }
  }, [seam, reviewId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The web only mounts this panel for a review with consolidated findings
  // whose target a connected forge knows; FindingsBlock checked both before
  // rendering it, so the local/empty cases are not repeated here.
  const issues =
    (overview?.target ?? (detail.target.kind === CodeReviewTargetKind.PullRequest
      ? CodeReviewElevationTarget.PullRequestReview
      : CodeReviewElevationTarget.Issues)) === CodeReviewElevationTarget.Issues;
  const repository = overview?.repository ?? where(detail.target);
  const heading = issues ? `Raise as issues in ${repository}` : 'Publish to the pull request';

  const orderedIds = findings.findings.map(f => f.id);

  // The publish bar: previews exactly what is checked. A tap that does
  // nothing is the bug this screen is named for — every way it can fail says
  // its words at the bar, and nothing is left silently dead.
  const openPreview = (asEvent: CodeReviewPublicationEvent) => {
    if (!seam) {
      setBarMessage('Not connected. Reconnect and try again.');
      return;
    }
    const ids = orderedIds.filter(id => selected.has(id));
    if (ids.length === 0) {
      setBarMessage('Check the findings to publish first.');
      return;
    }
    setBarMessage(null);
    setBusy(true);
    setPending({ event: asEvent, preview: null });
    void (async () => {
      try {
        const p = await seam.previewReviewPublication(reviewId, ids, asEvent);
        if (p === null) {
          setBarMessage('This review is gone, or is not yours.');
          setPending(null);
        } else {
          // Made once when the confirmation opens, so a resend is the same publication.
          requestId.current = newRequestId();
          setPending({ event: asEvent, preview: p });
        }
      } catch {
        setBarMessage('Could not prepare the preview. Try again.');
        setPending(null);
      } finally {
        setBusy(false);
      }
    })();
  };

  const publish = () => {
    if (!seam || pending?.preview == null) return;
    const p = pending.preview;
    setBusy(true);
    void (async () => {
      try {
        const result = await seam.publishReview(requestId.current, reviewId, {
          findingIds: p.items.map(i => i.findingId),
          event: p.event,
        });
        // The outcome is said in the sheet, where the finger pressed Confirm —
        // and stays there until it is closed; the panel behind is refreshed.
        setSheetMessage(publishMessage(result));
        await load();
        onChanged();
      } catch {
        setSheetMessage(
          'The server could not be reached. Nothing is known to be published; reload to see what happened.',
        );
      } finally {
        setBusy(false);
      }
    })();
  };

  const askRetry = (publicationId: string) => {
    Alert.alert(
      'Retry this publication?',
      'The forge is checked for what an earlier attempt already posted; only what is missing is sent.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Retry',
          onPress: () => {
            if (!seam) return;
            setBusy(true);
            void (async () => {
              try {
                const result = await seam.retryReviewPublication(reviewId, publicationId);
                // Said as a dialog because the retry began as one — the sheet
                // is not open here, so its message would be invisible.
                Alert.alert('Retry', publishMessage(result));
              } catch {
                Alert.alert('Retry', 'The server could not be reached; reload to see what happened.');
              } finally {
                setBusy(false);
                await load();
              }
            })();
          },
        },
      ],
    );
  };

  const anyPublishable = overview == null || overview.findings.some(f => publishable(f));
  // The sheet reads this, not `pending` itself: null while the preview loads.
  const p = pending?.preview ?? null;

  return (
    <View style={{ gap: 10 }}>
      <Meta>{heading}</Meta>

      {overview === null ? <Hint>{loadError ?? 'Checking what can be published…'}</Hint> : null}

      {overview != null && !overview.canPublish ? <Hint>{overview.blocker}</Hint> : null}

      {overview != null && overview.canPublish && !anyPublishable ? (
        // No finding can still be published: said in words where the publish
        // bar would be, while the cards above still say what became of each.
        <Hint>
          Nothing here can still be published: every finding was already posted, or cannot be raised.
        </Hint>
      ) : null}

      {/* The findings themselves — one always-open card each, the publish
          checkbox for this finding riding on it. The web splits this into
          FindingList/FindingPanel and PublicationSelect; a phone does not.
          While the overview loads — or says publishing is blocked — the cards
          stand without their publish row, like the web's undrawn select. */}
      {findings.findings.map(finding => {
        const place =
          overview != null && overview.canPublish
            ? overview.findings.find(f => f.findingId === finding.id) ?? null
            : null;
        return (
          <FindingCard
            key={finding.id}
            reviewId={reviewId}
            digest={findings.consolidationDigest!}
            canDecide={findingsDecidable(findings)}
            finding={finding}
            seam={seam}
            agent={agent}
            dark={dark}
            onDecided={onDecided}
            place={place}
            checked={selected.has(finding.id)}
            onToggle={() =>
              setSelected(prev => {
                const next = new Set(prev);
                if (!next.delete(finding.id)) next.add(finding.id);
                return next;
              })
            }
          />
        );
      })}

      {/* The publish bar — the web's pub-actions row at the bottom of the
          list, where the thumb rests after the last checkbox. Its failure
          words render on it, never below the fold. */}
      {overview != null && overview.canPublish && anyPublishable ? (
        <View style={{ gap: 8 }}>
          {!issues ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <Mono>Submit as</Mono>
              {(
                [
                  CodeReviewPublicationEvent.Comment,
                  CodeReviewPublicationEvent.RequestChanges,
                ] as const
              ).map(choice => (
                <Pressable
                  key={choice}
                  accessibilityRole="button"
                  accessibilityLabel={`Submit as ${eventLabel(choice)}`}
                  accessibilityState={{ selected: event === choice, disabled: busy }}
                  disabled={busy}
                  onPress={() => setEvent(choice)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: event === choice ? c.primary : c.border,
                    backgroundColor: event === choice ? mix(c.primary, 14) : 'transparent',
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Mono style={{ fontSize: 12, color: event === choice ? c.primary : c.mutedForeground }}>
                    {eventLabel(choice)}
                  </Mono>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Button
            label={`Review what will be posted${selected.size > 0 ? ` (${selected.size})` : ''}…`}
            variant="primary"
            disabled={busy || selected.size === 0}
            busy={busy}
            onPress={() => openPreview(event)}
          />
          {barMessage != null ? (
            <Body accessibilityLiveRegion="polite" style={{ color: c.destructive, fontSize: 13 }}>
              {barMessage}
            </Body>
          ) : null}
        </View>
      ) : null}

      {overview != null && overview.publications.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Meta>Publications</Meta>
          {overview.publications.map(pub => (
            <View
              key={pub.id}
              style={{
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: c.border,
                // The one status colour that reads at a glance.
                borderLeftWidth: 3,
                borderLeftColor:
                  pub.state === CodeReviewPublicationState.Published
                    ? c.primary
                    : pub.state === CodeReviewPublicationState.Failed ||
                      pub.state === CodeReviewPublicationState.PartiallyPublished
                    ? c.destructive
                    : c.border,
                padding: 12,
                gap: 8,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Mono
                  style={{
                    color:
                      pub.state === CodeReviewPublicationState.Published
                        ? c.primary
                        : pub.state === CodeReviewPublicationState.Failed
                        ? c.destructive
                        : c.foreground,
                  }}
                >
                  {publicationStateLabel(pub.state)}
                </Mono>
                {pub.target !== CodeReviewElevationTarget.Issues ? <Mono>{eventLabel(pub.event)}</Mono> : null}
                <Mono>{shortSha(pub.headSha)}</Mono>
                <Mono>
                  {pub.attempts} {pub.attempts === 1 ? 'attempt' : 'attempts'}
                </Mono>
                {retryable(pub) ? (
                  <Button
                    label="Retry"
                    variant="outline"
                    disabled={!overview.canPublish || busy}
                    onPress={() => askRetry(pub.id)}
                  />
                ) : null}
              </View>
              {pub.error != null ? <Problem>{pub.error}</Problem> : null}
              {pub.items.map(item => {
                const link = safeHttpUrl(item.remoteUrl);
                return (
                  <View key={item.findingId} style={{ gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Mono>#{item.rank}</Mono>
                      <Mono style={{ color: severityColor(item.severity, c) }}>
                        {severityName(item.severity)}
                      </Mono>
                      <Body numberOfLines={1} style={{ flex: 1 }}>
                        {item.title}
                      </Body>
                    </View>
                    <Mono>
                      {placementLabel(item.placement)} · {itemStateLabel(item.state)}
                      {link != null ? ` · ${link}` : ''}
                    </Mono>
                    {item.error != null && item.state !== CodeReviewPublicationItemState.Published ? (
                      <Problem>{item.error}</Problem>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}

      <Sheet
        visible={pending != null}
        title={heading}
        onClose={() => {
          setPending(null);
          setSheetMessage(null);
        }}
      >
        {pending != null ? (
          <View style={{ gap: 12, paddingBottom: 24 }}>
            {p == null ? (
              // The preview is still loading (or failed and this is the busy
              // fallback): say so in the sheet, not nowhere.
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={c.mutedForeground} />
                <Mono>preparing the preview…</Mono>
              </View>
            ) : p.target === CodeReviewElevationTarget.Issues ? (
              <>
                <Body>
                  {`An issue in ${p.repository ?? repository}, about the reviewed commit ${shortSha(
                    p.headSha,
                  )}, carrying the review’s coverage note.`}
                </Body>
                {p.items
                  .filter(i => i.body != null)
                  .map(item => (
                    <View key={item.findingId} style={{ gap: 6 }}>
                      <Meta>{`#${item.rank} · ${item.title}`}</Meta>
                      <Mono>issue · {previewWhere(item)}</Mono>
                      <Meta>Title</Meta>
                      <Mono>{item.issueTitle}</Mono>
                      <Pre>{item.body}</Pre>
                    </View>
                  ))}
              </>
            ) : (
              <>
                <Body>
                  {`One review on the pull request, submitted as ${eventLabel(
                    p.event,
                  )}, on commit ${shortSha(p.headSha)}. The head is checked again before anything is sent.`}
                </Body>
                {p.coverageNotice != null ? <Problem>{p.coverageNotice} It says so in the review.</Problem> : null}
                <Meta>Review body</Meta>
                <Pre>{p.reviewBody}</Pre>
                {p.items
                  .filter(i => i.body != null)
                  .map(item => (
                    <View key={item.findingId} style={{ gap: 6 }}>
                      <Meta>{`#${item.rank} · ${item.title}`}</Meta>
                      <Mono>inline · {previewWhere(item)}</Mono>
                      <Pre>{item.body}</Pre>
                    </View>
                  ))}
              </>
            )}
            {p != null && p.items.some(i => i.refusal != null) ? (
              <View style={{ gap: 4 }}>
                <Meta>Will not be posted</Meta>
                {p != null && p.items
                  .filter(i => i.refusal != null)
                  .map(item => (
                    <Mono key={item.findingId}>
                      #{item.rank} · {item.title}: {item.refusal}
                    </Mono>
                  ))}
              </View>
            ) : null}
            <Body>
              {p?.target === CodeReviewElevationTarget.Issues
                ? 'Each issue is visible to everyone who can see the repository’s issues, and cannot be taken back from here.'
                : 'This is visible to everyone who can see the pull request, and cannot be taken back from here.'}
            </Body>
            {sheetMessage != null ? (
              <Body accessibilityLiveRegion="polite" style={{ fontFamily: font.sansMedium }}>
                {sheetMessage}
              </Body>
            ) : null}
            <Button
              label={
                sheetMessage != null
                  ? 'Close'
                  : p?.target === CodeReviewElevationTarget.Issues
                  ? 'Open issues'
                  : 'Post review'
              }
              variant="primary"
              disabled={busy}
              busy={busy}
              onPress={() => {
                if (sheetMessage != null) setPending(null);
                else publish();
              }}
            />
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

/** The compact pills a finding card carries, as label/tint pairs. */
function cardTags(finding: CodeReviewFindingSummary): { label: string; tint?: 'primary' }[] {
  const tags: { label: string; tint?: 'primary' }[] = [];
  if (finding.provenance === CodeReviewFindingProvenance.AgentSession) tags.push({ label: 'agent' });
  if (finding.hasSuggestion) tags.push({ label: 'suggestion' });
  if (finding.disposition === CodeReviewFindingDisposition.Accepted)
    tags.push({ label: dispositionLabel(finding.disposition), tint: 'primary' });
  else if (finding.disposition === CodeReviewFindingDisposition.Dismissed)
    tags.push({ label: dispositionLabel(finding.disposition) });
  if (finding.provenance === CodeReviewFindingProvenance.Pipeline)
    tags.push({ label: String(finding.score.total) });
  return tags;
}

/** One finding card's header row: rank, severity, title flexing, then pills. */
function CardHeader({
  rank,
  severity,
  title,
  tags,
}: {
  rank: number;
  severity: CodeReviewSeverity;
  title: string;
  tags: { label: string; tint?: 'primary' }[];
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
      <Mono style={{ color: c.mutedForeground }}>#{rank}</Mono>
      <Mono style={{ color: severityColor(severity, c) }}>{severityName(severity)}</Mono>
      <Body
        numberOfLines={2}
        style={{ flex: 1, minWidth: 120, fontFamily: font.sansMedium, fontSize: 14 }}
      >
        {title}
      </Body>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {tags.map(t => (
          <Pill key={t.label} label={t.label} tint={t.tint} />
        ))}
      </View>
    </View>
  );
}

/** A compact uppercase mono pill: the tag vocabulary of the findings list. */
function Pill({ label, tint }: { label: string; tint?: 'primary' }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        backgroundColor: mix(c.mutedForeground, 10),
        borderRadius: 999,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Mono style={{ fontSize: 10.5, textTransform: 'uppercase', color: tint === 'primary' ? c.primary : c.mutedForeground }}>
        {label}
      </Mono>
    </View>
  );
}

/** An explicit retry may run: the publication did not finish, and nothing marked it final. */
function retryable(p: CodeReviewPublicationView): boolean {
  return (
    p.state === CodeReviewPublicationState.PartiallyPublished ||
    p.state === CodeReviewPublicationState.Failed
  );
}

/** Forge links are shown only when they are http(s). */
function safeHttpUrl(url: string | null): string | null {
  if (url == null) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** The markdown source exactly as it would be posted, never rendered. */
function Pre({ children }: { children: string | null }) {
  const { c } = useTheme();
  if (children == null) return null;
  return (
    <Mono selectable style={{ color: c.foreground }}>
      {children}
    </Mono>
  );
}

function ReviewSummaryBlock({
  detail,
  busy,
  onCancel,
}: {
  detail: CodeReviewDetail;
  busy: boolean;
  onCancel: () => void;
}) {
  const { c } = useTheme();
  const snapshot = detail.snapshot;
  const progress = detail.progress;
  const agent = detail.mode === CodeReviewMode.Agent;
  const active = reviewIsActive(detail.state);
  const range = detail.target.kind !== CodeReviewTargetKind.PullRequest;

  const cancelConfirm = () => {
    // The platform's confirm sheet. Cancel is terminal: its queued and running
    // work is cancelled with it.
    Alert.alert(
      'Cancel this review?',
      'Work in progress stops and the review ends as cancelled. Findings are only produced by a review that finishes.',
      [
        { text: 'Keep it running', style: 'cancel' },
        { text: 'Cancel review', style: 'destructive', onPress: onCancel },
      ],
    );
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Mono numberOfLines={1} style={{ color: c.foreground, fontSize: 13 }}>
            {targetLabel(detail.target)}
          </Mono>
          {snapshot && snapshot.title.length > 0 ? (
            <Body numberOfLines={2}>{snapshot.title}</Body>
          ) : null}
        </View>
        {active ? (
          <Button
            label="Cancel"
            variant="ghost"
            disabled={busy}
            onPress={cancelConfirm}
            accessibilityLabel="Cancel this review"
          />
        ) : null}
      </View>

      <Mono numberOfLines={3}>
        {kindLabel(detail.target)} · base {snapshot ? shortSha(snapshot.baseSha) : '—'} · head{' '}
        {shortSha(detail.target.headSha)} · {modeLabel(detail.mode)}
        {agent ? '' : ` · pipeline v${detail.pipelineVersion}`}
      </Mono>

      {detail.supersededByRunId ? (
        <View
          style={{
            padding: 12,
            borderRadius: radius.md,
            backgroundColor: mix(c.muted, 60),
            gap: 4,
          }}
        >
          <Body style={{ fontFamily: font.sansMedium, fontSize: 14 }}>
            Stale: a newer commit of this pull request has been captured.
          </Body>
          <Hint>
            These findings are about {shortSha(detail.target.headSha)}, which is no longer the pull request’s head. They stay readable, but this review takes no more decisions.
          </Hint>
        </View>
      ) : null}

      {detail.state === CodeReviewAnalysisState.Failed ? (
        <View style={{ padding: 12, borderRadius: radius.md, backgroundColor: mix(c.destructive, 10), gap: 4 }}>
          <Body style={{ color: c.destructive, fontFamily: font.sansMedium, fontSize: 14 }}>
            The review failed.
          </Body>
          <Hint>{detail.failureReason ?? 'No reason was recorded.'}</Hint>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {active ? <StatusDot running /> : null}
        <Mono style={{ color: c.foreground }}>{stateLabelFor(detail.state, detail.mode)}</Mono>
        <Mono>
          {completenessLabel(progress.completeness)}
          {progress.coverage
            ? ` · ${progress.coverage.reviewed} reviewed · ${progress.coverage.notReviewed} not reviewed` +
              (progress.coverage.excluded > 0 ? ` · ${progress.coverage.excluded} excluded` : '')
            : ''}
        </Mono>
      </View>

      {range && detail.sourcePath ? (
        <Mono numberOfLines={1}>
          from {detail.sourcePath === '.' ? 'the workspace root' : detail.sourcePath}
        </Mono>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

function FindingsBlock({
  findings,
  detail,
  seam,
  dark,
  onDecided,
  onChanged,
}: {
  findings: CodeReviewFindingList | null;
  detail: CodeReviewDetail;
  seam: Seam | null;
  dark: boolean;
  onDecided: () => void;
  onChanged: () => void;
}) {
  const agent = detail.mode === CodeReviewMode.Agent;

  // The elevation half of the fused surface, as the web's ReviewPublishing
  // decides it: code no connected forge knows says why and stops here.
  const local = where(detail.target) === 'local workspace';

  if (!findings) return null;

  if (findings.consolidationDigest == null) {
    return (
      <Hint>
        {reviewIsActive(findings.state)
          ? 'Findings appear here once every candidate has been verified and the results consolidated.'
          : 'This review ended without consolidated findings.'}
      </Hint>
    );
  }

  if (findings.findings.length === 0) {
    return <Hint>No finding survived verification.</Hint>;
  }

  return (
    <View style={{ gap: 10 }}>
      {local ? (
        <>
          {findings.findings.map(finding => (
            <FindingCard
              key={finding.id}
              reviewId={findings.reviewId}
              digest={findings.consolidationDigest!}
              canDecide={findingsDecidable(findings)}
              finding={finding}
              seam={seam}
              agent={agent}
              dark={dark}
              onDecided={onDecided}
              place={null}
              checked={false}
              onToggle={() => {}}
            />
          ))}
          <View style={{ gap: 6 }}>
            <Meta>Elevating</Meta>
            <Hint>
              This review is of code in a local workspace that no connected forge knows, so there is nowhere to raise
              its findings. They stay here.
            </Hint>
          </View>
        </>
      ) : (
        <PublicationPanel
          reviewId={findings.reviewId}
          detail={detail}
          findings={findings}
          seam={seam}
          dark={dark}
          agent={agent}
          onDecided={onDecided}
          onChanged={onChanged}
        />
      )}
    </View>
  );
}

function FindingCard({
  reviewId,
  digest,
  canDecide,
  finding,
  seam,
  agent,
  dark,
  onDecided,
  place,
  checked,
  onToggle,
}: {
  reviewId: string;
  digest: string;
  canDecide: boolean;
  finding: CodeReviewFindingSummary;
  seam: Seam | null;
  agent: boolean;
  dark: boolean;
  onDecided: () => void;
  /** Where this finding would go if published; null while unknown or when the review cannot publish. */
  place: CodeReviewPublishableFinding | null;
  /** The publish checkbox rides on the card; the bar below collects them. */
  checked: boolean;
  onToggle: () => void;
}) {
  const { c } = useTheme();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [current, setCurrent] = useState(finding);
  const [detail, setDetail] = useState<CodeReviewFindingDetail | null>(null);
  const [diff, setDiff] = useState<CodeReviewFindingDiff | null>(null);
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  // The card is always open; the claim and the anchored lines are read once
  // on mount, like the web's FindingPanel does on first open — both requests
  // fired together.
  useEffect(() => {
    if (!seam) return;
    let done = false;
    void (async () => {
      try {
        const [d, dif] = await Promise.all([
          seam.reviewFinding(reviewId, finding.id),
          seam.reviewFindingDiff(reviewId, finding.id),
        ]);
        if (!done) {
          if (d !== null) setDetail(d);
          setDiff(dif);
        }
      } catch {
        if (!done) setMessage('Could not load this finding. Try again.');
      }
    })();
    return () => {
      done = true;
    };
  }, [seam, reviewId, finding.id]);

  const decide = useCallback(
    (disposition: CodeReviewFindingDisposition) => {
      if (!seam) return;
      setBusy(true);
      void (async () => {
        try {
          const seen = detail?.finding ?? current;
          const seenDigest = detail?.consolidationDigest ?? digest;
          const result = await seam.setFindingDisposition(reviewId, seen.id, {
            disposition,
            expectedVersion: seen.version,
            expectedConsolidationDigest: seenDigest,
          });
          setMessage(
            result === null
              ? 'Not saved: the review or finding is gone, or is not yours.'
              : decisionMessage(result.status),
          );
          // Every outcome but a clean write means our copy may be behind; a
          // clean write moved the version. Either way: read it again.
          const fresh = await seam.reviewFinding(reviewId, finding.id);
          if (!cancelled.current && fresh !== null) {
            setDetail(fresh);
            setCurrent(fresh.finding);
          }
          onDecided();
        } catch {
          setMessage('Not saved: the server could not be reached. Try again.');
        } finally {
          if (!cancelled.current) setBusy(false);
        }
      })();
    },
    [seam, reviewId, finding.id, detail, current, digest, onDecided],
  );

  const shown = detail?.finding ?? current;
  // The publish half of the fused card, as the web's PublicationSelect row
  // says it: where this finding would go, or why it cannot be raised.
  const ok = publishable(place);
  const publishNote =
    place?.publishedIn != null
      ? 'already published'
      : ok
      ? `${
          shown.provenance === CodeReviewFindingProvenance.AgentSession ? 'agent comment' : 'supported'
        } · ${placementLabel(place!.placement)}${shown.hasSuggestion ? ' · with suggestion' : ''}`
      : null;

  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: c.border,
        // The severity edge the web's ReviewCard draws with border-left.
        borderLeftWidth: 3,
        borderLeftColor: severityColor(shown.severity, c),
        overflow: 'hidden',
      }}
    >
      <View style={{ padding: 12, gap: 6 }}>
        <CardHeader
          rank={shown.rank}
          severity={shown.severity}
          title={shown.title}
          tags={cardTags(shown)}
        />
        <Mono numberOfLines={1} ellipsizeMode="head">
          {location(shown.path, shown.side, shown.startLine, shown.endLine)}
          {shown.inline ? '' : ' · summary-level'}
          {shown.reports > 1 ? ` · ${shown.reports} reports` : ''}
        </Mono>
        {shown.priorDisposition && shown.disposition === CodeReviewFindingDisposition.Open ? (
          <Mono>previously {dispositionLabel(shown.priorDisposition.disposition)}</Mono>
        ) : null}
        {/* Publishing rides here instead of a second card: the note the web's
            select row carries, and the checkbox itself. Refused findings say
            their refusal where the box would be. */}
        {place != null ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              borderTopWidth: 1,
              borderTopColor: c.border,
              paddingTop: 6,
            }}
          >
            {ok ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={`Publish ${shown.title}`}
                accessibilityState={{ checked, disabled: busy }}
                disabled={busy}
                onPress={onToggle}
                hitSlop={8}
                style={({ pressed }) => ({
                  width: 22,
                  height: 22,
                  borderRadius: radius.md,
                  borderWidth: 1.5,
                  borderColor: checked ? c.primary : c.mutedForeground,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: checked ? mix(c.primary, 14) : 'transparent',
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                {checked ? <Check color={c.primary} size={14} /> : null}
              </Pressable>
            ) : (
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: radius.md,
                  borderWidth: 1.5,
                  borderColor: c.border,
                }}
              />
            )}
            <Mono style={{ flex: 1, fontSize: 12 }} numberOfLines={2}>
              {publishNote ?? place.refusal ?? 'not publishable'}
            </Mono>
          </View>
        ) : null}
      </View>

      <View style={{ padding: 12, gap: 10, borderTopWidth: 1, borderTopColor: c.border }}>
          {/* The decision row: what it is now, and the moves from here. */}
          <View style={{ gap: 6 }}>
            <Mono>
              You: <Mono style={{ color: c.foreground }}>{dispositionLabel(shown.disposition)}</Mono>
            </Mono>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {shown.disposition !== CodeReviewFindingDisposition.Accepted ? (
                <Button
                  label="Accept"
                  variant="primary"
                  disabled={busy || !canDecide}
                  busy={busy}
                  onPress={() => decide(CodeReviewFindingDisposition.Accepted)}
                />
              ) : null}
              {shown.disposition !== CodeReviewFindingDisposition.Dismissed ? (
                <Button
                  label="Dismiss"
                  variant="outline"
                  disabled={busy || !canDecide}
                  busy={busy}
                  onPress={() => decide(CodeReviewFindingDisposition.Dismissed)}
                />
              ) : null}
              {shown.disposition !== CodeReviewFindingDisposition.Open ? (
                <Button
                  label="Reopen"
                  variant="ghost"
                  disabled={busy || !canDecide}
                  busy={busy}
                  onPress={() => decide(CodeReviewFindingDisposition.Open)}
                />
              ) : null}
            </View>
            {!canDecide ? (
              <Hint>This review no longer takes decisions: a newer head was captured, or the review did not finish.</Hint>
            ) : null}
            {message ? (
              <Problem>
                {message}
              </Problem>
            ) : null}
          </View>

          {detail === null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color={c.mutedForeground} />
              <Mono>loading the finding…</Mono>
            </View>
          ) : agent || detail.finding.provenance === CodeReviewFindingProvenance.AgentSession ? (
            <View style={{ gap: 8 }}>
              <AnchoredDiff diff={diff} dark={dark} />
              <Meta>Comment</Meta>
              <Body>{detail.badBehavior}</Body>
              {detail.suggestedRemediation.trim().length > 0 ? (
                <>
                  <Meta>Suggested fix</Meta>
                  <Body>{detail.suggestedRemediation}</Body>
                </>
              ) : null}
              {detail.suggestion != null ? (
                <>
                  <Meta>Suggested change</Meta>
                  {diff?.suggestion != null ? (
                    <SuggestionDiff suggestion={diff.suggestion} path={detail.finding.path} dark={dark} />
                  ) : (
                    <Hint>loading the suggestion…</Hint>
                  )}
                </>
              ) : null}
              <Hint>
                Written by an agent session. The server checked its anchor against the pinned commits; its claim was not independently verified, and it has no score.
              </Hint>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              <AnchoredDiff diff={diff} dark={dark} />
              <Meta>Claim</Meta>
              <Body>
                <Body style={{ color: c.foreground }}>When: </Body>
                {detail.trigger}
              </Body>
              <Body>
                <Body style={{ color: c.foreground }}>What goes wrong: </Body>
                {detail.badBehavior}
              </Body>
              <Body>
                <Body style={{ color: c.foreground }}>Why this change causes it: </Body>
                {detail.causalChange}
              </Body>
              {detail.suggestedRemediation.trim().length > 0 ? (
                <Body>
                  <Body style={{ color: c.foreground }}>Suggested fix: </Body>
                  {detail.suggestedRemediation}
                </Body>
              ) : null}
              <Meta>Verifier</Meta>
              <Body>
                <Body style={{ color: c.foreground }}>supported</Body>
                {' by an independent verifier.'}
              </Body>
              <Body>{detail.verifierRationale}</Body>
            </View>
          )}
      </View>
    </View>
  );
}

/**
 * One row of a finding's diff, at phone width: mark, the anchor side's line
 * number, the text. Added lines green, removed destructive, context muted;
 * the finding's own lines carry a background so they read as the subject.
 */
function DiffRow({ line, number, dark }: { line: { kind: CodeReviewDiffLineKind; text: string; textTruncated: boolean; anchored: boolean }; number: number | null; dark: boolean }) {
  const { c } = useTheme();
  const add = dark ? '#00d492' : '#009966';
  const mark = line.kind === CodeReviewDiffLineKind.Add ? '+' : line.kind === CodeReviewDiffLineKind.Delete ? '−' : ' ';
  const color =
    line.kind === CodeReviewDiffLineKind.Add
      ? add
      : line.kind === CodeReviewDiffLineKind.Delete
      ? c.destructive
      : c.mutedForeground;
  const background =
    line.kind === CodeReviewDiffLineKind.Add
      ? mix(add, dark ? 10 : 7)
      : line.kind === CodeReviewDiffLineKind.Delete
      ? mix(c.destructive, dark ? 10 : 6)
      : line.anchored
      ? mix(c.muted, 55)
      : 'transparent';
  return (
    <View style={{ flexDirection: 'row', backgroundColor: background, paddingLeft: 6 }}>
      <Mono style={{ width: 12, color }}>{mark}</Mono>
      <Mono style={{ width: 38, color: c.mutedForeground }}>{number ?? ''}</Mono>
      <Mono style={{ flex: 1, color: line.kind === CodeReviewDiffLineKind.Context ? c.mutedForeground : c.foreground }} selectable>
        {line.text}
        {line.textTruncated ? ' …' : ''}
      </Mono>
    </View>
  );
}

/**
 * A finding's anchored lines with context, as the server read them from the
 * pinned commits — the web's AnchoredDiff, degraded honestly for phone width:
 * one line number (the anchor side's), no old/new pair. Nothing is parsed
 * here; each line arrives typed.
 */
export function AnchoredDiff({ diff, dark }: { diff: CodeReviewFindingDiff | null; dark: boolean }) {
  const { c } = useTheme();
  if (diff == null) return <Hint>loading the anchored lines…</Hint>;
  if (diff.status === CodeReviewFindingDiffStatus.ContentUnavailable) {
    return (
      <Hint>
        The review’s pinned copy of the code is no longer cached on the server, so the anchored lines can’t be
        shown. The location is {location(diff.path, diff.side, diff.startLine, diff.endLine)}.
      </Hint>
    );
  }
  if (diff.status === CodeReviewFindingDiffStatus.AnchorMismatch) {
    return (
      <Hint>
        The pinned code no longer matches what this finding anchored, so no lines are shown rather than the wrong
        ones.
      </Hint>
    );
  }
  let previous: number | null = null;
  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingVertical: 4,
          paddingHorizontal: 8,
          borderTopWidth: 0,
        }}
      >
        <Mono numberOfLines={1} ellipsizeMode="head" style={{ flex: 1, color: c.foreground }}>
          {diff.path}
        </Mono>
        <Mono>
          {shortSha(diff.fromSha)} → {shortSha(diff.headSha)}
        </Mono>
      </View>
      {diff.lines.map((line, i) => {
        const number = diff.side === 0 ? line.newLine : line.oldLine;
        const gap =
          previous != null && number != null && number > previous + 1 ? (
            <View key={`gap-${i}`} style={{ paddingVertical: 2, paddingLeft: 8 }}>
              <Mono>…</Mono>
            </View>
          ) : null;
        if (number != null) previous = number;
        return (
          <React.Fragment key={line.kind + String(i)}>
            {gap}
            <DiffRow line={line} number={number} dark={dark} />
          </React.Fragment>
        );
      })}
      {diff.truncated ? (
        <View style={{ paddingVertical: 2, paddingLeft: 8 }}>
          <Mono>more lines not shown</Mono>
        </View>
      ) : null}
    </View>
  );
}

/**
 * An agent comment's suggested replacement, as the server diffed it: the same
 * rows, no captioned pair — "before → after" in the header says it.
 */
export function SuggestionDiff({ suggestion, path, dark }: { suggestion: CodeReviewFindingSuggestion; path: string; dark: boolean }) {
  const { c } = useTheme();
  if (suggestion.status === CodeReviewSuggestionStatus.ContentUnavailable) {
    return (
      <Hint>
        The review’s pinned copy of the code is no longer cached on the server, so the suggestion can’t be shown
        against the lines it replaces.
      </Hint>
    );
  }
  if (suggestion.status === CodeReviewSuggestionStatus.BaseMismatch) {
    return (
      <Hint>
        The pinned code no longer matches the lines this suggestion was written against, so it is not shown and
        will not be published.
      </Hint>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 8 }}>
          <Mono numberOfLines={1} ellipsizeMode="head" style={{ flex: 1, color: c.foreground }}>
            {path}
          </Mono>
          <Mono>before → after</Mono>
        </View>
        {suggestion.lines.map((line, i) => (
          <DiffRow
            key={String(i)}
            line={{ kind: line.kind, text: line.text, textTruncated: line.textTruncated, anchored: false }}
            number={line.newLine ?? line.oldLine}
            dark={dark}
          />
        ))}
        {!suggestion.lines.some(l => l.kind === CodeReviewDiffLineKind.Add) ? (
          <View style={{ paddingVertical: 2, paddingLeft: 8 }}>
            <Mono>the suggestion deletes these lines</Mono>
          </View>
        ) : null}
      </View>
      <Hint>
        {suggestion.applicable
          ? 'Published as a GitHub suggestion, which can be applied from the pull request.'
          : 'Forgejo can’t apply suggestions: it is published as a plain “suggested replacement” block to copy by hand.'}
        {' An agent wrote it; it was not tested or verified.'}
      </Hint>
    </View>
  );
}

function severityName(severity: number): string {
  switch (severity) {
    case 0:
      return 'P0';
    case 1:
      return 'P1';
    case 2:
      return 'P2';
    default:
      return 'P3';
  }
}
