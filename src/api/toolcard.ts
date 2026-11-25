/**
 * Turning a tool call into something readable, ported from
 * `SlopCoder.Contracts/Presentation/{ToolCard,ToolCards,LineDiff,UnifiedDiff}.cs`.
 *
 * The vocabulary is closed: the renderer switches over *blocks*, never over tool
 * names, so teaching the transcript about a new tool is an entry in the table
 * below and no renderer change at all.
 *
 * Pure and total. A malformed input, an unknown tool, an empty string all fall
 * through to `fallback` rather than throwing — a transcript rendering a thousand
 * events must never be one bad payload away from a blank screen.
 *
 * The fallback matters most, and on the phone more than anywhere. Every MCP tool
 * arrives as `mcp__<server>__<tool>` with a schema nobody here has seen, and an
 * app that shipped through the App Store is always older than the server it is
 * talking to, so tools added since the last release look exactly the same way to
 * it. Those all have to read as something better than JSON with nobody having
 * written a line for them.
 *
 * Held to the C# by `__tests__/toolcard.test.ts`, which replays
 * `__tests__/fixtures/tool-cards.json` — a byte-identical copy of the file the
 * server's own suite replays. Two clients disagreeing about what a tool call
 * looks like is the exact bug cards exist to prevent.
 */

export type SubjectStyle = 'plain' | 'path' | 'command' | 'url';
export type TextTone = 'plain' | 'muted' | 'error';
export type DiffKind = 'context' | 'add' | 'remove' | 'hunk';

export interface DiffLine {
  kind: DiffKind;
  text: string;
  oldNumber: number | null;
  newNumber: number | null;
}

export interface ListEntry {
  text: string;
  detail: string | null;
}

export interface CardPair {
  key: string;
  value: string;
}

interface BlockBase {
  label: string | null;
  /** Shown without a tap. Diffs and failures set it; nothing else does. */
  open: boolean;
}

export type ToolBlock =
  | (BlockBase & { type: 'text'; tone: TextTone; text: string })
  | (BlockBase & { type: 'code'; language: string | null; text: string })
  | (BlockBase & { type: 'diff'; lines: DiffLine[] })
  | (BlockBase & { type: 'list'; entries: ListEntry[] })
  | (BlockBase & { type: 'pairs'; pairs: CardPair[] })
  /**
   * A published artifact, as the thing itself rather than as a sentence about
   * it. Carries an id rather than a URL: the phone opens its own screen, the
   * cockpit navigates its own route, and neither is told by the server how its
   * own links are spelled. A null id is a call that has not run yet.
   */
  | (BlockBase & {
      type: 'artifact';
      /** The artifact's own name: its slug, not the prose title. */
      name: string;
      /** How to say the format to a person — "Markdown", "PDF". */
      kind: string;
      size: string | null;
      artifactId: string | null;
    })
  /**
   * A look at a 3D scene: the picture the agent was handed, at the revision it
   * shows. Ids rather than URLs, like `artifact`. A null `renderId` is a call
   * with no picture kept, and the block then says which scene without one.
   */
  | (BlockBase & {
      type: 'scene';
      /** The scene document's workspace path, as the agent wrote it. */
      scene: string;
      revision: number | null;
      renderId: string | null;
    })
  /**
   * A picture a tool returned, kept by the server with the transcript and
   * fetched from `/tool-images/{imageId}` with the device's key.
   */
  | (BlockBase & {
      type: 'image';
      imageId: string;
      /** `image/png` and the like. */
      mediaType: string;
      /** "182 KB". */
      size: string;
    });

/** A picture the server kept from a tool result (`ToolCallFinished.images`). */
export interface ToolResultImage {
  id: string;
  mediaType: string;
  /** Bytes. */
  size: number;
}

export interface ToolCard {
  verb: string;
  subject: string | null;
  /**
   * What the caller said the call is for — Claude Code writes one on every
   * shell command. When present the header reads this instead of verb and
   * subject: "Check the build script's flags" says more on one line than
   * "Bash cd /repo && sed -n 1,130p …" cut off at the screen's edge. The
   * command is then the card's first block, a tap away.
   */
  title?: string;
  subjectStyle: SubjectStyle;
  facets: string[];
  blocks: ToolBlock[];
  /**
   * This card *is* its content: render the blocks and no header row. For the
   * one call whose result is an object rather than an account of itself —
   * publishing an artifact. A call that failed, or has not finished, is never
   * bare: then there is an account to give, and it needs its mark and its verb.
   */
  bare?: boolean;
  /**
   * What a file read returned, for the peek sheet: the path it came from and
   * the text exactly as the model saw it. Present only on a successful text
   * read; the card's code block carries the same text for the inline preview.
   */
  peek?: FilePeek;
}

export interface FilePeek {
  path: string;
  text: string;
  /** "182 lines", "from 40", "limit 20" — the header's chips, repeated in the sheet. */
  facets: string[];
}

/** Short scalars promoted to header chips before the rest fall to a pairs block. */
const MAX_FACETS = 4;
/** Longest value that still reads as a chip rather than as content. */
const MAX_FACET_LENGTH = 24;
/** Longest single-line value that belongs in a pairs table rather than its own block. */
const MAX_PAIR_LENGTH = 200;
/** Per-side line cap for the quadratic pass, after prefix/suffix trimming. */
const MAX_LCS_LINES = 600;
/** Unchanged lines kept either side of a change. */
const DIFF_CONTEXT = 3;

// ---------------------------------------------------------------- line diffs

export function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.replace(/\r\n/g, '\n').split('\n');
}

/**
 * A line diff, for the tools that hand us a before and an after but no diff.
 *
 * Common prefix and suffix are trimmed before the quadratic part runs, which is
 * what makes it affordable: a real edit is a small change inside a larger block,
 * so the LCS almost never sees more than a few dozen lines.
 *
 * `numbered` is false for `edit_file`, whose strings are fragments of a file
 * rather than the file — numbering a fragment from 1 states a position that is
 * not where the change is.
 */
export function lineDiff(
  oldText: string,
  newText: string,
  numbered = true,
  context = DIFF_CONTEXT,
): DiffLine[] {
  return elide(
    align(splitLines(oldText), splitLines(newText), numbered),
    context,
  );
}

/**
 * Every line as an addition — a file that did not exist before. The final
 * newline is dropped rather than counted, so a well-formed file does not end on
 * a phantom blank line the editor never showed.
 */
export function allAdded(text: string, numbered = true): DiffLine[] {
  return splitLines(text.endsWith('\n') ? text.slice(0, -1) : text).map(
    (line, index) => diffLine('add', line, null, numbered ? index + 1 : null),
  );
}

function diffLine(
  kind: DiffKind,
  text: string,
  oldNumber: number | null = null,
  newNumber: number | null = null,
): DiffLine {
  return { kind, text, oldNumber, newNumber };
}

