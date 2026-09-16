/**
 * A terminal, small enough to live on a phone.
 *
 * The other end of this is a real PTY in the session's sandbox, so what arrives
 * is not text — it is a byte stream with cursor moves, colours, erases and
 * scroll regions in it. Printing it into a `<Text>` gives you `ESC[2K` on
 * screen and a progress bar that redraws down the page instead of in place.
 * Something has to keep a grid and apply those bytes to it.
 *
 * The cockpit does this with slopterm, which is C# compiled to WebAssembly and
 * paints on a canvas; neither half of that travels to React Native. What is
 * here is the same idea at the size the job actually needs: enough of the VT
 * repertoire for a shell, `git`, a build log and a full-screen editor, and no
 * more. In particular there is no reflow on resize (xterm.js skips it too), no
 * mouse reporting, and no double-width glyph handling beyond counting a
 * codepoint as one cell.
 *
 * Two details that are easy to get wrong and very visible when you do:
 *
 * - **Wrapping is deferred.** Writing the 80th column of an 80-column line does
 *   not move to the next line; it sets a pending flag, and the *next* printable
 *   character wraps. Wrapping eagerly puts a blank line after every full-width
 *   line, which is most of a build log.
 * - **UTF-8 arrives split.** A frame boundary falls wherever it likes, so the
 *   decoder holds partial sequences across {@link Terminal.write} calls rather
 *   than emitting a replacement character for each half.
 */

// Colours are packed into a single number and escape parameters are read out of
// bit fields; the whole file is bit manipulation on purpose.
/* eslint-disable no-bitwise */

/** A colour: null = the theme's default, 0-255 = palette, or a packed RGB. */
export type Color = number | null;

/** How {@link Color} carries a 24-bit colour, above the 256-entry palette. */
export const RGB_FLAG = 0x1000000;

export function packRgb(r: number, g: number, b: number): number {
  return RGB_FLAG | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

export interface Style {
  fg: Color;
  bg: Color;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  /** Concealed text (`ESC[8m`) — rendered as spaces, still selectable as such. */
  hidden: boolean;
}

export const DEFAULT_STYLE: Style = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  hidden: false,
};

export interface Cell {
  ch: string;
  style: Style;
}

/** A run of cells sharing one style — what a renderer actually wants. */
export interface Span {
  text: string;
  style: Style;
}

const SPACE: Cell = { ch: ' ', style: DEFAULT_STYLE };

function blankRow(cols: number): Cell[] {
  return new Array(cols).fill(SPACE);
}

function sameStyle(a: Style, b: Style): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse &&
    a.hidden === b.hidden
  );
}

/** One line as runs of equal style, with trailing default-styled blanks dropped. */
export function spansOf(row: Cell[]): Span[] {
  let end = row.length;
  while (end > 0 && row[end - 1].ch === ' ' && sameStyle(row[end - 1].style, DEFAULT_STYLE)) end--;

  const spans: Span[] = [];
  for (let i = 0; i < end; i++) {
    const cell = row[i];
    const last = spans[spans.length - 1];
    if (last && sameStyle(last.style, cell.style)) last.text += cell.ch;
    else spans.push({ text: cell.ch, style: cell.style });
  }
  return spans;
}

/** Parser states. OSC and DCS-alikes are consumed, not interpreted. */
const enum State {
  Ground,
  Escape,
  Csi,
  Osc,
  /** `ESC (`, `ESC )` and friends: one more byte, then back to ground. */
  Charset,
  /** `ESC P`/`ESC X`/`ESC ^`/`ESC _`: a string terminated the same way OSC is. */
  String,
}

/** How many scrolled-off lines to keep, so the sheet can be pulled back through. */
const SCROLLBACK_LIMIT = 1000;

export class Terminal {
  cols: number;
  rows: number;

  /** The visible grid, top row first. */
  private grid: Cell[][];

  /** Lines that have scrolled off the top, oldest first, bounded. */
  private history: Cell[][] = [];

