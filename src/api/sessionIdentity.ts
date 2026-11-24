import { SessionStatus, type SessionSummary } from './contracts';

/**
 * Shared session handle tint and refresh coalescing, including historical
 * transcript attribution after the removal of live shared rooms.
 */

/** `SubSessionPalette.All`, in order — the hash below indexes into it. */
const PALETTE = ['violet', 'amber', 'sky', 'rose', 'teal', 'fuchsia', 'indigo', 'orange'] as const;

/**
 * A stable colour per handle, so one session reads as the same shade in every
 * message, in the member list, and on the web. The same hash as the web's
 * `Tint`: 31-multiplied UTF-16 units of the lower-cased handle, wrapped to 32
 * bits, taken unsigned modulo the palette.
 */
export function handleTint(handle: string): string {
  /* eslint-disable no-bitwise -- C#'s int32 wrap and its (uint) cast, exactly. */
  let hash = 0;
  for (const unit of handle.toLowerCase()) {
    for (let i = 0; i < unit.length; i++) hash = (Math.imul(hash, 31) + unit.charCodeAt(i)) | 0;
  }
  return PALETTE[(hash >>> 0) % PALETTE.length];
  /* eslint-enable no-bitwise */
}

/**
 * One re-read at a time. Registry signals can arrive in bursts; a signal
 * during a read coalesces into one follow-up rather than racing list updates.
 */
export function serialRefresh(run: (withRoom: boolean) => Promise<void>): (withRoom: boolean) => void {
  let running = false;
  let again = false;
  let againWithRoom = false;

  return withRoom => {
    if (running) {
      again = true;
      againWithRoom ||= withRoom;
      return;
    }
    running = true;
    void (async () => {
      let next = withRoom;
      try {
        do {
          again = false;
          await run(next).catch(() => {});
          next = againWithRoom;
          againWithRoom = false;
        } while (again);
      } finally {
        running = false;
      }
    })();
  };
}

/** Local title/repository/status/model search; older servers omit repoNames. */
export function matchesSession(session: SessionSummary, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  const status = session.status === SessionStatus.Running ? 'running' : 'idle';
  return [session.title, session.model, status, ...(session.repoNames ?? []), session.clientWorkspace?.machineName ?? '', session.clientWorkspace?.directory ?? '']
    .some(value => value.toLowerCase().includes(term));
}