function align(
  oldLines: string[],
  newLines: string[],
  numbered: boolean,
): DiffLine[] {
  const result: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;

  let head = 0;
  while (
    head < oldLines.length &&
    head < newLines.length &&
    oldLines[head] === newLines[head]
  ) {
    result.push(
      diffLine(
        'context',
        oldLines[head],
        numbered ? oldNo : null,
        numbered ? newNo : null,
      ),
    );
    head++;
    oldNo++;
    newNo++;
  }

  let tail = 0;
  while (
    tail < oldLines.length - head &&
    tail < newLines.length - head &&
    oldLines[oldLines.length - 1 - tail] ===
      newLines[newLines.length - 1 - tail]
  )
    tail++;

  const oldMiddle = oldLines.slice(head, oldLines.length - tail);
  const newMiddle = newLines.slice(head, newLines.length - tail);

  if (oldMiddle.length > MAX_LCS_LINES || newMiddle.length > MAX_LCS_LINES) {
    // A worse diff beats a phone allocating a table with a third of a million
    // cells in it.
    for (const line of oldMiddle)
      result.push(diffLine('remove', line, numbered ? oldNo++ : null));
    for (const line of newMiddle)
      result.push(diffLine('add', line, null, numbered ? newNo++ : null));
  } else {
    const counters = { oldNo, newNo };
    appendLcs(result, oldMiddle, newMiddle, numbered, counters);
    oldNo = counters.oldNo;
    newNo = counters.newNo;
  }

  for (let i = oldLines.length - tail; i < oldLines.length; i++) {
    result.push(
      diffLine(
        'context',
        oldLines[i],
        numbered ? oldNo : null,
        numbered ? newNo : null,
      ),
    );
    oldNo++;
    newNo++;
  }

  return result;
}

function appendLcs(
  result: DiffLine[],
  a: string[],
  b: string[],
  numbered: boolean,
  counters: { oldNo: number; newNo: number },
): void {
  const width = b.length + 1;
  const table = new Int32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);

  let x = 0;
  let y = 0;
  while (x < a.length && y < b.length) {
    if (a[x] === b[y]) {
      result.push(
        diffLine(
          'context',
          a[x],
          numbered ? counters.oldNo : null,
          numbered ? counters.newNo : null,
        ),
      );
      x++;
      y++;
      counters.oldNo++;
      counters.newNo++;
      // Removals before additions on a tie, so a replaced line reads "was / now"
      // rather than the other way around.
    } else if (table[(x + 1) * width + y] >= table[x * width + y + 1]) {
      result.push(diffLine('remove', a[x], numbered ? counters.oldNo : null));
      x++;
      counters.oldNo++;
    } else {
      result.push(
        diffLine('add', b[y], null, numbered ? counters.newNo : null),
      );
      y++;
      counters.newNo++;
    }
  }

  while (x < a.length) {
    result.push(diffLine('remove', a[x], numbered ? counters.oldNo : null));
    x++;
    counters.oldNo++;
  }

  while (y < b.length) {
    result.push(diffLine('add', b[y], null, numbered ? counters.newNo : null));
    y++;
    counters.newNo++;
  }
}

/**
 * Drop unchanged runs more than `context` lines from any change, marking each
 * elision with a hunk row. A diff with no changes comes back empty rather than
 * as the whole text — an edit whose strings match is a no-op, and printing its
 * input back is not a diff.
 */
function elide(lines: DiffLine[], context: number): DiffLine[] {
  const changed = new Array<boolean>(lines.length).fill(false);
  let any = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind === 'context' || lines[i].kind === 'hunk') continue;
    any = true;
    for (
      let j = Math.max(0, i - context);
      j <= Math.min(lines.length - 1, i + context);
      j++
    )
      changed[j] = true;
  }

  if (!any) return [];

  const result: DiffLine[] = [];
  let skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    if (changed[i]) {
      if (skipped > 0) {
        result.push(
          diffLine(
            'hunk',
            skipped === 1 ? '1 unchanged line' : `${skipped} unchanged lines`,
          ),
        );
        skipped = 0;
      }
      result.push(lines[i]);
    } else {
      skipped++;
    }
  }

  // A run elided off the end needs saying too, or the diff simply stops and
  // nothing tells the reader there was more file after it.
  if (skipped > 0)
    result.push(
      diffLine(
        'hunk',
        skipped === 1 ? '1 unchanged line' : `${skipped} unchanged lines`,
      ),
    );

  return result;
}

/**
 * Unified diff text into the same shape, for the tools that already speak diff.
 * Forgiving on purpose: anything unrecognised becomes a dim hunk row rather than
 * being dropped.
 */
export function parseUnifiedDiff(text: string): DiffLine[] {
  const result: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;

  const decorations = [
    '+++',
    '---',
    'diff ',
    'index ',
    'new file',
    'deleted file',
    'similarity index',
    'rename ',
    '\\',
  ];

  for (const raw of splitLines(text)) {
    if (raw.startsWith('@@')) {
      [oldNo, newNo] = parseHunkHeader(raw);
      result.push(diffLine('hunk', raw));
    } else if (decorations.some(d => raw.startsWith(d))) {
      result.push(diffLine('hunk', raw));
    } else if (raw.startsWith('+')) {
      result.push(diffLine('add', raw.slice(1), null, newNo++));
    } else if (raw.startsWith('-')) {
      result.push(diffLine('remove', raw.slice(1), oldNo++));
    } else {
      result.push(
        diffLine(
          'context',
          raw.startsWith(' ') ? raw.slice(1) : raw,
          oldNo++,
          newNo++,
        ),
      );
    }
  }

  return result;
}

/** Starting line numbers from `@@ -12,7 +12,9 @@`. Zero on anything unparseable. */
function parseHunkHeader(header: string): [number, number] {
  let body = header.slice(2);
  const end = body.indexOf('@@');
  if (end >= 0) body = body.slice(0, end);

  let oldNo = 0;
  let newNo = 0;
  for (const range of body.split(' ').filter(part => part.length > 0)) {
    if (range.length < 2) continue;
    const digits = range.slice(1).split(',')[0];
    if (!/^\d+$/.test(digits)) continue;
    const value = Number(digits);
    if (range[0] === '-') oldNo = value;
    else if (range[0] === '+') newNo = value;
  }

  return [oldNo, newNo];
}

// ---------------------------------------------------------------- the factory

/**
 * @param result the tool's output, or null while the call is still running.
 * @param images the pictures the result carried that the server kept; absent
 *   or empty for none (and on every server that predates keeping them).
 */
export function buildToolCard(
  toolName: string,
  inputJson: string,
  result: string | null,
  isError: boolean,
  images?: readonly ToolResultImage[] | null,
): ToolCard {
  const input = tryParseObject(inputJson);
  const kept = images && images.length > 0 ? images : null;

  // With the pictures to show, the lines that stood in for them
  // ("[image: image/png, 12 KB]", "[screenshot attached]") say nothing.
  let card = compose(toolName, input, kept ? withoutImageLines(result) : result, isError, kept);

  // A card that does not place its own pictures gets them after its body. Open,
  // because the picture is usually the point — except where it is the side
  // effect of an act, as each browser step's screenshot is.
  if (kept && !card.blocks.some(b => b.type === 'image')) {
    const open = !['browser_click', 'browser_type', 'browser_scroll', 'browser_navigate'].includes(toolName);
    card = { ...card, blocks: [...card.blocks, ...kept.map(i => picture(i, open))] };
  }

  // A failure is the one thing nobody should have to tap for. Builders that know
  // something about their own errors — the shell lifting an exit code out of the
  // first line — write the block themselves and are left alone.
  if (!isError || !result || result.trim().length === 0) return card;
  if (card.blocks.some(b => b.type === 'text' && b.tone === 'error'))
    return card;

  return {
    ...card,
    blocks: [
      ...card.blocks,
      {
        type: 'text',
        label: 'error',
        open: true,
        tone: 'error',
        text: result.trim(),
      },
    ],
  };
}

/**
 * The same card, for a call held at an approval gate. Everything opens: the
 * question is whether to authorize this, and a body behind a chevron is a body
 * nobody read. A shell command additionally gets its own block, because a header
 * ellipsis is exactly the wrong place to hide the second half of a command
 * somebody is about to approve.
 */
