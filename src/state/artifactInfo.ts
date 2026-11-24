/**
 * What a transcript's artifact card needs to know before it can show the
 * artifact inline: its content type and size.
 *
 * The card event carries a name, a kind and an id, not a content type, so a
 * binary artifact ("File") has to be asked about. A long transcript can hold
 * dozens of those, and opening it must not become dozens of requests: so a
 * card only asks once it has been on screen, every card for one artifact
 * shares one request, and no more than {@link MAX_CONCURRENT} are in flight
 * at once — the rest wait their turn in the order they were asked for.
 *
 * Only the summary is kept, never a body; it is held for the life of the
 * signed-in seam, like the transcript it belongs to. A failure is not
 * remembered, so the next look retries; "gone" (a 404) is.
 */
import type { ArtifactSummary } from '../api/contracts';
import type { Seam } from '../api/seam';

export const MAX_CONCURRENT = 2;

/** A summary, or null for an artifact that is gone or was never this account's. */
export type ArtifactInfo = ArtifactSummary | null;

interface Cache {
  done: Map<string, ArtifactInfo>;
  inflight: Map<string, Promise<ArtifactInfo>>;
}

const caches = new WeakMap<object, Cache>();
let running = 0;
const waiting: (() => void)[] = [];

function cacheFor(seam: object): Cache {
  let cache = caches.get(seam);
  if (!cache) {
    cache = { done: new Map(), inflight: new Map() };
    caches.set(seam, cache);
  }
  return cache;
}

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>(resolve => waiting.push(resolve));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Already known, without asking: a summary, null for gone, undefined for not yet. */
export function knownArtifactInfo(seam: Seam, id: string): ArtifactInfo | undefined {
  return cacheFor(seam).done.get(id);
}

/** The summary, shared with every other caller asking about the same artifact. */
export function artifactInfo(seam: Pick<Seam, 'artifact'>, id: string): Promise<ArtifactInfo> {
  const cache = cacheFor(seam);
  if (cache.done.has(id)) return Promise.resolve(cache.done.get(id)!);
  const pending = cache.inflight.get(id);
  if (pending) return pending;

  const request = slot(() => seam.artifact(id))
    .then(detail => {
      // Keep the summary only: a text body has no business in this cache.
      const info = detail ? detail.artifact : null;
      cache.done.set(id, info);
      return info;
    })
    .finally(() => cache.inflight.delete(id));
  cache.inflight.set(id, request);
  return request;
}

/** For tests: forget everything and the queue with it. */
export function resetArtifactInfo(): void {
  running = 0;
  waiting.length = 0;
}
