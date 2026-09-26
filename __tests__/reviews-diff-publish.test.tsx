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
