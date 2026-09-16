/**
 * A live terminal for one session: the socket, the grid, and the repainting.
 *
 * The screen state lives in a {@link Terminal} instance held in a ref, not in
 * React state. A PTY emits bytes far faster than a phone can reconcile — a
 * `yarn install` is thousands of writes a second — so the bytes go straight
 * into the grid and React is told, at most once a frame, that *something*
 * changed. Rendering then reads the grid as it stands. Putting the grid in
 * state instead means one render per chunk, which is how a build log locks up a
 * UI thread.
 *
 * The connection is opened when the sheet appears and closed when it goes away.
 * That is cheap on purpose: the shell belongs to the server
 * (`TerminalSessionManager`), so closing the socket detaches rather than kills,
 * and re-opening replays the scrollback the server kept.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KEYS,
  TerminalConnection,
  encodeInput,
  type TerminalControl,
} from '../api/terminal';
import { Terminal, spansOf, type Span } from '../term/emulator';

/**
 * How much scrolled-off output the sheet renders behind the live screen.
 *
 * Every line here is a `<Text>` in a ScrollView, so this is a budget, not a
 * limit on what the emulator keeps (it holds far more). Two hundred is roughly
 * eight screenfuls on a phone — enough to find the command that failed, few
 * enough that presenting the sheet is instant.
 */
const VISIBLE_SCROLLBACK = 200;

/** How often the screen is handed to React, at most. */
const REPAINT_MS = 60;

export type TerminalStatus =
  | { kind: 'connecting' }
  | { kind: 'live' }
  | { kind: 'exited' }
  | { kind: 'error'; message: string }
  | { kind: 'closed' };

export interface LiveTerminal {
  status: TerminalStatus;
  /** Bumped whenever the grid changed; the renderer memoizes on it. */
  version: number;
  /** What to draw, newest last: scrollback tail plus the live screen. */
  rows: Span[][];
  /** Where the cursor is within {@link rows}, or null when it is hidden. */
  cursor: { x: number; y: number } | null;
  /** The title the shell set, for the header.  */
  title: string;
  /** Send typed text, or one of {@link KEYS}. */
  send: (text: string) => void;
}

/**
 * @param size The measured grid, or null until it has been measured. Nothing
 * connects before it is known: the PTY is told its width once, at attach, and
 * the server replays the scrollback immediately — so attaching at a guessed
 * 80×24 and correcting afterwards means every replayed line was already broken
 * at the wrong column, and this emulator does not reflow.
 */
export function useTerminal(
  baseUrl: string | null,
  apiKey: string | null,
  sessionId: string,
  visible: boolean,
  size: { cols: number; rows: number } | null,
): LiveTerminal {
  const terminal = useRef(new Terminal(80, 24));
  const connection = useRef<TerminalConnection | null>(null);
  const measured = useRef({ cols: 80, rows: 24 });

  const [status, setStatus] = useState<TerminalStatus>({ kind: 'connecting' });
  const [version, setVersion] = useState(0);

  // One repaint per {@link REPAINT_MS}, however many chunks arrived in between.
  // Not per animation frame: a 120Hz phone would then flatten the whole grid a
  // hundred and twenty times a second during a build, for output nobody can
  // read at that rate anyway. Sixteen a second looks live and costs a quarter
  // as much.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repaint = useCallback(() => {
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setVersion(v => v + 1);
    }, REPAINT_MS);
  }, []);

  // Declared before the connect effect on purpose: on the commit where the
  // size first arrives, this has already applied it by the time the socket
  // opens with `measured.current`.
  useEffect(() => {
    if (!size) return;
    if (size.cols === measured.current.cols && size.rows === measured.current.rows) return;
    measured.current = size;
    terminal.current.resize(size.cols, size.rows);
    connection.current?.resize(size.cols, size.rows);
    setVersion(v => v + 1);
  }, [size]);

  const ready = size !== null;

  useEffect(() => {
    if (!visible || !ready || !baseUrl || !apiKey) return;

    // A re-attach replays the server's scrollback from the top, so start from a
    // clean grid rather than layering it over whatever was last on screen.
    terminal.current.reset();
    setStatus({ kind: 'connecting' });
    setVersion(v => v + 1);

    const live = new TerminalConnection({
      baseUrl,
      apiKey,
      sessionId,
      cols: measured.current.cols,
      rows: measured.current.rows,
      onOpen: () => setStatus({ kind: 'live' }),
      onData: bytes => {
        terminal.current.write(bytes);
        repaint();
      },
      onControl: (control: TerminalControl) => {
        if (control.kind === 'exit') setStatus({ kind: 'exited' });
        else setStatus({ kind: 'error', message: control.message });
      },
      onClose: () =>
        // An exit or a named error already said something better than "closed".
        setStatus(current =>
          current.kind === 'exited' || current.kind === 'error' ? current : { kind: 'closed' },
        ),
    });
    connection.current = live;

    return () => {
      live.close();
      connection.current = null;
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    // Not `size`: a resize is sent down the open socket, never a reconnect.
  }, [visible, ready, baseUrl, apiKey, sessionId, repaint]);

  const send = useCallback((text: string) => {
    connection.current?.send(encodeInput(text));
  }, []);

  // Flattening the grid into spans walks every cell, so it happens once per
  // repaint rather than once per render: a parent re-rendering for its own
  // reasons must not cost a full sweep of the screen.
  const painted = useMemo(() => {
    const term = terminal.current;
    const all = term.lines;
    const from = Math.max(0, term.viewportStart - VISIBLE_SCROLLBACK);
    return {
      rows: all.slice(from).map(spansOf),
      cursor: { x: term.cursorX, y: term.viewportStart - from + term.cursorY },
      visible: term.cursorVisible,
      title: term.title,
    };
    // `version` is the dependency: the grid is mutated in place, so nothing
    // else about it changes identity when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return {
    status,
    version,
    rows: painted.rows,
    cursor: painted.visible && status.kind === 'live' ? painted.cursor : null,
    title: painted.title,
    send,
  };
}

export { KEYS };