export function buildProposalCard(
  toolName: string,
  inputJson: string,
): ToolCard {
  const card = buildToolCard(toolName, inputJson, null, false);
  const blocks: ToolBlock[] = card.blocks.map(b => ({ ...b, open: true }));

  if (
    card.subjectStyle === 'command' &&
    card.subject &&
    !blocks.some(b => b.type === 'code' && b.label === 'command')
  )
    blocks.unshift({
      type: 'code',
      label: 'command',
      open: true,
      language: null,
      text: card.subject,
    });

  return { ...card, blocks };
}

type Json =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

function compose(
  tool: string,
  input: Json | undefined,
  result: string | null,
  isError: boolean,
  images: readonly ToolResultImage[] | null,
): ToolCard {
  switch (tool) {
    // ---- files ----
    case 'edit_file':
      return editFile(input, result, isError);
    case 'write_file':
      return writeFile(input, result, isError);
    case 'read_file':
      return readFile(input, result, isError, images);
    // Claude Code's own read: `file_path` rather than `path`, otherwise the
    // same act, so the same card and the same peek.
    case 'Read':
      return readFile(input, result, isError, images, 'file_path');
    case 'list_dir':
      return listDir(input, result, isError);

    // ---- search ----
    case 'grep_files':
      return grepFiles(input, result, isError);
    case 'find_files':
      return findFiles(input, result, isError);

    // ---- shell ----
    case 'run_bash':
      return shell('Bash', str(input, 'command'), input, result, isError);
    case 'run_powershell':
      return shell('PowerShell', str(input, 'command'), input, result, isError);
    // Claude Code's own shells: the same act, with a description beside the
    // command and `run_in_background` for `background`. Its `timeout` is a
    // ceiling in milliseconds, not something a reader needs in the header.
    case 'Bash':
      return shell('Bash', str(input, 'command'), input, result, isError);
    case 'PowerShell':
      return shell('PowerShell', str(input, 'command'), input, result, isError);
    case 'run_on_node': {
      const node = str(input, 'node');
      return shell(
        node ? `Run on ${node}` : 'Run on node',
        str(input, 'command'),
        input,
        result,
        isError,
      );
    }
    case 'bash_output':
    case 'kill_job':
    case 'shell_monitor':
      return job(tool, input, result, isError);

    // ---- web ----
    case 'fetch_url':
      return fetchUrl(input, result, isError);
    case 'web_search':
      return webSearch(input, result, isError);

    // ---- agent ----
    case 'open_subsession':
      return subSession('Open', str(input, 'name'), input, result, isError);
    // The subject is the name the agent typed, which is how it thinks of the
    // partner; legacy rows carry an id there and their reply header is the only
    // place the name appears.
    case 'prompt_subsession':
      return subSession(
        'Send to',
        str(input, 'subsession') ??
          subSessionName(result) ??
          shortId(str(input, 'subsession_id')),
        input,
        result,
        isError,
      );
    case 'promote_subsession':
      return named(
        promoteVerb(input),
        str(input, 'subsession') ?? shortId(str(input, 'subsession_id')),
        result,
        isError,
      );
    case 'stop_subsession':
      return named(
        'Stop',
        str(input, 'subsession') ?? shortId(str(input, 'subsession_id')),
        result,
        isError,
      );
    case 'close_subsession':
      return named(
        'Set aside',
        str(input, 'subsession') ?? shortId(str(input, 'subsession_id')),
        result,
        isError,
      );
    case 'run_subagent': // legacy transcripts
      return subagent(input, result, isError);
    case 'skill':
      return named('Skill', str(input, 'name'), result, isError);
    case 'slopcoder_help':
      return named('Help', str(input, 'topic') ?? 'contents', result, isError);

    // ---- memory ----
    case 'save_memory':
      return saveMemory(input, result, isError);
    case 'read_memory':
      return memory('Recall', input, result, isError);
    case 'delete_memory':
      return memory('Forget', input, result, isError);
    case 'set_notepad':
      return notepad(input, result, isError);

    // ---- artifacts ----
    case 'publish_artifact':
      return publishArtifact(input, result, isError);
    case 'list_artifacts':
      return artifacts(result, isError);
    case 'read_artifact':
      return named('Read artifact', str(input, 'slug'), result, isError);
    case 'delete_artifact':
      return named('Delete artifact', str(input, 'slug'), result, isError);

    // ---- 3D scenes ----
    case 'scene_open':
      return scene('Open scene', str(input, 'path'), [], [], result, isError);
    case 'scene_exec':
      return sceneExec(input, result, isError);
    case 'scene_inspect': {
      const target = str(input, 'object');
      return named(
        'Inspect scene',
        target ? `${str(input, 'scene') ?? ''} · ${target}` : str(input, 'scene'),
        result,
        isError,
        'path',
      );
    }
    case 'scene_render':
      return sceneRender(input, result, isError);
    case 'scene_history': {
      const action = str(input, 'action');
      const wanted = int(input, 'revision');
      return scene(
        action === 'diff' ? 'Compare revisions' : action === 'revert' ? 'Revert scene' : 'Scene history',
        str(input, 'scene'),
        wanted !== null ? [`rev ${wanted}`] : [],
        [],
        result,
        isError,
      );
    }
    case 'scene_export':
      return named('Export scene', str(input, 'output') ?? str(input, 'scene'), result, isError, 'path');
    case 'scene_api': {
      const query = str(input, 'query');
      return named('Scene API', query ? query : 'overview', result, isError);
    }

    // ---- forge ----
    case 'create_pull_request':
      return createPullRequest(input, result, isError);
    case 'get_pull_request_diff':
      return pullRequestDiff(input, result, isError);
    case 'list_issues':
      return forge('Issues', str(input, 'repo'), input, result, isError, true);
    case 'list_pull_requests':
      return forge(
        'Pull requests',
        str(input, 'repo'),
        input,
        result,
        isError,
        true,
      );
    case 'get_issue':
      return forge('Issue', repoNumber(input), input, result, isError, false);
    case 'get_pull_request':
      return forge(
        'Pull request',
        repoNumber(input),
        input,
        result,
        isError,
        false,
      );
    case 'create_issue':
      return newIssue(input, result, isError);
    case 'update_issue':
      return forge(
        'Update issue',
        repoNumber(input),
        input,
        result,
        isError,
        false,
      );
    case 'add_issue_comment':
      return comment(input, result, isError);

    // ---- browser ----
    case 'browser_navigate':
      return named(
        'Navigate',
        str(input, 'url') ?? str(input, 'path'),
        result,
        isError,
        'url',
      );
    case 'browser_click':
      return browser('Click', input, result, isError);
    case 'browser_type':
      return named('Type', str(input, 'text'), result, isError);
    case 'browser_scroll':
      return browser('Scroll', input, result, isError);
    case 'browser_screenshot':
      return named('Screenshot', null, result, isError);
    case 'browser_read_console':
      return consoleCard(result, isError);

    // ---- app host ----
    case 'app_start':
      return named('Start app', str(input, 'repo'), result, isError);
    case 'app_stop':
      return named('Stop app', null, result, isError);
    case 'app_output':
      return consoleCard(result, isError, 'App output');

    // ---- sessions ----
    case 'search_sessions':
      return searchSessions(input, result, isError);
    case 'read_session':
      return readSession(input, result, isError);

    case 'transcribe_audio':
      return named('Transcribe', str(input, 'path'), result, isError, 'path');

    default:
      return fallback(tool, input, result, isError);
  }
}

// ---------------------------------------------------------------- the fallback

