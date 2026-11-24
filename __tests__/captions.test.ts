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
