/**
 * The session terminal's transport, ported from
 * `SlopCoder.Web.Client/Code/WebSocketTerminalConnection.cs`.
 *
 * `/ws/session/{id}/terminal` is not a seam endpoint and does not speak JSON:
 * binary frames are raw PTY bytes in both directions, and text frames are the
 * small control protocol in `TerminalControl.cs` — `{"t":"resize",…}` going up,
 * `{"t":"exit"}` and `{"t":"error","msg":…}` coming down.
 *
 * Three things about it are worth stating:
 *
 * - **The shell is the server's, not the socket's.** `TerminalSessionManager`
 *   holds it, so closing this connection leaves the shell running and
 *   re-opening replays the scrollback. Dismissing the sheet costs nothing, and
 *   a phone that sleeps has not killed anything.
 * - **The credential is a header, not a query parameter.** The API key scheme
 *   accepts `?access_token=` only under `/hubs`, deliberately — a key in a URL
 *   is a key in a log. React Native's WebSocket takes request headers, which
 *   the browser's does not, so this is the one place the phone has an easier
 *   job than the cockpit.
 * - **`binaryType` must be set before anything arrives.** Left at its default,
 *   frames surface as Blobs, and reading one is asynchronous — so output would
 *   arrive out of order under load, which is exactly when it matters.
 */

/** What the server says down the text channel. */
export type TerminalControl =
  | { kind: 'exit' }
  | { kind: 'error'; message: string };

export interface TerminalConnectionOptions {
  baseUrl: string;
  apiKey: string;
  sessionId: string;
  cols: number;
  rows: number;
  onData: (bytes: Uint8Array) => void;
  onControl: (control: TerminalControl) => void;
  /** Open/closed, for a header that would otherwise have nothing to say. */
  onOpen?: () => void;
  onClose?: () => void;
}

/** `https://host` → `wss://host`, leaving anything else alone. */
export function websocketUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const scheme = base.startsWith('https://')
    ? `wss://${base.slice('https://'.length)}`
    : base.startsWith('http://')
    ? `ws://${base.slice('http://'.length)}`
    : base;
  return `${scheme}/${path.replace(/^\/+/, '')}`;
}

/** Parse one text frame. Anything unrecognised is dropped rather than thrown. */
export function parseControl(payload: string): TerminalControl | null {
  try {
    const message = JSON.parse(payload) as { t?: string; msg?: string };
    if (message.t === 'exit') return { kind: 'exit' };
    if (message.t === 'error') {
      return { kind: 'error', message: message.msg ?? 'The terminal could not be started.' };
    }
  } catch {
    // A frame that is not JSON is not a control message; there is nothing to do
    // with it and nothing worth telling the user.
  }
  return null;
}

export class TerminalConnection {
  private socket: WebSocket | null = null;
  private closed = false;

  constructor(private readonly options: TerminalConnectionOptions) {
    const { baseUrl, apiKey, sessionId, cols, rows } = options;
    const url = websocketUrl(baseUrl, `ws/session/${sessionId}/terminal?cols=${cols}&rows=${rows}`);

    // The third argument is React Native's own extension to the WebSocket
    // constructor; on web it would be ignored, which is why the cockpit has to
    // authenticate with a cookie instead.
    const socket = new WebSocket(url, undefined, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => options.onOpen?.();

    socket.onmessage = event => {
      const data = (event as { data: unknown }).data;
      if (typeof data === 'string') {
        const control = parseControl(data);
        if (control) options.onControl(control);
        return;
      }
      if (data instanceof ArrayBuffer) options.onData(new Uint8Array(data));
    };

    socket.onerror = () => {
      // The close that follows is where the UI reacts; an error on its own
      // carries nothing readable (RN gives "Something went wrong").
    };

    socket.onclose = () => {
      this.socket = null;
      if (!this.closed) options.onClose?.();
    };
  }

  get open(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Keystrokes, already encoded. */
  send(bytes: Uint8Array): void {
    if (!this.open) return;
    // The view, not its buffer: sending `bytes.buffer` would send everything
    // the buffer holds, which for a view over a larger allocation is more than
    // was asked for.
    this.socket?.send(bytes);
  }

  resize(cols: number, rows: number): void {
    if (!this.open) return;
    this.socket?.send(JSON.stringify({ t: 'resize', cols, rows }));
  }

  /** Detach. The shell keeps running on the server; this only stops watching. */
  close(): void {
    this.closed = true;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      // Already gone.
    }
  }
}

/** UTF-8 for what the on-screen keyboard produces. */
export function encodeInput(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

/**
 * The keys a phone keyboard has no key for, as the bytes a PTY expects.
 *
 * Ctrl-C is the one that matters — it is the whole reason for typing into a
 * terminal from a phone at all — but a shell without arrows or tab is a
 * text box, so the row above the keyboard carries these.
 */
export const KEYS = {
  ctrlC: '\x03',
  ctrlD: '\x04',
  ctrlZ: '\x1a',
  ctrlL: '\x0c',
  escape: '\x1b',
  tab: '\t',
  enter: '\r',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
} as const;