/** Where the fallback looks for a subject, in the order a reader would. */
const SUBJECT_KEYS = [
  'path',
  'file',
  'url',
  'query',
  'pattern',
  'command',
  'title',
  'name',
  'message',
  'text',
  'id',
] as const;

function fallback(
  tool: string,
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const facets: string[] = [];
  let verb = tool;

  // mcp__<server>__<tool>: the server is context, the tool is the verb.
  if (tool.startsWith('mcp__')) {
    const rest = tool.slice('mcp__'.length);
    const split = rest.indexOf('__');
    if (split >= 0) {
      facets.push(rest.slice(0, split));
      verb = rest.slice(split + 2);
    } else {
      verb = rest;
    }
  }

  verb = humanize(verb);

  let subject: string | null = null;
  let style: SubjectStyle = 'plain';
  const pairs: CardPair[] = [];
  const blocks: ToolBlock[] = [];

  if (isObject(input)) {
    for (const key of SUBJECT_KEYS) {
      const found = str(input, key);
      if (!found || found.length === 0 || found.length > 120) continue;
      subject = found;
      style =
        key === 'path' || key === 'file'
          ? 'path'
          : key === 'url'
          ? 'url'
          : key === 'command'
          ? 'command'
          : 'plain';
      break;
    }

    for (const [key, value] of Object.entries(input)) {
      if (
        subject !== null &&
        str(input, key) === subject &&
        (SUBJECT_KEYS as readonly string[]).includes(key)
      )
        continue;

      const [rendered, multiline] = render(value);
      if (rendered.length === 0) continue;

      if (
        !multiline &&
        rendered.length <= MAX_FACET_LENGTH &&
        facets.length < MAX_FACETS
      )
        facets.push(facet(key, value, rendered));
      else if (!multiline && rendered.length <= MAX_PAIR_LENGTH)
        pairs.push({ key, value: rendered });
      else
        blocks.push({
          type: 'code',
          label: key,
          open: false,
          language: null,
          text: rendered,
        });
    }
  } else if (input !== undefined && input !== null) {
    blocks.push({
      type: 'code',
      label: 'input',
      open: false,
      language: null,
      text: render(input)[0],
    });
  }

  if (pairs.length > 0)
    blocks.unshift({ type: 'pairs', label: 'input', open: false, pairs });
  appendResult(blocks, result, isError, 'text');
  return { verb, subject, subjectStyle: style, facets, blocks };
}

// ---------------------------------------------------------------- files

function editFile(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const lines = lineDiff(
    str(input, 'old_str') ?? '',
    str(input, 'new_str') ?? '',
    false,
  );
  const added = lines.filter(l => l.kind === 'add').length;
  const removed = lines.filter(l => l.kind === 'remove').length;

  const facets: string[] = [];
  if (added > 0) facets.push(`+${added}`);
  if (removed > 0) facets.push(`-${removed}`);
  if (bool(input, 'replace_all')) facets.push('every match');

  const blocks: ToolBlock[] = [];
  if (lines.length > 0)
    blocks.push({ type: 'diff', label: null, open: true, lines });
  appendResult(blocks, result, isError, 'text', 'Edited ');
  return {
    verb: 'Edit',
    subject: str(input, 'path'),
    subjectStyle: 'path',
    facets,
    blocks,
  };
}

function writeFile(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const content = str(input, 'content') ?? '';
  const lines = allAdded(content);
  const blocks: ToolBlock[] = [];
  if (lines.length > 0)
    blocks.push({ type: 'diff', label: null, open: true, lines });
  appendResult(blocks, result, isError, 'text', 'Wrote ');
  return {
    verb: 'Write',
    subject: str(input, 'path'),
    subjectStyle: 'path',
    facets: [lineCount(content)],
    blocks,
  };
}

/**
 * A read. Of text, the text; of an image, the image — kept by the server and
 * named here by id. An image read with nothing kept (a transcript from before
 * images were, a shared copy, one over the cap) says what the agent looked at
 * instead of setting its placeholder line as code.
 */
function readFile(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
  images: readonly ToolResultImage[] | null,
  pathKey = 'path',
): ToolCard {
  const path = str(input, pathKey);
  const looked = !isError && !images && result ? imageRead(result) : null;
  const facets: string[] = [];
  if (images && images.length > 0) facets.push(images[0].mediaType);
  else if (looked) {
    if (looked.mediaType) facets.push(looked.mediaType);
  } else if (result && result.length > 0) facets.push(lineCount(result));
  const offset = int(input, 'offset');
  if (offset !== null) facets.push(`from ${offset}`);
  const limit = int(input, 'limit');
  if (limit !== null) facets.push(`limit ${limit}`);

  const blocks: ToolBlock[] = [];
  if (images && images.length > 0) {
    blocks.push(...images.map(i => picture(i, true)));
    const rest = !isError && result ? result.trim() : '';
    if (rest.length > 0)
      blocks.push({ type: 'text', label: 'result', open: false, tone: 'plain', text: rest });
    return { verb: 'Read', subject: path, subjectStyle: 'path', facets, blocks };
  }
  if (looked) {
    const detail = looked.mediaType
      ? looked.size
        ? ` (${looked.mediaType}, ${looked.size})`
        : ` (${looked.mediaType})`
      : '';
    blocks.push({
      type: 'text',
      label: null,
      open: false,
      tone: 'muted',
      text: `The agent looked at this image${detail}. It was not kept, so it cannot be shown here.`,
    });
    return { verb: 'Read', subject: path, subjectStyle: 'path', facets, blocks };
  }

  let peek: FilePeek | undefined;
  if (!isError && result) {
    const body = result.replace(/\n+$/, '');
    if (body.length > 0) {
      blocks.push({
        type: 'code',
        label: null,
        open: false,
        language: languageOf(path),
        text: body,
      });
      peek = { path: path ?? 'file', text: body, facets };
    }
  }

  return { verb: 'Read', subject: path, subjectStyle: 'path', facets, blocks, ...(peek ? { peek } : null) };
}

/**
 * The sentence a read leaves in place of an image — read_file's
 * `[read_file: shot.png — image/png, 12 KB]`, Claude Code's
 * `[image: image/png, 12 KB]` or bare `[image]` — taken apart. Null for
 * anything else.
 */
export function imageRead(result: string): { mediaType: string | null; size: string | null } | null {
  const match = /^\[(?:read_file: .+ — |image: )(image\/[a-z0-9.+-]+)(?:, ([^\]]+))?\]$|^\[image\]$/i.exec(
    result.trim(),
  );
  if (!match) return null;
  return { mediaType: match[1] ? match[1].toLowerCase() : null, size: match[2] ?? null };
}

/**
 * The result without the lines that stood in for pictures — the image
 * sentences above, and the "[image attached]" / "[screenshot attached]" notes
 * MCP and browser tools write — for a card that has the pictures.
 */
function withoutImageLines(result: string | null): string | null {
  if (result === null) return null;
  return result
    .split('\n')
    .filter(line => {
      const bare = line.trim();
      return imageRead(line) === null && bare !== '[image attached]' && bare !== '[screenshot attached]';
    })
    .join('\n');
}

function picture(image: ToolResultImage, open: boolean): ToolBlock {
  return { type: 'image', label: null, open, imageId: image.id, mediaType: image.mediaType, size: formatBytes(image.size) };
}

