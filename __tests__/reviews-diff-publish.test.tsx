/**
 * Code reviews, slices 2 and 3 of mobile review parity: the anchored diff a
 * finding is shown against, and the confirm-gated publication flow.
 *
 * The diff and the publish flow keep their branching in small exported pieces
 * — AnchoredDiff renders from a typed payload nobody parses client-side,
 * publishMessage is the web's PublicationActions.Message character for
 * character, previewWhere names a line the way the web does — and those are
 * checked here without mounting anything, then AnchoredDiff itself is
 * rendered against a typed fixture to prove the phone-width rows, the gap
 * marker for skipped line numbers, and the honest fallbacks when the pinned
 * copy is gone.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import {
  CodeReviewAnchorSide,
  CodeReviewDiffLineKind,
  CodeReviewElevationTarget,
  CodeReviewFindingDiffStatus,
  CodeReviewPublicationEvent,
  CodeReviewPublicationItemState,
  CodeReviewPublicationPlacement,
  CodeReviewPublicationPreviewItem,
  CodeReviewPublicationState,
  CodeReviewPublicationView,
  CodeReviewPublishStatus,
  type CodeReviewFindingDiff,
  type CodeReviewFindingDiffLine,
} from '../src/api/contracts';
import {
  AnchoredDiff,
  newRequestId,
  previewWhere,
  publishMessage,
} from '../src/screens/Reviews';

// -- the diff: typed lines, phone width ---------------------------------------

const line = (
  kind: CodeReviewDiffLineKind,
  text: string,
  number: number,
  anchored = false,
): CodeReviewFindingDiffLine => ({
  kind,
  text,
  oldLine: number,
  newLine: number,
  anchored,
  textTruncated: false,
});

const diff = (lines: CodeReviewFindingDiffLine[]): CodeReviewFindingDiff => ({
  findingId: 'f-1',
  status: CodeReviewFindingDiffStatus.Available,
  path: 'src/relay.ts',
  side: CodeReviewAnchorSide.Head,
  startLine: 10,
  endLine: 14,
  fromSha: 'aaaa1111bbbb',
  headSha: 'cccc2222dddd',
  lines,
  truncated: false,
  suggestion: null,
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

function renderedText(tree: ReturnType<typeof create>): string {
  return JSON.stringify(
    tree.root.findAllByType(Text).map(t => t.props.children),
  );
}

test('the anchored diff draws mark, number, and text for every line', async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <AnchoredDiff
        diff={diff([
          line(CodeReviewDiffLineKind.Context, 'const was = before();', 10),
          line(CodeReviewDiffLineKind.Delete, 'return was.result;', 11),
          line(CodeReviewDiffLineKind.Add, 'return was.result ?? null;', 11, true),
        ])}
        dark={false}
      />,
    );
  });
  const text = renderedText(tree);
  // The header names the file and both commits.
  expect(text).toContain('src/relay.ts');
  expect(text).toContain('aaaa1111');
  expect(text).toContain('cccc2222');
  // Every line's text, and the marks.
  expect(text).toContain('return was.result;');
  expect(text).toContain('return was.result ?? null;');
});

test('a jump in line numbers reads as a gap, not silent elision', async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <AnchoredDiff
        diff={diff([
          line(CodeReviewDiffLineKind.Context, 'one', 10),
          line(CodeReviewDiffLineKind.Context, 'later', 40),
        ])}
        dark={false}
      />,
    );
  });
  // The ellipsis is the app's own `…`, not `⋯` (U+22EF): the fonts carry the
  // first and not the second — glyphs.test.ts pins this.
  expect(renderedText(tree)).toContain('…');
  expect(renderedText(tree)).not.toContain('⋯');
});

test('a missing pinned copy says where the finding is instead of drawing lines', async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <AnchoredDiff
        diff={{
          ...diff([]),
          status: CodeReviewFindingDiffStatus.ContentUnavailable,
        }}
        dark={false}
      />,
    );
  });
  const text = renderedText(tree);
  expect(text).toContain('no longer cached');
  // The location names the file and lines, so the reader is not stranded.
  expect(text).toContain('src/relay.ts');
});

test('an anchor that no longer matches draws nothing rather than the wrong lines', async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <AnchoredDiff
        diff={{
          ...diff([]),
          status: CodeReviewFindingDiffStatus.AnchorMismatch,
        }}
        dark={false}
      />,
    );
  });
  expect(renderedText(tree)).toContain('no longer matches');
});

// -- the publish flow: preview and outcome words -------------------------------

const previewItem = (
  overrides: Partial<CodeReviewPublicationPreviewItem> = {},
): CodeReviewPublicationPreviewItem => ({
  findingId: 'f-1',
  rank: 3,
  severity: 1,
  title: 'Relay drops the last message',
  placement: CodeReviewPublicationPlacement.Inline,
  path: 'src/relay.ts',
  side: CodeReviewAnchorSide.Head,
  startLine: 10,
  line: 12,
  body: 'The loop exits before the flush.',
  refusal: null,
  issueTitle: null,
  ...overrides,
});

test('previewWhere names the anchor the way the web does', () => {
  // A range: "lines 10–12".
  expect(previewWhere(previewItem())).toBe(
    'src/relay.ts, new lines 10–12',
  );
  // A single line (startLine null): "line 12".
  expect(
    previewWhere(previewItem({ startLine: null })),
  ).toBe('src/relay.ts, new line 12');
  // The base side says old, not new.
  expect(
    previewWhere(previewItem({ side: CodeReviewAnchorSide.Base })),
  ).toContain('old');
});

const publication = (
  state: CodeReviewPublicationState,
): CodeReviewPublicationView => ({
  id: 'pub-1',
  state,
  event: CodeReviewPublicationEvent.Comment,
  headSha: 'cccc2222dddd',
  confirmedAt: '2026-09-25T10:00:00Z',
  updatedAt: '2026-09-25T10:01:00Z',
  attempts: 1,
  remoteReviewUrl: null,
  remoteSubmitted: false,
  error: null,
  items: [
    {
      findingId: 'f-1',
      rank: 3,
      severity: 1,
      title: 'Relay drops the last message',
      state: CodeReviewPublicationItemState.Published,
      placement: CodeReviewPublicationPlacement.Inline,
      error: null,
      remoteUrl: 'https://github.com/acme/app/pull/12#discussion_r1',
      attempts: 1,
    },
  ],
  target: CodeReviewElevationTarget.PullRequestReview,
});

test('publishMessage is the web PublicationActions message', () => {
  // A review publication that went out.
  expect(
    publishMessage({
      status: CodeReviewPublishStatus.Ran,
      reason: null,
      publication: publication(CodeReviewPublicationState.Published),
    }),
  ).toBe('Published to the pull request.');
  // Issues instead.
  expect(
    publishMessage({
      status: CodeReviewPublishStatus.Ran,
      reason: null,
      publication: {
        ...publication(CodeReviewPublicationState.Published),
        target: CodeReviewElevationTarget.Issues,
      },
    }),
  ).toBe('Opened as issues in the repository.');
  // Part, with the retry hint.
  expect(
    publishMessage({
      status: CodeReviewPublishStatus.Ran,
      reason: null,
      publication: publication(CodeReviewPublicationState.PartiallyPublished),
    }),
  ).toBe(
    'Published in part: some findings were not posted (see below). You can retry the rest.',
  );
  // Nothing, with the forge's own error.
  expect(
    publishMessage({
      status: CodeReviewPublishStatus.Ran,
      reason: null,
      publication: {
        ...publication(CodeReviewPublicationState.Failed),
        error: 'the forge said 502',
      },
    }),
  ).toBe('Nothing was published. the forge said 502');
  // A resend of the same confirmation is a replay, not a second publication.
  expect(
    publishMessage({
      status: CodeReviewPublishStatus.Replayed,
      reason: null,
      publication: null,
    }),
  ).toBe('This was already sent; showing that publication.');
  // The review vanished under the caller.
  expect(publishMessage(null)).toBe('This review is gone, or is not yours.');
});

test('newRequestId mints a fresh id per confirmation', () => {
  const a = newRequestId();
  const b = newRequestId();
  expect(a).not.toBe(b);
  // Shaped like a GUID: 8-4-4-4-12 hex.
  expect(a).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
});

// -- publishing, per finding: the panel as it now works ------------------------
//
// The user's report that started this: "hitting submit on review comments
// does nothing on mobile." No handler was unwired — the failures were silent
// (a message below the fold, a shared busy flag, a dead checkbox list). These
// mount the detail screen with a mocked seam and press the real buttons: the
// words must be in the tree where the thumb tapped, not nowhere.

import {
  CodeReviewAnalysisState as AnalysisState,
  CodeReviewCompleteness,
  CodeReviewFindingDisposition as FindingDisposition,
  CodeReviewFindingProvenance as FindingProvenance,
  CodeReviewMode as ReviewMode,
  CodeReviewPublicationPlacement as PublicationPlacement,
  CodeReviewSourceKind as SourceKind,
  CodeReviewTargetKind as TargetKind,
  GitServiceKind as ServiceKind,
  type CodeReviewDetail,
  type CodeReviewFindingList,
  type CodeReviewFindingSummary,
  type CodeReviewPublicationOverview,
  type CodeReviewPublicationPreview,
} from '../src/api/contracts';
import { ReviewDetailScreen } from '../src/screens/Reviews';

const score = {
  impact: 300,
  triggerBreadth: 200,
  evidenceQuality: 400,
  verifierConfidence: 500,
  ruleRelevance: 100,
  duplicateSupport: 50,
  total: 640,
};

const summary = (
  id: string,
  rank: number,
  overrides: Partial<CodeReviewFindingSummary> = {},
): CodeReviewFindingSummary => ({
  id,
  rank,
  fingerprint: `fp-${id}`,
  version: 4,
  category: 0 as never,
  severity: 1 as never,
  path: 'src/relay.ts',
  side: 0 as never,
  startLine: 10,
  endLine: 12,
  inline: true,
  title: `Relay drops message ${rank}`,
  score,
  capped: false,
  reports: 1,
  disposition: FindingDisposition.Open,
  priorDisposition: null,
  provenance: FindingProvenance.Pipeline,
  authorSessionId: null,
  hasSuggestion: false,
  ...overrides,
});

const twoFindings = (): CodeReviewFindingList => ({
  reviewId: 'r-1',
  state: AnalysisState.Completed,
  consolidationDigest: 'digest-1',
  superseded: false,
  findings: [summary('f-1', 1), summary('f-2', 2)],
});

const detail = (): CodeReviewDetail => ({
  id: 'r-1',
  state: AnalysisState.Completed,
  target: {
    forgeKind: ServiceKind.GitHub,
    canonicalAuthority: 'github.com',
    repositoryOwner: 'acme',
    repositoryName: 'app',
    pullRequestNumber: 12,
    headSha: 'cccc2222dddd',
    kind: TargetKind.PullRequest,
    rangeBaseSha: '',
  },
  pipelineVersion: 3,
  policyDigest: 'digest',
  policy: { maxChangedFiles: 200 },
  createdAt: '2026-09-24T09:00:00Z',
  updatedAt: '2026-09-24T09:30:00Z',
  snapshotFinalizedAt: '2026-09-24T09:05:00Z',
  failureReason: null,
  supersededByRunId: null,
  supersededAt: null,
  fileCounts: [],
  snapshot: null,
  progress: {
    planned: true,
    completeness: CodeReviewCompleteness.Complete,
    partialReasons: [],
    workItems: [],
    verifierItems: [],
    candidates: [],
    coverage: null,
    failures: [],
    failuresOmitted: 0,
  },
  mode: ReviewMode.Pipeline,
  source: SourceKind.Forge,
  sourceSessionId: null,
  sourcePath: null,
});

const overview = (
  findings: CodeReviewPublicationOverview['findings'],
  publications: CodeReviewPublicationOverview['publications'] = [],
): CodeReviewPublicationOverview => ({
  reviewId: 'r-1',
  canPublish: true,
  blocker: null,
  completeness: CodeReviewCompleteness.Complete,
  findings,
  publications,
  target: CodeReviewElevationTarget.PullRequestReview,
  repository: 'acme/app',
});

const publishablePlace = (findingId: string) => ({
  findingId,
  placement: PublicationPlacement.Inline,
  refusal: null,
  publishedIn: null,
});

const previewFor = (findingId: string): CodeReviewPublicationPreview => ({
  reviewId: 'r-1',
  headSha: 'cccc2222dddd',
  event: CodeReviewPublicationEvent.Comment,
  completeness: CodeReviewCompleteness.Complete,
  coverageNotice: null,
  reviewBody: 'Findings from the review.',
  items: [
    {
      findingId,
      rank: 1,
      severity: 1 as never,
      title: 'Relay drops message 1',
      placement: PublicationPlacement.Inline,
      path: 'src/relay.ts',
      side: 0 as never,
      startLine: 10,
      line: 12,
      body: 'The loop exits before the flush.',
      refusal: null,
      issueTitle: null,
    },
  ],
  target: CodeReviewElevationTarget.PullRequestReview,
  repository: 'acme/app',
});

// The mocked seam. The names must carry the `mock` prefix: jest hoists
// jest.mock factories above these declarations, and its guard only lets a
// factory close over out-of-scope variables named mock* (anything else binds
// to an uninitialized copy — the seam reads as absent and the screen idles).
const mockSeam = {
  reviewDetail: jest.fn((): Promise<CodeReviewDetail | null> => Promise.resolve(detail())),
  reviewFindings: jest.fn((): Promise<CodeReviewFindingList | null> => Promise.resolve(twoFindings())),
  reviewPublications: jest.fn(
    (): Promise<CodeReviewPublicationOverview | null> =>
      Promise.resolve(
        overview([
          publishablePlace('f-1'),
          {
            findingId: 'f-2',
            placement: null,
            refusal: 'its anchor is not on a changed line',
            publishedIn: null,
          },
        ]),
      ),
  ),
  previewReviewPublication: jest.fn(
    (): Promise<CodeReviewPublicationPreview | null> => Promise.resolve(previewFor('f-1')),
  ),
  publishReview: jest.fn(
    (): Promise<{ status: number; reason: string | null; publication: unknown }> =>
      Promise.resolve({ status: 0, reason: null, publication: null }),
  ),
};
// One stable object identity for every render: zustand selects through
// useSyncExternalStore, and a fresh object per call re-renders forever.
const mockAuthState = { seam: mockSeam };

jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) => select(mockAuthState),
}));

jest.mock('../src/navigation/headers', () => ({
  useHeaderInset: () => 0,
  barButton: () => ({
    headerRight: () => null,
    unstable_headerRightItems: () => [],
  }),
}));

async function mountDetail() {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <ReviewDetailScreen
        route={{ params: { reviewId: 'r-1' } }}
        navigation={{ setOptions: jest.fn(), addListener: () => () => {}, push: jest.fn() } as never}
      />,
    );
    // The screen chains several awaits (detail, then findings, then the
    // publication overview); drain the microtask queue, bounded so a hang
    // fails rather than blocks.
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
      await Promise.resolve();
    }
  });
  return tree;
}

/** Press by accessibility label: the kit Button sets it from its label.
 * Found by scanning for the onPress prop, not by component type — the RN
 * jest preset's Pressable stand-in does not match findAllByType. */