  /** The alternate screen's grid while it is showing, else null. */
  private alternate: Cell[][] | null = null;
  private savedMain: { grid: Cell[][]; x: number; y: number } | null = null;

  cursorX = 0;
  cursorY = 0;
  cursorVisible = true;

  private style: Style = DEFAULT_STYLE;
  private saved: { x: number; y: number; style: Style } | null = null;

  /** The scrolling region, inclusive, in grid coordinates. */
  private top = 0;
  private bottom: number;

  private wrapPending = false;
  private autoWrap = true;

  private state: State = State.Ground;
  private params: number[] = [];
  private paramText = '';
  private prefix = '';
  private oscText = '';

  /** Bytes of an incomplete UTF-8 sequence, carried to the next write. */
  private partial: number[] = [];

  /** The window title the shell last set, for the sheet's header. */
  title = '';

  /** Bumped on every change, so a renderer can memoize on one number. */
  version = 0;

  constructor(cols = 80, rows = 24) {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.bottom = this.rows - 1;
    this.grid = Array.from({ length: this.rows }, () => blankRow(this.cols));
  }

  /** The visible grid plus as much scrollback as is held, oldest line first. */
  get lines(): Cell[][] {
    return this.alternate ? this.grid : [...this.history, ...this.grid];
  }

  /** Where the visible grid starts within {@link lines}. */
  get viewportStart(): number {
    return this.alternate ? 0 : this.history.length;
  }

  reset(): void {
    this.grid = Array.from({ length: this.rows }, () => blankRow(this.cols));
    this.history = [];
    this.alternate = null;
    this.savedMain = null;
    this.cursorX = 0;
    this.cursorY = 0;
    this.cursorVisible = true;
    this.style = DEFAULT_STYLE;
    this.saved = null;
    this.top = 0;
    this.bottom = this.rows - 1;
    this.wrapPending = false;
    this.autoWrap = true;
    this.state = State.Ground;
    this.partial = [];
    this.title = '';
    this.version++;
  }

  /**
   * Change the grid's size. Rows are clipped or padded and the cursor is
   * clamped; nothing is reflowed, so a line longer than the new width stays
   * cut. Reflow is the one piece of a terminal that is genuinely hard, and a
   * sheet that is resized about twice per session does not earn it.
   */
  resize(cols: number, rows: number): void {
    cols = Math.max(1, cols);
    rows = Math.max(1, rows);
    if (cols === this.cols && rows === this.rows) return;

    const fit = (grid: Cell[][]): Cell[][] => {
      const next = grid.slice(-rows).map(row =>
        row.length === cols
          ? row
          : row.length > cols
          ? row.slice(0, cols)
          : [...row, ...new Array(cols - row.length).fill(SPACE)],
      );
      while (next.length < rows) next.push(blankRow(cols));
      return next;
    };

    // Rows lost off the top of the main screen join the scrollback rather than
    // vanishing — shrinking the sheet should not eat what was just printed.
    if (!this.alternate && this.rows > rows) {
      this.history.push(...this.grid.slice(0, this.rows - rows));
      this.trimHistory();
    }

    this.grid = fit(this.grid);
    if (this.alternate) this.alternate = fit(this.alternate);
    if (this.savedMain) this.savedMain.grid = fit(this.savedMain.grid);

    this.cols = cols;
    this.rows = rows;
    this.top = 0;
    this.bottom = rows - 1;
    this.cursorX = Math.min(this.cursorX, cols - 1);
    this.cursorY = Math.min(this.cursorY, rows - 1);
    this.wrapPending = false;
    this.version++;
  }

  // ---- the byte stream ------------------------------------------------------

  write(bytes: Uint8Array): void {
    const text = this.decode(bytes);
    for (const ch of text) this.consume(ch);
    this.version++;
  }

