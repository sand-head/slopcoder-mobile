/**
 * The transcript's disclosure captions, in the web cockpit's words.
 *
 * A port of `TranscriptGrouping.ToolRunPhrase`, `SessionDetail.PlanProgress`,
 * the thinking row's "Thought for …" and `NoteLabel` — the same rules, so a
 * collapsed run reads "Read 2 files, edited 2 files, ran 2 commands" here as it
 * does there, rather than a tally of tool names.
 */
import { duration } from './routines';

/** Verb, singular and plural-with-count per tool name, as the web phrases them. */
const PHRASING: Record<string, readonly [verb: string, singular: string, plural: string]> = {
  read_file: ['read', '1 file', '{0} files'],
  write_file: ['wrote', '1 file', '{0} files'],
  edit_file: ['edited', '1 file', '{0} files'],
  list_dir: ['listed', '1 directory', '{0} directories'],
  grep_files: ['ran', '1 search', '{0} searches'],
  find_files: ['ran', '1 search', '{0} searches'],
  run_bash: ['ran', '1 command', '{0} commands'],
  bash_output: ['checked', '1 job', '{0} jobs'],
  shell_monitor: ['checked', '1 job', '{0} jobs'],
  kill_job: ['stopped', '1 job', '{0} jobs'],
  fetch_url: ['fetched', '1 page', '{0} pages'],
  web_search: ['ran', '1 web search', '{0} web searches'],
  skill: ['used', '1 skill', '{0} skills'],
  publish_artifact: ['requested', '1 artifact publication', '{0} artifact publications'],
  code_review_start: ['requested', '1 code review', '{0} code reviews'],
  code_review_start_range: ['requested', '1 code review', '{0} code reviews'],
  code_review_start_snapshot: ['requested', '1 code review', '{0} code reviews'],
};

/**
 * "Read 3 files, ran 2 commands, 1 failed". Sibling tools merge into one clause
 * (grep and find are both searches); an unknown tool — an MCP server's — reads
 * "called {name}" or "called {name} ×N". Clauses keep first-appearance order, so
 * the phrase follows the order the work happened in. Calls are oldest first.
 */
export function toolRunPhrase(calls: readonly { name: string; isError?: boolean }[]): string {
  const counts = new Map<string, { kind: readonly [string, string, string]; count: number }>();
  for (const { name } of calls) {
    const kind = PHRASING[name] ?? (['called', name, `${name} ×{0}`] as const);
    const key = kind.join('\u0000');
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { kind, count: 1 });
  }
  const clauses = [...counts.values()].map(({ kind: [verb, singular, plural], count }) =>
    count === 1 ? `${verb} ${singular}` : `${verb} ${plural.replace('{0}', String(count))}`,
  );
  const failed = calls.filter(call => call.isError).length;
  if (failed > 0) clauses.push(`${failed} failed`);
  const phrase = clauses.join(', ');
  return phrase.length === 0 ? '' : phrase[0].toUpperCase() + phrase.slice(1);
}

/** "3 of 4 steps complete". */
export function planProgress(steps: readonly { status: string }[]): string {
  return `${steps.filter(step => step.status === 'done').length} of ${steps.length} steps complete`;
}

/** "Thought for 8s" when the provider timed it; "Thinking" when it did not. */
export function thoughtFor(durationMs: number | null | undefined): string {
  return durationMs != null ? `Thought for ${duration(durationMs)}` : 'Thinking';
}

/**
 * A completed turn's note: "Turn complete · completed in 1.2s" for the session's
 * own turn, "done · completed in …" for a subagent's, as the web labels them.
 */
export function turnCompleteLabel(durationMs: number | null | undefined, subagent: boolean): string {
  const base = subagent ? 'done' : 'Turn complete';
  return durationMs != null ? `${base} · completed in ${duration(durationMs)}` : base;
}

/** "just now", "5m ago", "2h ago", "3d ago" — the web's TimeFormat.Ago. */
export function ago(at: string, now: number = Date.now()): string {
  const delta = now - Date.parse(at);
  if (!(delta >= 60_000)) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

/** The server's cap on repository names in a summary (SessionSummary.MaxRepoNames). */
const MAX_REPO_NAMES = 32;

/**
 * What a recent-sessions row says the session works on, as the web's
 * RecentWorkspaceLabel: "No repositories", the one repository's name, "N
 * repositories". Null when the server did not say — unknown is never zero — and
 * for a client-machine workspace, whose label this app's contract cannot build.
 */
export function workspaceLabel(session: { repoNames?: readonly string[] | null; clientWorkspace?: unknown }): string | null {
  if (session.clientWorkspace) return null;
  const names = session.repoNames;
  if (names == null) return null;
  if (names.length === 0) return 'No repositories';
  if (names.length === 1) return names[0];
  if (names.length >= MAX_REPO_NAMES) return `${MAX_REPO_NAMES}+ repositories`;
  return `${names.length} repositories`;
}

/** The approval card's verdict, worded as the web's; null while it is open. */
export function approvalVerdict(approved: boolean | null | undefined, pending: boolean, refused: boolean): string | null {
  if (approved === true) return 'approved';
  if (approved === false) return 'denied';
  if (!pending) return 'Read-only · no longer pending';
  if (refused) return 'refused';
  return null;
}