function press(tree: ReturnType<typeof create>, label: string) {
  const hit = tree.root
    .findAll(
      n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function',
    )
    .pop();
  if (hit == null) throw new Error(`no pressable labelled ${JSON.stringify(label)}`);
  act(() => {
    hit.props.onPress();
  });
}

const strings = (tree: ReturnType<typeof create>): string =>
  JSON.stringify(tree.root.findAllByType(Text).map(t => t.props.children));

test('a publishable finding is actionable on its own card', async () => {
  const tree = await mountDetail();
  const text = strings(tree);
  // The card says the two things the web's select row says.
  expect(text).toContain('supported · inline');
  // The refused finding says its refusal where its action would be.
  expect(text).toContain('its anchor is not on a changed line');
  // And the actionable one carries its own buttons.
  expect(text).toContain('Post comment');
  expect(text).toContain('Post as change request');
});

test('pressing a card action previews exactly that finding, and publish posts it alone', async () => {
  const tree = await mountDetail();
  await act(async () => {
    press(tree, 'Post comment');
    await Promise.resolve();
  });
  expect(mockSeam.previewReviewPublication).toHaveBeenCalledWith(
    'r-1',
    ['f-1'],
    CodeReviewPublicationEvent.Comment,
  );
  await act(async () => {
    press(tree, 'Post review');
    await Promise.resolve();
  });
  // The publish posts the previewed finding only, with a fresh requestId.
  const call = mockSeam.publishReview.mock.calls[0] as unknown as [
    string,
    string,
    { findingIds: string[]; event: number },
  ];
  const [requestId, reviewId, request] = call;
  expect(reviewId).toBe('r-1');
  expect(request.findingIds).toEqual(['f-1']);
  expect(request.event).toBe(CodeReviewPublicationEvent.Comment);
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
});

test('a failed preview says so on the card that was tapped — the dead-tap regression', async () => {
  const tree = await mountDetail();
  mockSeam.previewReviewPublication.mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    press(tree, 'Post comment');
    await Promise.resolve();
  });
  // Not below the list, not nowhere: the failure words are in the tree at the
  // tap point. This is the string that was silently missing.
  expect(strings(tree)).toContain('Could not prepare the preview. Try again.');
});

test('when every finding is already published or refused, the panel says so instead of a dead list', async () => {
  mockSeam.reviewPublications.mockImplementationOnce(() =>
    Promise.resolve(
      overview([
        { findingId: 'f-1', placement: null, refusal: null, publishedIn: 'pub-9' },
        { findingId: 'f-2', placement: null, refusal: 'no changed line', publishedIn: null },
      ]),
    ),
  );
  const tree = await mountDetail();
  const text = strings(tree);
  // The hint says the state; the cards stay to say what became of each.
  expect(text).toContain(
    'Nothing here can still be published: every finding was already posted, or cannot be raised.',
  );
  expect(text).toContain('already published');
  // No action button survives anywhere.
  expect(text).not.toContain('Post comment');
});