  /**
   * UTF-8, holding back the tail of a sequence that a frame boundary split.
   * `TextDecoder` with `{stream: true}` would do this, but Hermes does not
   * reliably have one, and this is twenty lines.
   */
  private decode(bytes: Uint8Array): string {
    const buffer = this.partial.length > 0 ? [...this.partial, ...bytes] : Array.from(bytes);
    this.partial = [];

    let out = '';
    let i = 0;
    while (i < buffer.length) {
      const b = buffer[i];
      let length = 1;
      if (b >= 0xf0) length = 4;
      else if (b >= 0xe0) length = 3;
      else if (b >= 0xc0) length = 2;

      if (i + length > buffer.length) {
        // The rest is the start of a sequence whose tail is in the next frame.
        this.partial = buffer.slice(i);
        break;
      }

      if (length === 1) {
        out += String.fromCharCode(b);
      } else {
        let code = b & (0xff >> (length + 1));
        let valid = true;
        for (let k = 1; k < length; k++) {
          const cont = buffer[i + k];
          if ((cont & 0xc0) !== 0x80) {
            valid = false;
            break;
          }
          code = (code << 6) | (cont & 0x3f);
        }
        // '?' rather than U+FFFD: the bundled mono face has no replacement
        // character, and React Native has no fallback stack — a glyph the font
        // lacks draws as nothing at all (see the glyph-coverage test).
        out += valid ? String.fromCodePoint(code) : '?';
      }
      i += length;
    }
    return out;
  }

  private consume(ch: string): void {
    switch (this.state) {
      case State.Ground:
        return this.ground(ch);
      case State.Escape:
        return this.escape(ch);
      case State.Csi:
        return this.csi(ch);
      case State.Osc:
      case State.String:
        return this.stringPayload(ch);
      case State.Charset:
        this.state = State.Ground;
        return;
    }
  }

  private ground(ch: string): void {
    switch (ch) {
      case '\x1b':
        this.state = State.Escape;
        this.params = [];
        this.paramText = '';
        this.prefix = '';
        return;
      case '\r':
        this.cursorX = 0;
        this.wrapPending = false;
        return;
      case '\n':
      case '\v':
      case '\f':
        this.lineFeed();
        return;
      case '\b':
        if (this.wrapPending) this.wrapPending = false;
        else this.cursorX = Math.max(0, this.cursorX - 1);
        return;
      case '\t': {
        const next = Math.min(this.cols - 1, (Math.floor(this.cursorX / 8) + 1) * 8);
        this.cursorX = next;
        this.wrapPending = false;
        return;
      }
      case '\x07': // bell — a phone in a pocket does not need it
      case '\x0e':
      case '\x0f':
        return;
      default:
        if (ch < ' ' && ch !== '\x00') return;
        this.print(ch);
    }
  }

  private print(ch: string): void {
    if (this.wrapPending) {
      this.cursorX = 0;
      this.lineFeed();
      this.wrapPending = false;
    }

    const row = this.grid[this.cursorY];
    if (row) row[this.cursorX] = { ch, style: this.style };

    if (this.cursorX + 1 >= this.cols) {
      // Deferred: the line is full, but nothing wraps until the next glyph.
      if (this.autoWrap) this.wrapPending = true;
    } else {
      this.cursorX++;
    }
  }

  private escape(ch: string): void {
    switch (ch) {
      case '[':
        this.state = State.Csi;
        return;
      case ']':
        this.state = State.Osc;
        this.oscText = '';
        return;
      case 'P': // DCS
      case 'X': // SOS
      case '^': // PM
      case '_': // APC
        this.state = State.String;
        this.oscText = '';
        return;
      case '(':
      case ')':
      case '*':
      case '+':
      case '#':
      case '%':
        this.state = State.Charset;
        return;
      case '7':
        this.saved = { x: this.cursorX, y: this.cursorY, style: this.style };
        this.state = State.Ground;
        return;
      case '8':
        this.restoreCursor();
        this.state = State.Ground;
        return;
      case 'M':
        this.reverseIndex();
        this.state = State.Ground;
        return;
      case 'D':
        this.lineFeed();
        this.state = State.Ground;
        return;
      case 'E':
        this.cursorX = 0;
        this.lineFeed();
        this.state = State.Ground;
        return;
      case 'c':
        this.reset();
        return;
      default:
        this.state = State.Ground;
    }
  }

