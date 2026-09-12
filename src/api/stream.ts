/**
 * Reassembling a transcript from pushes, ported from
 * `SlopCoder.Web.Client/Sessions/SessionStream.cs` and
 * `SlopCoder.Client/LiveAccumulator.cs`.
 *
 * The server pushes deltas, not snapshots: appended events since the last push,
 * plus the *growth* of the streaming text. Both can be missed — a dropped
 * WebSocket frame, a backgrounded app, a reconnect — so both carry enough
 * information to notice, and the client heals by pulling.
 */
import type { AgentEventEnvelope, LivePatch, LiveSnapshot, SessionState } from './contracts';

/** What {@link SessionStream.apply} decided the caller must do next. */
export interface SyncOutcome {
  /** Events were missed; pull scrollback from {@link fromOrdinal}. */
  needsPull: boolean;
  fromOrdinal: number;
}

/**
 * A window onto the scrollback. The app holds a tail, not the whole history —
 * a long session's transcript is unbounded and the phone does not want it.
 */
export class SessionStream {
  private first = 0;
  private events: AgentEventEnvelope[] = [];

  /** The ordinal one past the end of what is held. */
  get nextOrdinal(): number {
    return this.first + this.events.length;
  }

  get firstOrdinal(): number {
    return this.first;
  }

  get all(): readonly AgentEventEnvelope[] {
    return this.events;
  }

  /** Seed from a fetched window. */
  seed(from: number, events: AgentEventEnvelope[]): void {
    this.first = from;
    this.events = [...events];
  }

  reset(): void {
    this.first = 0;
    this.events = [];
  }

  /**
   * Fold a push in. Events at or below the cursor are duplicates and skipped;
   * an event beyond it means a gap, so the loop stops rather than storing
   * something out of order — `needsPull` then tells the caller to fetch it.
   */
  apply(state: SessionState, incoming: readonly AgentEventEnvelope[]): SyncOutcome {
    for (const envelope of incoming) {
      if (envelope.ordinal < this.nextOrdinal) continue;
      if (envelope.ordinal > this.nextOrdinal) break;
      this.events.push(envelope);
    }

    return this.nextOrdinal < state.nextOrdinal
      ? { needsPull: true, fromOrdinal: this.nextOrdinal }
      : { needsPull: false, fromOrdinal: this.nextOrdinal };
  }

  /** Extend the window backwards. A page that does not abut the head is refused. */
  prepend(from: number, older: AgentEventEnvelope[]): boolean {
    if (older.length === 0) return false;
    if (from + older.length !== this.first) return false;

    this.events = [...older, ...this.events];
    this.first = from;
    return true;
  }

  /** Append a pulled gap. Returns false if it does not butt against the tail. */
  append(events: AgentEventEnvelope[]): boolean {
    let landed = false;
    for (const envelope of events) {
      if (envelope.ordinal < this.nextOrdinal) continue;
      if (envelope.ordinal > this.nextOrdinal) return landed;
      this.events.push(envelope);
      landed = true;
    }
    return landed;
  }
}

/**
 * Re-accumulates {@link LivePatch} growth into the snapshot the UI renders.
 *
 * `textFrom` is the sender's length at the *previous* push. Three cases, and
 * only the third is subtle: if our length is behind the sender's, a push was
 * missed and the text we hold is wrong — the caller must re-seed from
 * `GET /sessions/{id}` and take `state.live`, because nothing in the patch
 * stream will ever repair it.
 */
export class LiveAccumulator {
  private thinking = '';
  private text = '';
  private stale = false;

  /** True once a patch proved a push was missed; cleared by {@link seed}. */
  get needsSeed(): boolean {
    return this.stale;
  }

  get snapshot(): LiveSnapshot | null {
    return this.thinking.length === 0 && this.text.length === 0
      ? null
      : { thinking: this.thinking, text: this.text };
  }

  seed(live: LiveSnapshot | null | undefined): void {
    this.thinking = live?.thinking ?? '';
    this.text = live?.text ?? '';
    this.stale = false;
  }

  clear(): void {
    this.thinking = '';
    this.text = '';
    this.stale = false;
  }

  /** A null patch means no turn is streaming — drop what was accumulated. */
  apply(patch: LivePatch | null | undefined): void {
    if (!patch) {
      this.clear();
      return;
    }

    this.thinking = this.grow(this.thinking, patch.thinkingFrom, patch.thinkingAppend);
    this.text = this.grow(this.text, patch.textFrom, patch.textAppend);
  }

  private grow(current: string, from: number, append: string): string {
    if (append.length === 0) {
      // A `from` of 0 with nothing to add is a new, empty turn.
      return from === 0 ? '' : current;
    }

    // New turn: replace rather than append.
    if (from === 0) return append;

    if (current.length === from) return current + append;

    // We are ahead of the sender — trim the overlap it is about to resend.
    if (current.length > from) return current.slice(0, from) + append;

    // We are behind. Nothing here can repair that; only a re-seed can.
    this.stale = true;
    return current;
  }
}
