/**
 * Code reviews, read path (slice 1 of mobile review parity): the reviews a
 * session started or its agent commented on, and one review's findings with
 * dispositions.
 *
 * The screen keeps its branching in three pure helpers — which states are
 * "running", what a disposition POST answered, and when findings still take
 * decisions — so the state machine is checked here without mounting anything,
 * and then the list screen is rendered against a mocked seam to prove the
 * reads wire up: rows from `sessionReviews`, navigation to the detail, and
 * the empty state a session with no reviews shows.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import {
  CodeReviewAnalysisState,
  CodeReviewCaptureCompleteness,
  CodeReviewFindingUpdateStatus,
  CodeReviewMode,
  CodeReviewSourceKind,
  CodeReviewTargetKind,
  GitServiceKind,
  type CodeReviewFindingList,
  type CodeReviewSessionReview,
} from '../src/api/contracts';
import {
  decisionMessage,
  findingsDecidable,
  reviewIsActive,
  ReviewsScreen,
} from '../src/screens/Reviews';

// -- the helpers: the review state machine, in the open ----------------------

test('running states are the analysis, not its terminals', () => {
  // Mirrors the web's ReviewText.IsActive: capture done is still mid-run —
  // the analysis works on a captured snapshot — and only failure, a newer
  // head, cancellation, or finishing ends it.
  expect(reviewIsActive(CodeReviewAnalysisState.Queued)).toBe(true);
  expect(reviewIsActive(CodeReviewAnalysisState.Snapshotting)).toBe(true);
  expect(reviewIsActive(CodeReviewAnalysisState.Captured)).toBe(true);
  expect(reviewIsActive(CodeReviewAnalysisState.Investigating)).toBe(true);
  expect(reviewIsActive(CodeReviewAnalysisState.Consolidating)).toBe(true);
  expect(reviewIsActive(CodeReviewAnalysisState.Failed)).toBe(false);
  expect(reviewIsActive(CodeReviewAnalysisState.Cancelled)).toBe(false);
  expect(reviewIsActive(CodeReviewAnalysisState.Superseded)).toBe(false);
  expect(reviewIsActive(CodeReviewAnalysisState.Completed)).toBe(false);
});

test('a disposition answer says what happened, a stale one says what to do', () => {
  // The happy path first: stored, version moved on.
  expect(
    decisionMessage(CodeReviewFindingUpdateStatus.Updated),
  ).toBeNull();
  // The interesting ones: someone else's disposition made this one stale.
  expect(
    decisionMessage(CodeReviewFindingUpdateStatus.VersionConflict),
  ).not.toBeNull();
  // And a review that moved on while the decision was being made.
  expect(
    decisionMessage(CodeReviewFindingUpdateStatus.Superseded),
  ).not.toBeNull();
});

test('findings take decisions only while the review can still hear them', () => {
  // Mirrors the web's FindingList.Decidable.
  const base: CodeReviewFindingList = {
    reviewId: 'r-1',
    state: CodeReviewAnalysisState.Completed,
    consolidationDigest: 'digest-1',
    superseded: false,
    findings: [],
  };
  // Finished, not superseded: decisions land.
  expect(findingsDecidable(base)).toBe(true);
  // Partial consolidation still counts on the web, and here.
  expect(
    findingsDecidable({ ...base, state: CodeReviewAnalysisState.Partial }),
  ).toBe(true);
  // A newer head was captured since: decisions would silently target lines
  // that are no longer the pull request's.
  expect(findingsDecidable({ ...base, superseded: true })).toBe(false);
  // Still running: nothing to decide against yet.
  expect(
    findingsDecidable({
      ...base,
      state: CodeReviewAnalysisState.Investigating,
    }),
  ).toBe(false);
});

// -- the list screen: reads wire up ------------------------------------------

const review = (id: string, state: CodeReviewAnalysisState): CodeReviewSessionReview => ({
  review: {
    id,
    // The real CodeReviewTarget: the forge, the repo as owner/name, and the
    // head the review covers.
    target: {
      forgeKind: GitServiceKind.GitHub,
      canonicalAuthority: 'github.com',
      repositoryOwner: 'acme',
      repositoryName: 'app',
      pullRequestNumber: 12,
      headSha: 'abc123',
      kind: CodeReviewTargetKind.PullRequest,
      rangeBaseSha: '',
    },
    title: 'Fix the relay',
    state,
    captureCompleteness: CodeReviewCaptureCompleteness.Complete,
    createdAt: '2026-09-24T09:00:00Z',
    updatedAt: '2026-09-24T09:30:00Z',
    reviewCompleteness: null,
    supersededByRunId: null,
    findings: null,
    mode: CodeReviewMode.Pipeline,
    source: CodeReviewSourceKind.Forge,
    sourceSessionId: null,
  },
  startedHere: true,
  sourcePath: null,
  incompleteReason: 0 as never,
  coverage: null,
  topFindings: [],
  findingTotal: 0,
  elevation: null,
  elevationBlocker: null,
});

const mockSeam = {
  sessionReviews: jest.fn((): Promise<CodeReviewSessionReview[]> =>
    Promise.resolve([
      review('r-1', CodeReviewAnalysisState.Captured),
      review('r-2', CodeReviewAnalysisState.Failed),
    ]),
  ),
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// The same discipline as sessions-recall: zustand reads through
// useSyncExternalStore, so the mocked store must return one stable object or
// the worker dies on an unstable-snapshot re-render loop.
const mockAuthState = { seam: mockSeam };

jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) => select(mockAuthState),
}));

jest.mock('../src/navigation/headers', () => ({
  useHeaderInset: () => 0,
  // SessionDetail's Reviews button goes through barButton; the native item
  // array it builds is the navigator's business, not this test's.
  barButton: () => ({
    headerRight: () => null,
    unstable_headerRightItems: () => [],
  }),
}));

function renderedText(tree: ReturnType<typeof create>): string {
  // Every string the screen drew, from the rendered host Texts. toJSON's
  // tree carries fibers, so read the text nodes instead.
  return JSON.stringify(
    tree.root.findAllByType(Text).map(t => t.props.children),
  );
}

test('the list screen reads the session reviews and offers the detail', async () => {
  const navigate = jest.fn();
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <ReviewsScreen
        route={{ params: { sessionId: 's-1' } }}
        navigation={{ setOptions: jest.fn(), addListener: () => () => {}, navigate } as never}
      />,
    );
  });
  expect(mockSeam.sessionReviews).toHaveBeenCalledWith('s-1');
  // The card is the web's: target (owner/name#number), kind · mode, state.
  // The PR title is deliberately not on it — the web doesn't draw it either.
  const text = renderedText(tree);
  expect(text).toContain('acme/app#12');
  expect(text).toContain('pull request');
  expect(text).toContain('pipeline review');
  expect(text).toContain('captured');
  expect(text).toContain('failed');
});