/**
 * "812 B", "182 KB", "2.4 MB". Rounded half-up in integers, so it lands on the
 * same digit as the C#.
 */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.floor((size * 2 + 1024) / 2048)} KB`;
  const tenths = Math.floor((size * 20 + 1024 * 1024) / (2 * 1024 * 1024));
  return `${Math.floor(tenths / 10)}.${tenths % 10} MB`;
}

function listDir(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const entries =
    !isError && result && result.length > 0 && result !== '(empty)'
      ? rows(result)
      : [];
  const facets: string[] = [];
  const blocks: ToolBlock[] = [];
  if (entries.length > 0) {
    facets.push(count(entries.length, 'entry', 'entries'));
    blocks.push({
      type: 'list',
      label: null,
      open: false,
      entries: entries.map(plainEntry),
    });
  }

  const path = str(input, 'path');
  return {
    verb: 'List',
    subject: path && path.length > 0 ? path : '.',
    subjectStyle: 'path',
    facets,
    blocks,
  };
}

// ---------------------------------------------------------------- search

function grepFiles(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const facets: string[] = [];
  const glob = str(input, 'glob');
  if (glob) facets.push(glob);
  const path = str(input, 'path');
  if (path) facets.push(path);

  const blocks: ToolBlock[] = [];
  if (!isError && result && result.length > 0) {
    const hits = rows(result);
    if (hits.length > 0) {
      facets.unshift(count(hits.length, 'match', 'matches'));
      blocks.push({
        type: 'list',
        label: null,
        open: false,
        entries: hits.map(splitHit),
      });
    }
  }

  return {
    verb: 'Search',
    subject: str(input, 'pattern'),
    subjectStyle: 'plain',
    facets,
    blocks,
  };
}

function findFiles(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const facets: string[] = [];
  const path = str(input, 'path');
  if (path) facets.push(path);

  const blocks: ToolBlock[] = [];
  if (!isError && result && result.length > 0) {
    const found = rows(result);
    if (found.length > 0) {
      facets.unshift(count(found.length, 'file', 'files'));
      blocks.push({
        type: 'list',
        label: null,
        open: false,
        entries: found.map(plainEntry),
      });
    }
  }

  return {
    verb: 'Find',
    subject: str(input, 'glob'),
    subjectStyle: 'path',
    facets,
    blocks,
  };
}

/** `path:12: matched text` → the location, with the line beside it. */
function splitHit(row: string): ListEntry {
  const colon = row.indexOf(':');
  if (colon <= 0) return plainEntry(row);
  const second = row.indexOf(':', colon + 1);
  if (second <= colon + 1) return plainEntry(row);
  const between = row.slice(colon + 1, second);
  return /^\d+$/.test(between)
    ? { text: row.slice(0, second), detail: row.slice(second + 1).trim() }
    : plainEntry(row);
}

// ---------------------------------------------------------------- shell

function shell(
  verb: string,
  command: string | null,
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const facets: string[] = [];
  if (bool(input, 'background') || bool(input, 'run_in_background'))
    facets.push('background');

  let body = result;
  // run_bash prefixes its output with "exit code: N". That belongs in the
  // header; left in the body it reads as the command's first line of output on
  // every single call.
  if (body && body.length > 0) {
    const newline = body.indexOf('\n');
    const first = newline < 0 ? body : body.slice(0, newline);
    if (first.startsWith('exit code: ')) {
      facets.unshift(`exit ${first.slice('exit code: '.length).trim()}`);
      body = newline < 0 ? '' : body.slice(newline + 1);
    }
  }

  const blocks: ToolBlock[] = [];
  const title = str(input, 'description')?.trim() || undefined;
  if (title && command)
    blocks.push({
      type: 'code',
      label: 'command',
      open: false,
      language: null,
      text: command,
    });

  const output = body ? trimEnd(body) : '';
  if (output.length > 0)
    blocks.push(
      isError
        ? {
            type: 'text',
            label: 'error',
            open: true,
            tone: 'error',
            text: output,
          }
        : {
            type: 'code',
            label: 'output',
            open: false,
            language: null,
            text: output,
          },
    );

  return {
    verb,
    subject: command,
    subjectStyle: 'command',
    facets,
    blocks,
    ...(title ? { title } : null),
  };
}

function job(
  tool: string,
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const verb =
    tool === 'kill_job'
      ? 'Kill job'
      : tool === 'shell_monitor'
      ? 'Watch job'
      : 'Job output';
  const facets: string[] = [];
  const pattern = str(input, 'pattern');
  if (pattern) facets.push(pattern);
  const offset = int(input, 'offset');
  if (offset !== null) facets.push(`from ${offset}`);

  const blocks: ToolBlock[] = [];
  if (!isError && result && result.length > 0)
    blocks.push({
      type: 'code',
      label: 'output',
      open: false,
      language: null,
      text: trimEnd(result),
    });
  return {
    verb,
    subject: str(input, 'job_id'),
    subjectStyle: 'plain',
    facets,
    blocks,
  };
}

// ---------------------------------------------------------------- web

function fetchUrl(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const facets: string[] = [];
  const offset = int(input, 'offset');
  if (offset !== null) facets.push(`from ${offset}`);
  const max = int(input, 'max_chars');
  if (max !== null) facets.push(`max ${max}`);

  const blocks: ToolBlock[] = [];
  appendResult(blocks, result, isError, 'text');
  return {
    verb: 'Fetch',
    subject: str(input, 'url'),
    subjectStyle: 'url',
    facets,
    blocks,
  };
}

function webSearch(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const facets: string[] = [];
  const blocks: ToolBlock[] = [];
  if (!isError && result && result.length > 0) {
    const found = rows(result);
    if (found.length > 0) {
      facets.push(count(found.length, 'result', 'results'));
      blocks.push({
        type: 'list',
        label: null,
        open: false,
        entries: found.map(plainEntry),
      });
    }
  }

  return {
    verb: 'Search web',
    subject: str(input, 'query'),
    subjectStyle: 'plain',
    facets,
    blocks,
  };
}

// ---------------------------------------------------------------- agent

/**
 * One prompt to a sub-session and its reply: the parent's own record of what
 * it said and heard. The live card above the stream shows the conversation.
 */
function subSession(
  verb: string,
  subject: string | null,
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const facets: string[] = [];
  const profile = str(input, 'profile');
  if (profile) facets.push(profile);
  const model = str(input, 'model');
  if (model) facets.push(model);

  const blocks: ToolBlock[] = [];
  const prompt = str(input, 'prompt');
  if (prompt)
    blocks.push({
      type: 'text',
      label: 'prompt',
      open: false,
      tone: 'plain',
      text: prompt,
    });
  appendResult(blocks, stripSubSessionHeader(result), isError, 'text');
  return { verb, subject, subjectStyle: 'plain', facets, blocks };
}

/**
 * What a promotion is called depends on what moved: the model is the part a
 * reader wants on the card, since it is the one that costs.
 */
function promoteVerb(input: Json | undefined): string {
  const model = str(input, 'model');
  if (model !== null && model.length > 0) return `Move to ${model}`;
  if (str(input, 'profile')) return 'Change profile';
  if (str(input, 'effort')) return 'Change effort';
  return 'Change';
}

const SUB_SESSION_HEADER = '[sub-session "';

/** The sub-session's name, read off the reply header — the input only carries the id. */
function subSessionName(result: string | null): string | null {
  // Legacy only: sub-session turns used to run inside the tool call, and the
  // reply came back under a header while the input carried nothing but an id.
  if (result === null) return null;
  const at = result.indexOf(SUB_SESSION_HEADER);
  if (at < 0) return null;
  const start = at + SUB_SESSION_HEADER.length;
  const end = result.indexOf('"', start);
  return end > start ? result.slice(start, end) : null;
}

/** The reply without its header line, which the card's head already says. */
function stripSubSessionHeader(result: string | null): string | null {
  if (result === null || !result.startsWith(SUB_SESSION_HEADER)) return result;
  const newline = result.indexOf('\n');
  return newline < 0 ? '' : result.slice(newline + 1);
}

/** The first block of a UUID, enough to tell sub-sessions apart in a row. */
function shortId(id: string | null): string | null {
  return id !== null && id.length > 8 ? id.slice(0, 8) : id;
}

function subagent(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const facets: string[] = [];
  const model = str(input, 'model');
  if (model) facets.push(model);

  const blocks: ToolBlock[] = [];
  const task = str(input, 'task');
  if (task)
    blocks.push({
      type: 'text',
      label: 'task',
      open: false,
      tone: 'plain',
      text: task,
    });
  const acceptance = str(input, 'acceptance');
  if (acceptance)
    blocks.push({
      type: 'text',
      label: 'acceptance',
      open: false,
      tone: 'plain',
      text: acceptance,
    });
  appendResult(blocks, result, isError, 'text');
  return {
    verb: 'Subagent',
    subject: str(input, 'agent_type') ?? 'general',
    subjectStyle: 'plain',
    facets,
    blocks,
  };
}

// ---------------------------------------------------------------- memory

function saveMemory(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const facets = memoryFacets(input);
  if (bool(input, 'pinned')) facets.push('pinned');

  const blocks: ToolBlock[] = [];
  const description = str(input, 'description');
  if (description)
    blocks.push({
      type: 'text',
      label: 'description',
      open: false,
      tone: 'plain',
      text: description,
    });
  const content = str(input, 'content');
  if (content)
    blocks.push({
      type: 'text',
      label: 'content',
      open: false,
      tone: 'plain',
      text: content,
    });
  appendResult(blocks, result, isError, 'text', 'Saved ');
  return {
    verb: 'Remember',
    subject: str(input, 'name'),
    subjectStyle: 'plain',
    facets,
    blocks,
  };
}

/**
 * Publishing made a thing, so the card is the thing: a header that says what
 * happened, and under it the artifact itself — name, type, size — as something
 * to open rather than to read about.
 *
 * Its details come back out of the tool's own sentence, which is then dropped:
 * once its parts are the header and the card, repeating it whole is the noise a
 * card exists to remove. A result we could not read still shows as it did.
 */
function publishArtifact(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const published = readPublished(result);
  const format = str(input, 'format') ?? published.format;
  const name = str(input, 'slug') ?? published.slug;

  // It worked and there is a thing: the thing is the card, and the transcript's
  // usual header would only say its name a second time.
  if (published.slug && !isError && name) {
    return {
      verb: 'Publish',
      subject: null,
      subjectStyle: 'plain',
      facets: [],
      bare: true,
      blocks: [
        {
          type: 'artifact',
          label: null,
          open: true,
          name,
          kind: kindLabel(format),
          size: published.size,
          artifactId: published.artifactId,
        },
      ],
    };
  }

  // Still running, refused, or a sentence we could not read: an account of the
  // call, which is what the header row is for.
  const blocks: ToolBlock[] = [];
  if (name) {
    blocks.push({
      type: 'artifact',
      label: null,
      open: true,
      name,
      kind: kindLabel(format),
      size: null,
      artifactId: null,
    });
  }

  const description = str(input, 'description');
  if (description)
    blocks.push({
      type: 'text',
      label: 'description',
      open: false,
      tone: 'plain',
      text: description,
    });
  const path = str(input, 'path');
  if (path)
    blocks.push({
      type: 'text',
      label: 'file',
      open: false,
      tone: 'plain',
      text: path,
    });
  const content = str(input, 'content');
  if (content)
    blocks.push({
      type: 'text',
      label: 'content',
      open: false,
      tone: 'plain',
      text: content,
    });
  appendResult(blocks, result, isError, 'text');

  return {
    verb: 'Publish',
    subject: str(input, 'title'),
    subjectStyle: 'plain',
    facets: [],
    blocks,
  };
}

/** The format as a person would say it. Unknown formats keep their own word. */
function kindLabel(format: string | null): string {
  switch (format) {
    case 'markdown':
      return 'Markdown';
    case 'text':
      return 'Text';
    case 'html':
      return 'HTML';
    case 'json':
      return 'JSON';
    case 'csv':
      return 'CSV';
    case 'binary':
      return 'File';
    case null:
    case '':
      return 'Artifact';
    default:
      return format;
  }
}

/**
 * The published list, as rows rather than as a paragraph — one artifact per
 * line is what the tool writes and what a reader scans.
 */
function artifacts(result: string | null, isError: boolean): ToolCard {
  const blocks: ToolBlock[] = [];
  appendResult(blocks, result, isError, 'list', 'No artifacts published');
  return {
    verb: 'Artifacts',
    subject: null,
    subjectStyle: 'plain',
    facets: [],
    blocks,
  };
}

/**
 * What `publish_artifact` said, taken apart. Four independent lookups rather
 * than one match of the whole sentence: the wording is prose written for the
 * model to read, and a card that went blank because a comma moved would be
 * worse than one showing three facets out of four.
 */
function readPublished(result: string | null): {
  slug: string | null;
  format: string | null;
  size: string | null;
  version: string | null;
  artifactId: string | null;
} {
  const none = {
    slug: null,
    format: null,
    size: null,
    version: null,
    artifactId: null,
  };
  if (!result) return none;

  const slug = textBetween(result, 'as artifact `', '`');
  if (slug === null) return none;

  // "(markdown, 12.4 KB)" — the shape that follows the slug.
  let format: string | null = null;
  let size: string | null = null;
  const shape = textBetween(result, '` (', ')');
  if (shape !== null) {
    const comma = shape.indexOf(', ');
    if (comma > 0) {
      format = shape.slice(0, comma);
      size = shape.slice(comma + 2);
    }
  }

  const bump = textBetween(result, 'Republished (v', ')');
  const version = bump ? `v${bump}` : null;

  // The id, not the URL: each client spells its own route to an artifact.
  let artifactId: string | null = null;
  const marker = '/artifacts/';
  const at = result.indexOf(marker);
  if (at >= 0) {
    const from = at + marker.length;
    // A uuid has no dots, so the sentence's full stop is the end of it.
    const end = result.slice(from).search(/[ .\n]/);
    artifactId = end < 0 ? result.slice(from) : result.slice(from, from + end);
  }

  return { slug, format, size, version, artifactId };
}