  /** OSC and the other string escapes: swallow to BEL or ST, keep the title. */
  private stringPayload(ch: string): void {
    if (ch === '\x07' || ch === '\x9c') {
      this.endString();
      return;
    }
    // ST is ESC \ — the ESC lands here, and the backslash right after it.
    if (ch === '\x1b') {
      this.oscText += ch;
      return;
    }
    if (ch === '\\' && this.oscText.endsWith('\x1b')) {
      this.oscText = this.oscText.slice(0, -1);
      this.endString();
      return;
    }
    if (this.oscText.length < 2048) this.oscText += ch;
  }

  private endString(): void {
    if (this.state === State.Osc) {
      const match = /^(\d+);([\s\S]*)$/.exec(this.oscText);
      // 0 = icon + title, 1 = icon, 2 = title. Only the title is shown.
      if (match && (match[1] === '0' || match[1] === '2')) this.title = match[2];
    }
    this.oscText = '';
    this.state = State.Ground;
  }

  private csi(ch: string): void {
    const code = ch.charCodeAt(0);
    if (code >= 0x30 && code <= 0x3f) {
      // Parameter bytes, including the ?/</=/> private prefixes.
      if (this.paramText.length === 0 && (ch === '?' || ch === '<' || ch === '=' || ch === '>')) {
        this.prefix = ch;
      } else {
        this.paramText += ch;
      }
      return;
    }
    if (code >= 0x20 && code <= 0x2f) return; // intermediates: ignored

    this.params = this.paramText
      .split(';')
      .map(p => (p === '' ? 0 : parseInt(p, 10) || 0));
    this.dispatch(ch);
    this.state = State.Ground;
    this.params = [];
    this.paramText = '';
    this.prefix = '';
  }

  private param(index: number, fallback: number): number {
    const value = this.params[index];
    return value === undefined || value === 0 ? fallback : value;
  }

  private dispatch(final: string): void {
    switch (final) {
      case 'A':
        this.cursorY = Math.max(this.top, this.cursorY - this.param(0, 1));
        this.wrapPending = false;
        return;
      case 'B':
        this.cursorY = Math.min(this.bottom, this.cursorY + this.param(0, 1));
        this.wrapPending = false;
        return;
      case 'C':
        this.cursorX = Math.min(this.cols - 1, this.cursorX + this.param(0, 1));
        this.wrapPending = false;
        return;
      case 'D':
        this.cursorX = Math.max(0, this.cursorX - this.param(0, 1));
        this.wrapPending = false;
        return;
      case 'E':
        this.cursorX = 0;
        this.cursorY = Math.min(this.bottom, this.cursorY + this.param(0, 1));
        return;
      case 'F':
        this.cursorX = 0;
        this.cursorY = Math.max(this.top, this.cursorY - this.param(0, 1));
        return;
      case 'G':
      case '`':
        this.cursorX = Math.min(this.cols - 1, this.param(0, 1) - 1);
        this.wrapPending = false;
        return;
      case 'd':
        this.cursorY = Math.min(this.rows - 1, this.param(0, 1) - 1);
        this.wrapPending = false;
        return;
      case 'H':
      case 'f':
        this.cursorY = Math.min(this.rows - 1, this.param(0, 1) - 1);
        this.cursorX = Math.min(this.cols - 1, this.param(1, 1) - 1);
        this.wrapPending = false;
        return;
      case 'J':
        return this.eraseDisplay(this.params[0] ?? 0);
      case 'K':
        return this.eraseLine(this.params[0] ?? 0);
      case 'L':
        return this.insertLines(this.param(0, 1));
      case 'M':
        return this.deleteLines(this.param(0, 1));
      case 'P':
        return this.deleteChars(this.param(0, 1));
      case '@':
        return this.insertChars(this.param(0, 1));
      case 'X':
        return this.eraseChars(this.param(0, 1));
      case 'S':
        return this.scrollUp(this.param(0, 1));
      case 'T':
        return this.scrollDown(this.param(0, 1));
      case 'm':
        return this.sgr();
      case 'r': {
        const top = Math.max(0, this.param(0, 1) - 1);
        const bottom = Math.min(this.rows - 1, this.param(1, this.rows) - 1);
        if (top < bottom) {
          this.top = top;
          this.bottom = bottom;
          this.cursorX = 0;
          this.cursorY = top;
        }
        return;
      }
      case 'h':
        return this.setMode(true);
      case 'l':
        return this.setMode(false);
      case 's':
        this.saved = { x: this.cursorX, y: this.cursorY, style: this.style };
        return;
      case 'u':
        return this.restoreCursor();
      default:
        return; // device reports and the rest: nothing to answer with
    }
  }

