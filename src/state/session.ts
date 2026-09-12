/**
 * One session's live view: the state, the folded transcript, and the streaming
 * tail — kept outside React so a 75ms push does not re-render the world.
 *
 * This is where the gap machinery is actually wired: `SessionStream` notices a
 * missed push, `LiveAccumulator` notices missed growth, and both are healed here
 * by pulling rather than by hoping the next push repairs it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { LiveSnapshot, SessionState } from '../api/contracts';
import type { Seam } from '../api/seam';
import type { DeltaHandler, SessionHub } from '../api/hub';
import { LiveAccumulator, SessionStream } from '../api/stream';
import { TranscriptFolder, type Item } from '../api/transcript';

/** How much scrollback to open with. Earlier pages load on demand. */
const INITIAL_WINDOW = 120;

/** The sandbox reaper's clock wants bumping while someone is watching. */
const PRESENCE_INTERVAL_MS = 60_000;

export interface SessionView {
  state: SessionState | null;
  items: readonly Item[];
  live: LiveSnapshot | null;
  loading: boolean;
  error: string | null;
  canLoadEarlier: boolean;
  loadEarlier: () => void;
}

export function useSession(seam: Seam | null, hub: SessionHub | null, id: string): SessionView {
  const stream = useRef(new SessionStream()).current;
  const accumulator = useRef(new LiveAccumulator()).current;
  const folder = useRef(new TranscriptFolder()).current;
  const pulling = useRef(false);

  const [state, setState] = useState<SessionState | null>(null);
  const [items, setItems] = useState<readonly Item[]>([]);
  const [live, setLive] = useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canLoadEarlier, setCanLoadEarlier] = useState(false);

  // One render pass per push, whatever changed.
  const publish = useRef((next: SessionState) => {
    setState(next);
    setItems([...folder.fold(stream.all)]);
    setLive(accumulator.snapshot);
    setCanLoadEarlier(stream.firstOrdinal > 0);
  }).current;

  /**
   * Pull whatever we missed, in order, until caught up. Single-flight: a burst
   * of pushes during a gap must not start a fetch each.
   */
  const pullGap = useRef(async (from: number, next: SessionState) => {
    if (!seam || pulling.current) return;
    pulling.current = true;
    try {
      let cursor = from;
      while (cursor < next.nextOrdinal) {
        const missed = await seam.scrollback(id, cursor);
        if (missed.length === 0) break;
        if (!stream.append(missed)) break;
        cursor = stream.nextOrdinal;
      }
      publish(next);
    } finally {
      pulling.current = false;
    }
  }).current;

  const reseed = useRef(async () => {
    if (!seam) return;
    const fresh = await seam.session(id);
    if (fresh) {
      accumulator.seed(fresh.live);
      publish(fresh);
    }
  }).current;

  useEffect(() => {
    if (!seam || !hub) return;
    let cancelled = false;

    const onDelta: DeltaHandler = (sessionId, next, events, patch) => {
      if (sessionId !== id || cancelled) return;

      const outcome = stream.apply(next, events);
      accumulator.apply(patch);

      if (accumulator.needsSeed) {
        void reseed();
        return;
      }
      if (outcome.needsPull) {
        void pullGap(outcome.fromOrdinal, next);
        return;
      }
      publish(next);
    };

    hub.addListener(id, onDelta);

    (async () => {
      try {
        const seed = await seam.session(id);
        if (!seed || cancelled) {
          if (!cancelled) setError('That session is gone.');
          return;
        }

        const from = Math.max(0, seed.nextOrdinal - INITIAL_WINDOW);
        const events = await seam.scrollback(id, from);
        if (cancelled) return;

        stream.seed(from, events);
        accumulator.seed(seed.live);
        folder.refold(stream.all);
        publish(seed);
        setLoading(false);

        // Subscribing returns a fresher seed than the fetch above; fold it in
        // so nothing that landed in between is lost.
        const live2 = await hub.subscribe(id);
        if (live2 && !cancelled) {
          const outcome = stream.apply(live2, []);
          if (outcome.needsPull) await pullGap(outcome.fromOrdinal, live2);
          else publish(live2);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      hub.removeListener(id, onDelta);
      void hub.unsubscribe(id);
    };
  }, [seam, hub, id, accumulator, folder, stream, publish, pullGap, reseed]);

  // Presence: on open, then while the app is in front.
  useEffect(() => {
    if (!seam) return;
    void seam.presence(id);

    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void seam.presence(id);
    }, PRESENCE_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [seam, id]);

  const loadEarlier = useMemo(
    () => () => {
      if (!seam || stream.firstOrdinal === 0) return;
      const take = Math.min(INITIAL_WINDOW, stream.firstOrdinal);
      const from = stream.firstOrdinal - take;
      void seam.scrollback(id, from, take).then(older => {
        if (stream.prepend(from, older)) {
          folder.refold(stream.all);
          setItems([...folder.all]);
          setCanLoadEarlier(stream.firstOrdinal > 0);
        }
      });
    },
    [seam, id, stream, folder],
  );

  return { state, items, live, loading, error, canLoadEarlier, loadEarlier };
}