/** The text between two markers, or null when either is missing. */
function textBetween(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  if (start < 0) return null;
  const from = start + open.length;
  const end = text.indexOf(close, from);
  return end < 0 ? null : text.slice(from, end);
}

function memory(
  verb: string,
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const blocks: ToolBlock[] = [];
  appendResult(blocks, result, isError, 'text');
  return {
    verb,
    subject: str(input, 'name'),
    subjectStyle: 'plain',
    facets: memoryFacets(input),
    blocks,
  };
}

function memoryFacets(input: Json | undefined): string[] {
  const facets: string[] = [];
  const scope = str(input, 'scope');
  if (scope) facets.push(scope);
  const repo = str(input, 'repo');
  if (repo) facets.push(repo);
  return facets;
}

function notepad(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const text = str(input, 'text') ?? '';
  const blocks: ToolBlock[] = [];
  if (text.length > 0)
    blocks.push({
      type: 'text',
      label: null,
      open: false,
      tone: 'plain',
      text,
    });
  appendResult(blocks, result, isError, 'text', 'Notepad ');
  return {
    verb: text.length === 0 ? 'Clear notepad' : 'Notepad',
    subject: null,
    subjectStyle: 'plain',
    facets: [],
    blocks,
  };
}

// ---------------------------------------------------------------- forge

