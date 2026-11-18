/**
 * What the chat-room pages decide, ported from `Pages/Rooms.razor`'s `@code`
 * block so the phone and the browser agree — on which shade a handle is, on
 * how a fresh page folds into what is already shown, on what "unread" means.
 *
 * Rooms are shared channels for the owner and their agent sessions. Human
 * posts carry their own provenance; only agents explicitly @mentioned wake.
 */
import type { ChatRoomEntry, ChatRoomPresence, ChatRoomView } from './contracts';

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

/** What a room screen holds: the latest view, and every message loaded so far. */
export interface RoomPage {
  view: ChatRoomView;
  messages: ChatRoomEntry[];
}

function bySeq(a: ChatRoomEntry, b: ChatRoomEntry) {
  return a.seq - b.seq;
}

/**
 * Fold a fresh read into what is shown. New messages append; earlier pages the
 * reader already paged back to stay put rather than being replaced by the
 * newest window. `hasEarlier` is about the window the server sent, so once the
 * reader has gone further back than that, the oldest page they loaded decides.
 */
export function mergeRoom(current: RoomPage | null, view: ChatRoomView): RoomPage {
  const shown = current?.messages ?? [];
  const known = new Set(shown.map(m => m.seq));
  const messages = [...shown, ...view.messages.filter(m => !known.has(m.seq))].sort(bySeq);
  const lowestShown = shown.length > 0 ? shown[0].seq : Number.MAX_SAFE_INTEGER;
  const firstSent = view.messages.length > 0 ? view.messages[0].seq : Number.MAX_SAFE_INTEGER;
  const hasEarlier = current && lowestShown < firstSent ? current.view.hasEarlier : view.hasEarlier;
  return { view: { ...view, hasEarlier }, messages };
}

/** Prepend an earlier page; the page's own `hasEarlier` now speaks for the top. */
export function prependEarlier(current: RoomPage, page: ChatRoomView): RoomPage {
  const known = new Set(current.messages.map(m => m.seq));
  const messages = [...page.messages.filter(m => !known.has(m.seq)), ...current.messages].sort(bySeq);
  return { view: { ...current.view, hasEarlier: page.hasEarlier }, messages };
}

/** How far behind the room's newest loaded message a member has read. */
export function unread(member: ChatRoomPresence, messages: readonly ChatRoomEntry[]): number {
  if (messages.length === 0) return 0;
  return Math.max(0, messages[messages.length - 1].seq - member.lastReadSeq);
}

/** "sub-session · running · 3 unread" — a member's line under its handle. */
export function memberLine(member: ChatRoomPresence, messages: readonly ChatRoomEntry[]): string {
  const behind = unread(member, messages);
  return [member.isSubSession ? 'sub-session' : null, member.state, behind > 0 ? `${behind} unread` : null]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The display name a channel message shows for its sender: the session title
 * the server recorded with the post, else the title from the room's members,
 * else the raw handle. Senders are not always members — the owner isn't, and
 * an agent that posted and later left isn't — so every step can miss.
 */
export function senderDisplayName(
  message: Pick<ChatRoomEntry, 'sender' | 'senderSessionId' | 'senderSessionTitle'>,
  members: readonly ChatRoomPresence[],
): string {
  if (message.senderSessionTitle) return message.senderSessionTitle;
  const member = members.find(m => m.sessionId === message.senderSessionId);
  return member?.sessionTitle ?? message.sender;
}

export function plural(n: number, noun: string): string {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}

/** Whether a `RoomChanged` signal touches the room on screen; "" touches every room. */
export function touches(signal: string, room: string | null): boolean {
  return signal.length === 0 || (room !== null && signal.toLowerCase() === room.toLowerCase());
}

/**
 * One re-read at a time. A turn produces signals in bursts — the post, the
 * member going running, then idle — and each would otherwise start its own
 * requests; a signal during a re-read asks for exactly one more, carrying
 * whether any of the signals it stands for touched the open room.
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
