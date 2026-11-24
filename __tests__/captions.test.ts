/**
 * The transcript's captions say what the web's say: TranscriptGrouping's
 * ToolRunPhrase, PlanProgress, the thinking row and NoteLabel, rule for rule.
 */
import { planProgress, thoughtFor, toolRunPhrase, turnCompleteLabel } from '../src/api/captions';

const calls = (...names: string[]) => names.map(name => ({ name }));

describe('a tool run', () => {
  it('reads as a sentence in the order the work happened', () => {
    expect(toolRunPhrase(calls('read_file', 'read_file', 'edit_file', 'edit_file', 'run_bash', 'run_bash')))
      .toBe('Read 2 files, edited 2 files, ran 2 commands');
  });

  it('uses the singular for one', () => {
    expect(toolRunPhrase(calls('run_bash', 'read_file'))).toBe('Ran 1 command, read 1 file');
  });

  it('merges sibling tools into one clause', () => {
    expect(toolRunPhrase(calls('grep_files', 'find_files', 'grep_files'))).toBe('Ran 3 searches');
  });

  it('names an unknown tool rather than guessing at it', () => {
    expect(toolRunPhrase(calls('delete_artifact'))).toBe('Called delete_artifact');
    expect(toolRunPhrase(calls('publish_artifact', 'mcp_x', 'mcp_x'))).toBe('Requested 1 artifact publication, called mcp_x ×2');
  });

  it('counts failures last', () => {
    expect(toolRunPhrase([{ name: 'run_bash', isError: true }, { name: 'run_bash' }])).toBe('Ran 2 commands, 1 failed');
  });

  it('is empty for no calls', () => {
    expect(toolRunPhrase([])).toBe('');
  });
});

describe('the other captions', () => {
  it('counts plan steps done of all', () => {
    expect(planProgress([{ status: 'done' }, { status: 'done' }, { status: 'done' }, { status: 'in_progress' }]))
      .toBe('3 of 4 steps complete');
  });

  it('says how long thinking took, or only that it happened', () => {
    expect(thoughtFor(8000)).toBe('Thought for 8s');
    expect(thoughtFor(1234)).toBe('Thought for 1.2s');
    expect(thoughtFor(null)).toBe('Thinking');
  });

  it('labels a completed turn as the web does, a subagent turn as done', () => {
    expect(turnCompleteLabel(1200, false)).toBe('Turn complete · completed in 1.2s');
    expect(turnCompleteLabel(40, false)).toBe('Turn complete · completed in 40ms');
    expect(turnCompleteLabel(null, false)).toBe('Turn complete');
    expect(turnCompleteLabel(65_000, true)).toBe('done · completed in 1m 05s');
  });
});

describe('home and card labels', () => {
  const { ago, workspaceLabel, approvalVerdict } = jest.requireActual('../src/api/captions');
  const now = Date.parse('2026-11-24T12:00:00Z');

  it('says how long ago, the web way', () => {
    expect(ago('2026-11-24T11:59:30Z', now)).toBe('just now');
    expect(ago('2026-11-24T11:55:00Z', now)).toBe('5m ago');
    expect(ago('2026-11-24T10:00:00Z', now)).toBe('2h ago');
    expect(ago('2026-11-21T12:00:00Z', now)).toBe('3d ago');
  });

  it('names the workspace, and never turns unknown into zero', () => {
    expect(workspaceLabel({ repoNames: [] })).toBe('No repositories');
    expect(workspaceLabel({ repoNames: ['slopcoder'] })).toBe('slopcoder');
    expect(workspaceLabel({ repoNames: ['a', 'b'] })).toBe('2 repositories');
    expect(workspaceLabel({ repoNames: Array.from({ length: 32 }, (_, i) => `r${i}`) })).toBe('32+ repositories');
    expect(workspaceLabel({})).toBeNull();
    expect(workspaceLabel({ repoNames: null })).toBeNull();
  });

  it('words an approval verdict as the web does', () => {
    expect(approvalVerdict(true, false, false)).toBe('approved');
    expect(approvalVerdict(false, false, false)).toBe('denied');
    expect(approvalVerdict(null, false, false)).toBe('Read-only · no longer pending');
    expect(approvalVerdict(null, true, true)).toBe('refused');
    expect(approvalVerdict(null, true, false)).toBeNull();
  });
});
