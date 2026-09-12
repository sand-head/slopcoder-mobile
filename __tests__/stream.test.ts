/**
 * The reassembly rules. Every case here is one the server can actually produce,
 * and getting any of them wrong shows up as a transcript that is quietly missing
 * something rather than as an error.
 */
import { LiveAccumulator, SessionStream } from '../src/api/stream';
import type { AgentEventEnvelope, SessionState } from '../src/api/contracts';

function envelope(ordinal: number, kind = 'AssistantText'): AgentEventEnvelope {
  return { ordinal, kind, payloadJson: JSON.stringify({ text: `#${ordinal}` }) };
}

function state(nextOrdinal: number): SessionState {
  return { nextOrdinal } as SessionState;
}

describe('SessionStream', () => {
  it('appends events that follow the cursor', () => {
    const stream = new SessionStream();
    stream.seed(0, [envelope(0), envelope(1)]);

    const outcome = stream.apply(state(3), [envelope(2)]);

    expect(stream.nextOrdinal).toBe(3);
    expect(outcome.needsPull).toBe(false);
  });

  it('skips a duplicate rather than storing it twice', () => {
    const stream = new SessionStream();
    stream.seed(0, [envelope(0), envelope(1)]);

    stream.apply(state(2), [envelope(1)]);

    expect(stream.all).toHaveLength(2);
  });

  it('asks for a pull when a push was missed', () => {
    const stream = new SessionStream();
    stream.seed(0, [envelope(0)]);

    // Ordinal 1 never arrived, so 2 cannot be stored without leaving a hole.
    const outcome = stream.apply(state(3), [envelope(2)]);

    expect(outcome).toEqual({ needsPull: true, fromOrdinal: 1 });
    expect(stream.all).toHaveLength(1);
  });

  it('notices a gap even when the push carried no events at all', () => {
    // This is the reconnect case: re-subscribing delivers state and nothing else.
    const stream = new SessionStream();
    stream.seed(0, [envelope(0)]);

    expect(stream.apply(state(9), []).needsPull).toBe(true);
  });

  it('refuses a page that does not abut the head', () => {
    const stream = new SessionStream();
    stream.seed(10, [envelope(10)]);

    expect(stream.prepend(5, [envelope(5)])).toBe(false);
    expect(stream.prepend(8, [envelope(8), envelope(9)])).toBe(true);
    expect(stream.firstOrdinal).toBe(8);
  });
});

describe('LiveAccumulator', () => {
  it('appends growth when the lengths agree', () => {
    const live = new LiveAccumulator();

    live.apply({ textFrom: 0, textAppend: 'Hel', thinkingFrom: 0, thinkingAppend: '' });
    live.apply({ textFrom: 3, textAppend: 'lo', thinkingFrom: 0, thinkingAppend: '' });

    expect(live.snapshot?.text).toBe('Hello');
    expect(live.needsSeed).toBe(false);
  });

  it('treats a from of zero as a new turn rather than an append', () => {
    const live = new LiveAccumulator();
    live.seed({ text: 'previous turn', thinking: '' });

    live.apply({ textFrom: 0, textAppend: 'fresh', thinkingFrom: 0, thinkingAppend: '' });

    expect(live.snapshot?.text).toBe('fresh');
  });

  it('trims the overlap when the sender resends', () => {
    const live = new LiveAccumulator();
    live.seed({ text: 'Hello world', thinking: '' });

    live.apply({ textFrom: 5, textAppend: ' there', thinkingFrom: 0, thinkingAppend: '' });

    expect(live.snapshot?.text).toBe('Hello there');
  });

  it('flags a re-seed when it is behind the sender', () => {
    // Nothing in the patch stream can repair this — only a fresh GET can.
    const live = new LiveAccumulator();
    live.seed({ text: 'Hi', thinking: '' });

    live.apply({ textFrom: 50, textAppend: '!', thinkingFrom: 0, thinkingAppend: '' });

    expect(live.needsSeed).toBe(true);
    expect(live.snapshot?.text).toBe('Hi');
  });

  it('clears on a null patch, because no turn is streaming', () => {
    const live = new LiveAccumulator();
    live.seed({ text: 'mid-turn', thinking: 'hmm' });

    live.apply(null);

    expect(live.snapshot).toBeNull();
  });
});