  private setMode(on: boolean): void {
    if (this.prefix !== '?') return;
    for (const mode of this.params) {
      switch (mode) {
        case 7:
          this.autoWrap = on;
          break;
        case 25:
          this.cursorVisible = on;
          break;
        case 47:
        case 1047:
        case 1049:
          this.setAlternate(on, mode === 1049);
          break;
        default:
          break; // bracketed paste, mouse reporting: accepted and ignored
      }
    }
  }

  /**
   * The alternate screen: a full-screen program (an editor, `less`, `htop`)
   * gets its own grid and the main one comes back untouched underneath. Without
   * this, quitting vim leaves the editor's last frame in the scrollback.
   */
  private setAlternate(on: boolean, withCursor: boolean): void {
    if (on) {
      if (this.alternate) return;
      this.savedMain = { grid: this.grid, x: this.cursorX, y: this.cursorY };
      this.alternate = Array.from({ length: this.rows }, () => blankRow(this.cols));
      this.grid = this.alternate;
      if (withCursor) {
        this.cursorX = 0;
        this.cursorY = 0;
      }
      return;
    }

    if (!this.alternate || !this.savedMain) return;
    this.grid = this.savedMain.grid;
    if (withCursor) {
      this.cursorX = this.savedMain.x;
      this.cursorY = this.savedMain.y;
    }
    this.alternate = null;
    this.savedMain = null;
  }

  private restoreCursor(): void {
    if (!this.saved) return;
    this.cursorX = Math.min(this.cols - 1, this.saved.x);
    this.cursorY = Math.min(this.rows - 1, this.saved.y);
    this.style = this.saved.style;
    this.wrapPending = false;
  }

  // ---- the grid -------------------------------------------------------------

  private lineFeed(): void {
    if (this.cursorY === this.bottom) this.scrollUp(1);
    else if (this.cursorY < this.rows - 1) this.cursorY++;
    this.wrapPending = false;
  }

  private reverseIndex(): void {
    if (this.cursorY === this.top) this.scrollDown(1);
    else if (this.cursorY > 0) this.cursorY--;
  }

  private scrollUp(count: number): void {
    for (let i = 0; i < count; i++) {
      const gone = this.grid.splice(this.top, 1)[0];
      // Only the main screen keeps history, and only when the region is the
      // whole screen: a line scrolled out of a `less` pane is not scrollback.
      if (!this.alternate && this.top === 0 && this.bottom === this.rows - 1 && gone) {
        this.history.push(gone);
      }
      this.grid.splice(this.bottom, 0, blankRow(this.cols));
    }
    this.trimHistory();
  }

  private scrollDown(count: number): void {
    for (let i = 0; i < count; i++) {
      this.grid.splice(this.bottom, 1);
      this.grid.splice(this.top, 0, blankRow(this.cols));
    }
  }

  private trimHistory(): void {
    if (this.history.length > SCROLLBACK_LIMIT) {
      this.history.splice(0, this.history.length - SCROLLBACK_LIMIT);
    }
  }