function createPullRequest(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const facets: string[] = [];
  const repo = str(input, 'repo');
  if (repo) facets.push(repo);
  const head = str(input, 'head');
  if (head) {
    const base = str(input, 'base');
    facets.push(base ? `${head} to ${base}` : head);
  }

  const blocks: ToolBlock[] = [];
  const body = str(input, 'body');
  if (body)
    blocks.push({
      type: 'text',
      label: 'body',
      open: false,
      tone: 'plain',
      text: body,
    });
  appendResult(blocks, result, isError, 'text');
  return {
    verb: 'Open PR',
    subject: str(input, 'title'),
    subjectStyle: 'plain',
    facets,
    blocks,
  };
}

function pullRequestDiff(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const blocks: ToolBlock[] = [];
  const facets: string[] = [];
  if (!isError && result && result.length > 0) {
    const lines = parseUnifiedDiff(result);
    const added = lines.filter(l => l.kind === 'add').length;
    const removed = lines.filter(l => l.kind === 'remove').length;
    if (added > 0) facets.push(`+${added}`);
    if (removed > 0) facets.push(`-${removed}`);
    blocks.push({ type: 'diff', label: null, open: true, lines });
  }

  return {
    verb: 'PR diff',
    subject: repoNumber(input),
    subjectStyle: 'plain',
    facets,
    blocks,
  };
}

function forge(
  verb: string,
  subject: string | null,
  input: Json | undefined,
  result: string | null,
  isError: boolean,
  list: boolean,
): ToolCard {
  const facets: string[] = [];
  const state = str(input, 'state');
  if (state) facets.push(state);
  const labels = str(input, 'labels');
  if (labels) facets.push(labels);
  const page = int(input, 'page');
  if (page !== null && page > 1) facets.push(`page ${page}`);

  const blocks: ToolBlock[] = [];
  appendResult(blocks, result, isError, list ? 'list' : 'text');
  return { verb, subject, subjectStyle: 'plain', facets, blocks };
}

function newIssue(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const blocks: ToolBlock[] = [];
  const body = str(input, 'body');
  if (body)
    blocks.push({
      type: 'text',
      label: 'body',
      open: false,
      tone: 'plain',
      text: body,
    });
  appendResult(blocks, result, isError, 'text');
  const repo = str(input, 'repo');
  return {
    verb: 'New issue',
    subject: str(input, 'title'),
    subjectStyle: 'plain',
    facets: repo ? [repo] : [],
    blocks,
  };
}

function comment(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const blocks: ToolBlock[] = [];
  const body = str(input, 'body');
  if (body)
    blocks.push({
      type: 'text',
      label: null,
      open: false,
      tone: 'plain',
      text: body,
    });
  appendResult(blocks, result, isError, 'text');
  return {
    verb: 'Comment',
    subject: repoNumber(input),
    subjectStyle: 'plain',
    facets: [],
    blocks,
  };
}

/** `owner/repo#42`, or whichever half is present. */
function repoNumber(input: Json | undefined): string | null {
  const repo = str(input, 'repo');
  const number = int(input, 'number');
  if (repo && number !== null) return `${repo}#${number}`;
  if (repo) return repo;
  return number !== null ? `#${number}` : null;
}

// ---------------------------------------------------------------- browser

function browser(
  verb: string,
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const facets: string[] = [];
  const button = str(input, 'button');
  if (button) facets.push(button);
  if (bool(input, 'double_click')) facets.push('double');
  const delta = int(input, 'delta_y');
  if (delta !== null) facets.push(`dy ${delta}`);

  const x = int(input, 'x');
  const y = int(input, 'y');
  const blocks: ToolBlock[] = [];
  appendResult(blocks, result, isError, 'text');
  return {
    verb,
    subject: x !== null && y !== null ? `${x}, ${y}` : null,
    subjectStyle: 'plain',
    facets,
    blocks,
  };
}

function consoleCard(
  result: string | null,
  isError: boolean,
  verb = 'Console',
): ToolCard {
  const blocks: ToolBlock[] = [];
  if (!isError && result && result.length > 0)
    blocks.push({
      type: 'code',
      label: null,
      open: false,
      language: null,
      text: trimEnd(result),
    });
  return { verb, subject: null, subjectStyle: 'plain', facets: [], blocks };
}

// ---------------------------------------------------------------- sessions

function searchSessions(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const facets: string[] = [];
  const blocks: ToolBlock[] = [];
  if (!isError && result && result.length > 0) {
    const hits = rows(result);
    if (hits.length > 0) {
      facets.push(count(hits.length, 'hit', 'hits'));
      blocks.push({
        type: 'list',
        label: null,
        open: false,
        entries: hits.map(plainEntry),
      });
    }
  }

  return {
    verb: 'Search sessions',
    subject: str(input, 'query'),
    subjectStyle: 'plain',
    facets,
    blocks,
  };
}

function readSession(
  input: Json | undefined,
  result: string | null,
  isError: boolean,
): ToolCard {
  const facets: string[] = [];
  const from = int(input, 'from');
  if (from !== null) facets.push(`from ${from}`);
  const total = int(input, 'count');
  if (total !== null) facets.push(`${total} events`);

  const blocks: ToolBlock[] = [];
  appendResult(blocks, result, isError, 'text');
  return {
    verb: 'Read session',
    subject: str(input, 'session_id'),
    subjectStyle: 'plain',
    facets,
    blocks,
  };
}

// ---------------------------------------------------------------- 3D scenes

/** The line a scene tool ends its result with when the picture it returned was kept. */
const RENDER_MARKER = 'Render id: ';

