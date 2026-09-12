/**
 * The fold. The double-encoded payload and the nested subagent envelope are the
 * two shapes most likely to be got wrong, so both are pinned here.
 */
import { TranscriptFolder, summarize } from '../src/api/transcript';
import type { AgentEventEnvelope } from '../src/api/contracts';

let ordinal = 0;

function event(kind: string, payload: unknown): AgentEventEnvelope {
  // payloadJson is a JSON *string*, not an object — the server nests it.
  return { ordinal: ordinal++, kind, payloadJson: JSON.stringify(payload) };
}

beforeEach(() => {
  ordinal = 0;
});

describe('TranscriptFolder', () => {
  it('renders a prompt and a reply', () => {
    const folder = new TranscriptFolder();

    const items = folder.fold([
      event('UserPrompt', { text: 'hello' }),
      event('AssistantText', { text: 'hi there' }),
    ]);

    expect(items.map(i => i.kind)).toEqual(['user', 'text']);
  });

  it('folds a finished tool call back into the row that started it', () => {
    const folder = new TranscriptFolder();

    folder.fold([
      event('ToolCallStarted', { toolName: 'Read', inputJson: '{"path":"a.ts"}' }),
      event('ToolCallFinished', { toolName: 'Read', result: 'contents', isError: false }),
    ]);

    const items = folder.all;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'tool', running: false, result: 'contents' });
  });

  it('leaves an unfinished tool call marked running', () => {
    const folder = new TranscriptFolder();

    folder.fold([event('ToolCallStarted', { toolName: 'Bash', inputJson: '{}' })]);

    expect(folder.all[0]).toMatchObject({ kind: 'tool', running: true });
  });

  it('suppresses update_plan, which renders as the plan itself', () => {
    const folder = new TranscriptFolder();

    folder.fold([
      event('ToolCallStarted', { toolName: 'update_plan', inputJson: '{}' }),
      event('PlanUpdated', { steps: [{ text: 'do it', status: 'in_progress' }] }),
    ]);

    expect(folder.all.map(i => i.kind)).toEqual(['plan']);
  });

  it('shows a suppressed tool after all when it failed', () => {
    // Otherwise the failure has no representation anywhere.
    const folder = new TranscriptFolder();

    folder.fold([
      event('ToolCallStarted', { toolName: 'update_plan', inputJson: '{}' }),
      event('ToolCallFinished', { toolName: 'update_plan', result: 'bad plan', isError: true }),
    ]);

    expect(folder.all).toHaveLength(1);
    expect(folder.all[0]).toMatchObject({ kind: 'tool', isError: true });
  });

  it('unwraps a subagent event and tags it with its id', () => {
    const folder = new TranscriptFolder();

    folder.fold([
      event('SubagentEvent', {
        subagentId: 3,
        innerKind: 'AssistantText',
        innerPayloadJson: JSON.stringify({ text: 'from the subagent' }),
      }),
    ]);

    expect(folder.all[0]).toMatchObject({ kind: 'text', sub: 3, text: 'from the subagent' });
  });

  it('folds a resolution into the approval card it belongs to', () => {
    const folder = new TranscriptFolder();

    folder.fold([
      event('ApprovalRequested', {
        requestId: 'abc',
        toolName: 'Bash',
        inputJson: 'rm -rf /',
        reason: 'looks destructive',
        refused: true,
      }),
      event('ApprovalResolved', { requestId: 'abc', approved: false }),
    ]);

    expect(folder.all).toHaveLength(1);
    expect(folder.all[0]).toMatchObject({ kind: 'approval', refused: true, approved: false });
  });

  it('skips an unknown kind instead of throwing', () => {
    // The server adds event kinds; an app in a store is always older than it.
    const folder = new TranscriptFolder();

    const items = folder.fold([
      event('SomethingInventedNextYear', { whatever: true }),
      event('AssistantText', { text: 'still here' }),
    ]);

    expect(items.map(i => i.kind)).toEqual(['text']);
  });

  it('produces nothing for usage reports', () => {
    const folder = new TranscriptFolder();

    folder.fold([event('UsageReport', { inputTokens: 10, outputTokens: 2 })]);

    expect(folder.all).toHaveLength(0);
  });

  it('only consumes what is new on a second fold', () => {
    const folder = new TranscriptFolder();
    const events = [event('AssistantText', { text: 'one' })];

    folder.fold(events);
    events.push(event('AssistantText', { text: 'two' }));
    const items = folder.fold(events);

    expect(items).toHaveLength(2);
  });

  it('survives a payload it cannot parse', () => {
    const folder = new TranscriptFolder();

    const items = folder.fold([{ ordinal: 0, kind: 'AssistantText', payloadJson: 'not json' }]);

    expect(items).toHaveLength(0);
  });
});

describe('summarize', () => {
  it('picks the first string out of a JSON input', () => {
    expect(summarize('{"path":"src/app.ts","limit":10}')).toBe('src/app.ts');
  });

  it('falls back to the raw text when it is not JSON', () => {
    expect(summarize('ls -la')).toBe('ls -la');
  });

  it('truncates rather than wrapping the row', () => {
    expect(summarize('x'.repeat(200)).length).toBe(80);
  });
});