  private eraseDisplay(mode: number): void {
    if (mode === 2 || mode === 3) {
      for (let y = 0; y < this.rows; y++) this.grid[y] = blankRow(this.cols);
      return;
    }
    if (mode === 1) {
      for (let y = 0; y < this.cursorY; y++) this.grid[y] = blankRow(this.cols);
      this.eraseLine(1);
      return;
    }
    this.eraseLine(0);
    for (let y = this.cursorY + 1; y < this.rows; y++) this.grid[y] = blankRow(this.cols);
  }

  private eraseLine(mode: number): void {
    const row = this.grid[this.cursorY];
    if (!row) return;
    const from = mode === 0 ? this.cursorX : 0;
    const to = mode === 1 ? this.cursorX : this.cols - 1;
    for (let x = from; x <= to && x < this.cols; x++) row[x] = SPACE;
  }

  private eraseChars(count: number): void {
    const row = this.grid[this.cursorY];
    if (!row) return;
    for (let x = this.cursorX; x < Math.min(this.cols, this.cursorX + count); x++) row[x] = SPACE;
  }

  private deleteChars(count: number): void {
    const row = this.grid[this.cursorY];
    if (!row) return;
    row.splice(this.cursorX, count);
    while (row.length < this.cols) row.push(SPACE);
  }

  private insertChars(count: number): void {
    const row = this.grid[this.cursorY];
    if (!row) return;
    for (let i = 0; i < count; i++) row.splice(this.cursorX, 0, SPACE);
    row.length = this.cols;
  }

  private insertLines(count: number): void {
    if (this.cursorY < this.top || this.cursorY > this.bottom) return;
    for (let i = 0; i < count; i++) {
      this.grid.splice(this.bottom, 1);
      this.grid.splice(this.cursorY, 0, blankRow(this.cols));
    }
  }

  private deleteLines(count: number): void {
    if (this.cursorY < this.top || this.cursorY > this.bottom) return;
    for (let i = 0; i < count; i++) {
      this.grid.splice(this.cursorY, 1);
      this.grid.splice(this.bottom, 0, blankRow(this.cols));
    }
  }

  // ---- colours and attributes -----------------------------------------------

  private sgr(): void {
    const params = this.params.length === 0 ? [0] : this.params;
    let style = { ...this.style };

    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (p === 0) style = { ...DEFAULT_STYLE };
      else if (p === 1) style.bold = true;
      else if (p === 2) style.dim = true;
      else if (p === 3) style.italic = true;
      else if (p === 4) style.underline = true;
      else if (p === 7) style.inverse = true;
      else if (p === 8) style.hidden = true;
      else if (p === 22) {
        style.bold = false;
        style.dim = false;
      } else if (p === 23) style.italic = false;
      else if (p === 24) style.underline = false;
      else if (p === 27) style.inverse = false;
      else if (p === 28) style.hidden = false;
      else if (p >= 30 && p <= 37) style.fg = p - 30;
      else if (p === 39) style.fg = null;
      else if (p >= 40 && p <= 47) style.bg = p - 40;
      else if (p === 49) style.bg = null;
      else if (p >= 90 && p <= 97) style.fg = p - 90 + 8;
      else if (p >= 100 && p <= 107) style.bg = p - 100 + 8;
      else if (p === 38 || p === 48) {
        const extended = this.extendedColor(params, i);
        if (p === 38) style.fg = extended.color;
        else style.bg = extended.color;
        i = extended.next;
      }
    }

    this.style = style;
  }

  /** `38;5;n` (palette) and `38;2;r;g;b` (direct), returning the index consumed. */
  private extendedColor(params: number[], i: number): { color: Color; next: number } {
    const kind = params[i + 1];
    if (kind === 5) return { color: params[i + 2] ?? 0, next: i + 2 };
    if (kind === 2) {
      return {
        color: packRgb(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0),
        next: i + 4,
      };
    }
    return { color: null, next: i + 1 };
  }
}