/** `Guid.TryParse` for the forms a result could carry, as the C# writes it back: lower-case, dashed. */
function parseGuid(text: string): string | null {
  let hex: string | null = null;
  const dashed = /^[{(]?([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})[})]?$/i.exec(text);
  if (dashed) {
    const open = text[0];
    const close = text[text.length - 1];
    const wrapped = open === '{' || open === '(';
    if (wrapped !== (close === '}' || close === ')')) return null;
    if (wrapped && (open === '{') !== (close === '}')) return null;
    hex = dashed.slice(1).join('');
  } else if (/^[0-9a-f]{32}$/i.test(text)) hex = text;
  if (!hex) return null;
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * A scene tool's result: the stored picture's id, the revision it names, and
 * the text with the id line taken off — it is an address for the card, and
 * repeating it under the picture it fetched is noise. Three independent
 * lookups, so a reworded result loses a detail rather than the whole card.
 */
function readScene(result: string | null): { renderId: string | null; revision: number | null; text: string | null } {
  if (!result || result.length === 0) return { renderId: null, revision: null, text: result ?? null };

  let renderId: string | null = null;
  let text = result;
  const at = result.lastIndexOf(RENDER_MARKER);
  if (at >= 0) {
    let id = result.slice(at + RENDER_MARKER.length).trim();
    const end = id.search(/[ \n\r]/);
    if (end >= 0) id = id.slice(0, end);
    const parsed = parseGuid(id);
    if (parsed) {
      renderId = parsed;
      text = trimEnd(result.slice(0, at));
    }
  }

  let revision: number | null = null;
  const word = 'Revision ';
  const mark = text.indexOf(word);
  if (mark >= 0) {
    const digits = /^[0-9]+/.exec(text.slice(mark + word.length));
    if (digits) {
      const number = Number(digits[0]);
      if (number <= 2147483647) revision = number;
    }
  }
  return { renderId, revision, text };
}

function scene(
  verb: string,
  scenePath: string | null,
  facets: string[],
  blocks: ToolBlock[],
  result: string | null,
  isError: boolean,
): ToolCard {
  const { revision, text } = readScene(result);
  if (!isError && revision !== null && facets.length === 0) facets.push(`rev ${revision}`);
  appendResult(blocks, text, isError, 'text');
  return { verb, subject: scenePath, subjectStyle: 'path', facets, blocks };
}

/**
 * A modelling script: the script behind a disclosure, and — open, because it
 * is the point — the picture of what the script made.
 */
function sceneExec(input: Json | undefined, result: string | null, isError: boolean): ToolCard {
  const scenePath = str(input, 'scene');
  const { renderId, revision, text } = readScene(result);
  const facets: string[] = [];
  const blocks: ToolBlock[] = [];

  const code = str(input, 'code');
  const scriptPath = str(input, 'script_path');
  if (code) blocks.push({ type: 'code', label: 'script', open: false, language: 'csharp', text: code });
  else if (scriptPath) blocks.push({ type: 'text', label: 'script file', open: false, tone: 'plain', text: scriptPath });

  if (!isError && scenePath) {
    // "No revision made" names the revision the scene stayed at; the chip is
    // for a revision this call made.
    const made =
      text !== null && text.trimStart().startsWith('Note:')
        ? text.includes('\nRevision ')
        : text !== null && text.startsWith('Revision ');
    if (made && revision !== null) facets.push(`rev ${revision}`);
    if (renderId !== null)
      blocks.push({ type: 'scene', label: null, open: true, scene: scenePath, revision, renderId });
  }

  appendResult(blocks, text, isError, 'text');
  return { verb: 'Model', subject: scenePath, subjectStyle: 'path', facets, blocks };
}

function sceneRender(input: Json | undefined, result: string | null, isError: boolean): ToolCard {
  const scenePath = str(input, 'scene');
  const { renderId, revision, text } = readScene(result);
  const facets: string[] = [];
  const mode = str(input, 'mode');
  if (mode) facets.push(mode);
  const views = isObject(input) ? input.views : undefined;
  if (Array.isArray(views)) {
    const names = views.filter((v): v is string => typeof v === 'string');
    if (names.length > 0 && names.length <= 3) facets.push(names.join(' '));
    else if (names.length > 3) facets.push(`${names.length} views`);
  }

  const blocks: ToolBlock[] = [];
  if (!isError && scenePath && renderId !== null)
    blocks.push({ type: 'scene', label: null, open: true, scene: scenePath, revision, renderId });
  appendResult(blocks, text, isError, 'text');
  return { verb: 'Look at scene', subject: scenePath, subjectStyle: 'path', facets, blocks };
}

// ---------------------------------------------------------------- shared shapes

function named(
  verb: string,
  subject: string | null,
  result: string | null,
  isError: boolean,
  style: SubjectStyle = 'plain',
): ToolCard {
  const blocks: ToolBlock[] = [];
  appendResult(blocks, result, isError, 'text');
  return { verb, subject, subjectStyle: style, facets: [], blocks };
}

/**
 * Append the tool's output, unless the tool's own error handling will replace it
 * or it says nothing the header has not already said. `quietWhen` is the prefix
 * of a result that merely confirms the card's verb and subject — "Edited
 * src/Foo.cs" under a card headed "Edit src/Foo.cs" is the header again in a box.
 */
function appendResult(
  blocks: ToolBlock[],
  result: string | null,
  isError: boolean,
  style: 'text' | 'list',
  quietWhen?: string,
): void {
  if (isError || !result || result.length === 0) return;

  const trimmed = result.trim();
  if (trimmed.length === 0) return;
  if (
    quietWhen !== undefined &&
    trimmed.startsWith(quietWhen) &&
    !trimmed.includes('\n')
  )
    return;

  if (style === 'list') {
    const found = rows(trimmed);
    if (found.length > 0) {
      blocks.push({
        type: 'list',
        label: 'result',
        open: false,
        entries: found.map(plainEntry),
      });
      return;
    }
  }

  blocks.push({
    type: 'text',
    label: 'result',
    open: false,
    tone: 'plain',
    text: trimmed,
  });
}

// ---------------------------------------------------------------- reading JSON

function tryParseObject(json: string): Json | undefined {
  if (json.trim().length === 0) return undefined;
  try {
    return JSON.parse(json) as Json;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(input: Json | undefined, key: string): string | null {
  if (!isObject(input)) return null;
  const value = input[key];
  return typeof value === 'string' ? value : null;
}

/** Whole numbers only, matching the C# `TryGetInt32`. */
function int(input: Json | undefined, key: string): number | null {
  if (!isObject(input)) return null;
  const value = input[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function bool(input: Json | undefined, key: string): boolean {
  return isObject(input) && input[key] === true;
}

/** A property as display text, and whether it spans lines. */
function render(value: unknown): [string, boolean] {
  if (typeof value === 'string') return [value, value.includes('\n')];
  if (typeof value === 'number') return [String(value), false];
  if (typeof value === 'boolean') return [value ? 'true' : 'false', false];
  if (value === null || value === undefined) return ['', false];
  // ["bug","docs"] is a list of two words, and printing it as JSON to save three
  // lines of code is the habit this whole change is against.
  if (Array.isArray(value) && value.every(isScalar))
    return [value.map(v => render(v)[0]).join(', '), false];
  return [JSON.stringify(value), true];
}

function isScalar(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/** `true` shows as the bare key; everything else as key and value. */
function facet(key: string, value: unknown, rendered: string): string {
  const label = key.replace(/_/g, ' ');
  return value === true ? label : `${label} ${rendered}`;
}

// ---------------------------------------------------------------- small text helpers

/** `get_weather` → `Get weather`. */
export function humanize(name: string): string {
  const words = name.split(/[-_ ]+/).filter(w => w.length > 0);
  if (words.length === 0) return name;
  const head = words[0][0].toUpperCase() + words[0].slice(1);
  return words.length === 1 ? head : `${head} ${words.slice(1).join(' ')}`;
}

/** `String.TrimEnd()` — all trailing whitespace, not just newlines. */
function trimEnd(text: string): string {
  return text.replace(/\s+$/, '');
}

function lineCount(text: string): string {
  return count(splitLines(trimEnd(text)).length, 'line', 'lines');
}

function rows(text: string): string[] {
  return splitLines(trimEnd(text)).filter(l => l.length > 0);
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function plainEntry(text: string): ListEntry {
  return { text, detail: null };
}

/** Syntax hint from the extension. Absent is fine — the renderer falls back to plain mono. */
function languageOf(path: string | null): string | null {
  if (path === null) return null;
  // The extension of the last segment, the way Path.GetExtension reads it — a
  // dot in a directory name is not an extension.
  const name = path.slice(
    Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1,
  );
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  switch (name.slice(dot).toLowerCase()) {
    case '.cs':
      return 'csharp';
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.json':
      return 'json';
    case '.css':
      return 'css';
    case '.html':
    case '.razor':
    case '.cshtml':
      return 'html';
    case '.xml':
    case '.csproj':
    case '.props':
    case '.targets':
      return 'xml';
    case '.md':
      return 'markdown';
    case '.sh':
    case '.bash':
      return 'bash';
    case '.ps1':
      return 'powershell';
    case '.py':
      return 'python';
    case '.swift':
      return 'swift';
    case '.yml':
    case '.yaml':
      return 'yaml';
    case '.sql':
      return 'sql';
    case '.toml':
      return 'toml';
    default:
      return null;
  }
}
