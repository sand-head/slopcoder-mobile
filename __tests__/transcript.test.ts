/**
 * The fold. The double-encoded payload and the nested subagent envelope are the
 * two shapes most likely to be got wrong, so both are pinned here.
 */
import {
  TranscriptFolder,
  groupSubagents,
  subagentDetail,
  subagentState,
  summarize,
} from '../src/api/transcript';
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

  /** Images ride the prompt as the seam persisted them, or not at all. */
  it("carries a prompt's images through, and reads an old prompt as having none", () => {
    const folder = new TranscriptFolder();

    const items = folder.fold([
      event('UserPrompt', {
        text: 'what is this',
        images: [{ mediaType: 'image/jpeg', base64Data: 'QUJD' }],
      }),
      event('UserPrompt', { text: 'plain' }),
      event('UserPrompt', {
        text: 'odd',
        images: [{ mediaType: 'image/png' }, null],
      }),
    ]);

    expect(items.map(i => (i.kind === 'user' ? i.images : null))).toEqual([
      [{ mediaType: 'image/jpeg', base64Data: 'QUJD' }],
      [],
      [],
    ]);
  });

  it('folds a finished tool call back into the row that started it', () => {
    const folder = new TranscriptFolder();

    folder.fold([
      event('ToolCallStarted', {
        toolName: 'Read',
        inputJson: '{"path":"a.ts"}',
      }),
      event('ToolCallFinished', {
        toolName: 'Read',
        result: 'contents',
        isError: false,
      }),
    ]);

    const items = folder.all;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'tool',
      running: false,
      result: 'contents',
    });
  });

  it('leaves an unfinished tool call marked running', () => {
    const folder = new TranscriptFolder();

    folder.fold([
      event('ToolCallStarted', { toolName: 'Bash', inputJson: '{}' }),
    ]);

    expect(folder.all[0]).toMatchObject({ kind: 'tool', running: true });
  });

  it('suppresses update_plan, which renders as the plan itself', () => {
    const folder = new TranscriptFolder();

    folder.fold([
      event('ToolCallStarted', { toolName: 'update_plan', inputJson: '{}' }),
      event('PlanUpdated', {
        steps: [{ text: 'do it', status: 'in_progress' }],
      }),
    ]);

    expect(folder.all.map(i => i.kind)).toEqual(['plan']);
  });

  it('shows a suppressed tool after all when it failed', () => {
    // Otherwise the failure has no representation anywhere.
    const folder = new TranscriptFolder();

    folder.fold([
      event('ToolCallStarted', { toolName: 'update_plan', inputJson: '{}' }),
      event('ToolCallFinished', {
        toolName: 'update_plan',
        result: 'bad plan',
        isError: true,
      }),
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

    expect(folder.all[0]).toMatchObject({
      kind: 'text',
      sub: 3,
      text: 'from the subagent',
    });
  });

  it('anchors a sub-session where it was opened and lets its close pass', () => {
    const folder = new TranscriptFolder();

    folder.fold([
      event('SubSessionOpened', {
        subSessionId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        name: 'relay tests',
        model: 'claude-sonnet-5',
        profile: 'coder',
        routeReason: null,
        persona: 'Ada',
        color: 'violet',
      }),
      event('SubSessionClosed', {
        subSessionId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      }),
    ]);

    expect(folder.all).toHaveLength(1);
    expect(folder.all[0]).toMatchObject({
      kind: 'subsession',
      sub: null,
      subSessionId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      name: 'relay tests',
      profile: 'coder',
      persona: 'Ada',
      color: 'violet',
    });
    // Its own item, never grouped: the card reads the sub-session's own stream.
    expect(groupSubagents(folder.all).map(r => r.kind)).toEqual(['subsession']);
  });

  it("a partner's reply is its own item, never one that reads as the user's", () => {
    const folder = new TranscriptFolder();

    folder.fold([
      event('SubSessionReplied', {
        subSessionId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        persona: 'Ada',
        name: 'push relay',
        turn: 2,
        text: 'Relay.cs, Push.cs and Dedupe.cs are the ones that matter.',
        isError: false,
        color: 'violet',
      }),
    ]);

    // Sub-sessions run on their own clock, so this reply is the prompt of the
    // turn beneath it. It must never fold into a `user` item: nobody typed it.
    expect(folder.all).toEqual([
      expect.objectContaining({
        kind: 'subsession-reply',
        persona: 'Ada',
        name: 'push relay',
        text: 'Relay.cs, Push.cs and Dedupe.cs are the ones that matter.',
        isError: false,
        color: 'violet',
        // No flag on the wire (or an older server): it started the turn.
        interjected: false,
      }),
    ]);
  });

  it('a reply that interrupted the agent says so', () => {
    const folder = new TranscriptFolder();

    folder.fold([
      event('SubSessionReplied', {
        subSessionId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        persona: 'Ada',
        name: 'push relay',
        turn: 4,
        text: 'the relay tests pass now.',
        isError: false,
        color: 'violet',
        interjected: true,
      }),
    ]);

    // Same card, different meaning: this one landed inside a turn the agent was
    // already having rather than being the reason one began.
    expect(folder.all).toEqual([
      expect.objectContaining({ kind: 'subsession-reply', interjected: true }),
    ]);
  });

  it('a revived or promoted sub-session leaves a note, and a failed reply says so', () => {
    const folder = new TranscriptFolder();

    folder.fold([
      event('SubSessionReopened', {
        subSessionId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      }),
      event('SubSessionPromoted', {
        subSessionId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        profile: 'coder',
      }),
      event('SubSessionReplied', {
        subSessionId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        persona: 'Ada',
        name: 'push relay',
        turn: 3,
        text: 'the provider fell over',
        isError: true,
        color: 'violet',
      }),
    ]);

    expect(folder.all.map(item => item.kind)).toEqual([
      'note',
      'note',
      'subsession-reply',
    ]);
    expect(folder.all[0]).toMatchObject({ text: 'sub-session picked back up' });
    expect(folder.all[1]).toMatchObject({
      text: 'sub-session promoted to coder',
    });
    expect(folder.all[2]).toMatchObject({ isError: true });
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
    expect(folder.all[0]).toMatchObject({
      kind: 'approval',
      refused: true,
      approved: false,
    });
  });

  /**
   * The contract the transcript's memoized rows are built on. A row is only
   * re-rendered when its item is a different object, so an item that changed
   * while keeping its identity is a result that never reaches the screen.
   */
  it('gives an item a new identity when it changes, and leaves the rest alone', () => {
    const folder = new TranscriptFolder();

    folder.fold([
      event('AssistantText', { text: 'working on it' }),
      event('ToolCallStarted', { toolName: 'Read', inputJson: '{}' }),
    ]);
    const [textBefore, toolBefore] = folder.all;

    folder.fold([
      event('AssistantText', { text: 'working on it' }),
      event('ToolCallStarted', { toolName: 'Read', inputJson: '{}' }),
      event('ToolCallFinished', {
        toolName: 'Read',
        result: 'contents',
        isError: false,
      }),
    ]);

    expect(folder.all[1]).not.toBe(toolBefore);
    expect(folder.all[1]).toMatchObject({
      kind: 'tool',
      running: false,
      result: 'contents',
    });
    // The row above it did not change, so nothing should think it did.
    expect(folder.all[0]).toBe(textBefore);
    // And the item the screen already rendered is not rewritten under it.
    expect(toolBefore).toMatchObject({ running: true, result: null });
  });

  /**
   * Every push from the hub re-folds. Almost none of them add an event, and the
   * screen needs to be able to tell, or it re-renders the whole window.
   */
  it('only moves its revision when the fold actually changed', () => {
    const folder = new TranscriptFolder();
    const events = [event('UserPrompt', { text: 'go' })];

    folder.fold(events);
    const settled = folder.revision;

    folder.fold(events);
    folder.fold(events);
    expect(folder.revision).toBe(settled);

    folder.fold([...events, event('AssistantText', { text: 'done' })]);
    expect(folder.revision).toBeGreaterThan(settled);
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

    const items = folder.fold([
      { ordinal: 0, kind: 'AssistantText', payloadJson: 'not json' },
    ]);

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

/** A subagent's event, wrapped the way the server nests it. */
function subEvent(
  subagentId: number,
  innerKind: string,
  inner: unknown,
): AgentEventEnvelope {
  return event('SubagentEvent', {
    subagentId,
    innerKind,
    innerPayloadJson: JSON.stringify(inner),
  });
}

describe('groupSubagents', () => {
  it('gathers each subagent under one row anchored where it first appeared', () => {
    const folder = new TranscriptFolder();
    folder.fold([
      event('UserPrompt', { text: 'fan out' }),
      event('SubagentStarted', {
        subagentId: 1,
        task: 'search the tree',
        model: 'haiku',
      }),
      event('SubagentStarted', {
        subagentId: 2,
        task: 'read the docs',
        model: 'haiku',
      }),
      subEvent(1, 'ToolCallStarted', { toolName: 'grep', inputJson: '{}' }),
      subEvent(2, 'ToolCallStarted', {
        toolName: 'read_file',
        inputJson: '{}',
      }),
      subEvent(1, 'ToolCallFinished', {
        toolName: 'grep',
        result: '',
        isError: false,
      }),
      event('AssistantText', { text: 'meanwhile, on the main thread' }),
      subEvent(2, 'AssistantText', { text: 'the docs say…' }),
      subEvent(1, 'TurnCompleted', {}),
    ]);

    const rows = groupSubagents(folder.all);

    expect(rows.map(r => r.kind)).toEqual([
      'user',
      'subagent',
      'subagent',
      'text',
    ]);
    const [, one, two] = rows;
    expect(one).toMatchObject({
      kind: 'subagent',
      subagentId: 1,
      task: 'search the tree',
      model: 'haiku',
    });
    expect(two).toMatchObject({
      kind: 'subagent',
      subagentId: 2,
      task: 'read the docs',
    });
    if (one.kind !== 'subagent' || two.kind !== 'subagent')
      throw new Error('not grouped');
    // Interleaving does not fragment either thread, and the start row itself
    // is the group, not an item inside it.
    expect(one.items.map(i => i.kind)).toEqual(['tool', 'note']);
    expect(two.items.map(i => i.kind)).toEqual(['tool', 'text']);
  });

  it('still groups a thread whose start is not in the loaded window', () => {
    const folder = new TranscriptFolder();
    folder.fold([subEvent(7, 'AssistantText', { text: 'late' })]);

    const rows = groupSubagents(folder.all);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'subagent',
      subagentId: 7,
      task: '',
    });
  });

  it('keeps a row for a subagent that has said nothing yet', () => {
    const folder = new TranscriptFolder();
    folder.fold([
      event('SubagentStarted', { subagentId: 1, task: 'think', model: 'opus' }),
    ]);

    const rows = groupSubagents(folder.all);
    expect(rows[0]).toMatchObject({ kind: 'subagent', items: [] });
    expect(subagentState([])).toBe('running');
  });
});

describe('subagentState', () => {
  const thread = (...kinds: string[]) => {
    const folder = new TranscriptFolder();
    folder.fold(
      kinds.map(kind =>
        subEvent(1, kind, kind === 'AgentError' ? { message: 'boom' } : {}),
      ),
    );
    return folder.all;
  };

  it('is running until the turn ends', () => {
    expect(subagentState(thread('ThinkingText'))).toBe('running');
  });

  it('is done on a completed turn', () => {
    expect(subagentState(thread('ThinkingText', 'TurnCompleted'))).toBe('done');
  });

  it('lets a failure win over a completion, and a stop over both', () => {
    expect(subagentState(thread('AgentError', 'TurnCompleted'))).toBe('failed');
    expect(subagentState(thread('TurnCancelled', 'TurnCompleted'))).toBe(
      'cancelled',
    );
    expect(subagentState(thread('TurnCancelled', 'AgentError'))).toBe('failed');
  });

  it('says what a running subagent is doing', () => {
    const folder = new TranscriptFolder();
    folder.fold([
      subEvent(1, 'ToolCallStarted', { toolName: 'grep', inputJson: '{}' }),
    ]);
    expect(subagentDetail(folder.all)).toBe('grep…');
    folder.fold([
      subEvent(1, 'ToolCallStarted', { toolName: 'grep', inputJson: '{}' }),
      subEvent(1, 'ToolCallFinished', {
        toolName: 'grep',
        result: '',
        isError: false,
      }),
    ]);
    expect(subagentDetail(folder.all)).toBe('grep');
    expect(subagentDetail([])).toBe('working…');
  });
});
