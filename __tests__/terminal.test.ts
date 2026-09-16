/**
 * The terminal emulator, which is the part of the shake-to-open sheet that can
 * actually be wrong without anyone noticing.
 *
 * A missed escape sequence does not throw; it prints `[2K` into the log, or
 * leaves a progress bar drawing down the page, or puts the cursor a column off
 * so the next command echoes over the prompt. Every case below is a shape that
 * really comes out of a shell in this app's sandbox: `git`'s colour, `npm`'s
 * carriage-return redraw, an editor taking the alternate screen, a UTF-8
 * character split across two WebSocket frames.
 */
import { Terminal, spansOf, packRgb, DEFAULT_STYLE } from '../src/term/emulator';
import { paint, TERMINAL_FOREGROUND } from '../src/term/palette';
import { encodeInput, parseControl, websocketUrl, KEYS } from '../src/api/terminal';

const bytes = (text: string) => encodeInput(text);

/** One row as plain text, trailing blanks trimmed — what the reader would see. */
function line(term: Terminal, y: number): string {
  return spansOf(term.lines[term.viewportStart + y])
    .map(span => span.text)
    .join('');
}

function screen(term: Terminal): string[] {
  return Array.from({ length: term.rows }, (_, y) => line(term, y));
}

describe('printing', () => {
  it('lays characters out and tracks the cursor', () => {
    const term = new Terminal(20, 4);
    term.write(bytes('hello'));

    expect(line(term, 0)).toBe('hello');
    expect(term.cursorX).toBe(5);
    expect(term.cursorY).toBe(0);
  });

  it('carriage return rewrites the line in place, which is how a progress bar works', () => {
    const term = new Terminal(20, 4);
    term.write(bytes('50%\r100%'));

    expect(line(term, 0)).toBe('100%');
    expect(screen(term)[1]).toBe('');
  });

  it('wraps on the character after the last column, not on the last column', () => {
    // Wrapping eagerly puts a blank line after every full-width line, which in
    // a build log is most of them.
    const term = new Terminal(5, 3);
    term.write(bytes('abcde'));

    expect(line(term, 0)).toBe('abcde');
    expect(term.cursorY).toBe(0);

    term.write(bytes('f'));
    expect(line(term, 1)).toBe('f');
    expect(term.cursorY).toBe(1);
  });

  it('backspace moves back, and erasing takes a space to do it', () => {
    const term = new Terminal(10, 2);
    term.write(bytes('abc\b \b'));

    expect(line(term, 0)).toBe('ab');
  });

  it('tab stops every eight columns', () => {
    const term = new Terminal(40, 2);
    term.write(bytes('a\tb'));

    expect(line(term, 0)).toBe('a       b');
  });
});

describe('erasing and moving', () => {
  it('ESC[2K clears the line the cursor is on', () => {
    const term = new Terminal(20, 3);
    term.write(bytes('noise\x1b[2Kdone'));

    // The cursor did not move, so "done" lands where "noise" ended.
    expect(line(term, 0)).toBe('     done');
  });

  it('ESC[K clears from the cursor to the end of the line', () => {
    const term = new Terminal(20, 3);
    term.write(bytes('abcdef\r\x1b[3C\x1b[K'));

    expect(line(term, 0)).toBe('abc');
  });

  it('ESC[2J clears the screen and ESC[H homes the cursor', () => {
    const term = new Terminal(10, 3);
    term.write(bytes('one\r\ntwo\r\nthree'));
    term.write(bytes('\x1b[2J\x1b[Hfresh'));

    expect(screen(term)).toEqual(['fresh', '', '']);
  });

  it('ESC[<row>;<col>H is one-based', () => {
    const term = new Terminal(10, 3);
    term.write(bytes('\x1b[2;3Hx'));

    expect(screen(term)).toEqual(['', '  x', '']);
  });
});

describe('scrolling', () => {
  it('keeps lines that scroll off the top, so the sheet can be pulled back', () => {
    const term = new Terminal(10, 2);
    term.write(bytes('one\r\ntwo\r\nthree'));

    expect(screen(term)).toEqual(['two', 'three']);
    expect(term.lines.map(row => spansOf(row).map(s => s.text).join(''))).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('honours a scroll region, and does not call its lines scrollback', () => {
    const term = new Terminal(10, 4);
    term.write(bytes('a\r\nb\r\nc\r\nd'));
    // Rows 1-3 scroll; row 0 is a header the program is keeping.
    term.write(bytes('\x1b[2;4r\x1b[4;1He\r\nf'));

    expect(screen(term)[0]).toBe('a');
    expect(screen(term)[3]).toBe('f');
    // 'a' is still on screen, so nothing new joined the history.
    expect(term.viewportStart).toBe(0);
  });

  it('inserts and deletes lines', () => {
    const term = new Terminal(10, 4);
    term.write(bytes('a\r\nb\r\nc'));
    term.write(bytes('\x1b[2;1H\x1b[L'));

    expect(screen(term)).toEqual(['a', '', 'b', 'c']);

    term.write(bytes('\x1b[2;1H\x1b[M'));
    expect(screen(term)).toEqual(['a', 'b', 'c', '']);
  });
});

describe('the alternate screen', () => {
  it('gives a full-screen program its own grid and hands the old one back', () => {
    const term = new Terminal(10, 3);
    term.write(bytes('before'));

    term.write(bytes('\x1b[?1049h\x1b[2J\x1b[Hvim'));
    expect(screen(term)[0]).toBe('vim');

    term.write(bytes('\x1b[?1049l'));
    expect(screen(term)[0]).toBe('before');
  });

  it('does not push the alternate screen into the scrollback', () => {
    const term = new Terminal(10, 2);
    term.write(bytes('\x1b[?1049h'));
    term.write(bytes('one\r\ntwo\r\nthree'));

    expect(term.viewportStart).toBe(0);
    expect(term.lines).toHaveLength(2);
  });
});

describe('colour', () => {
  it('reads the named colours and clears them again', () => {
    const term = new Terminal(20, 2);
    term.write(bytes('\x1b[31mred\x1b[0m plain'));

    const spans = spansOf(term.lines[0]);
    expect(spans[0].text).toBe('red');
    expect(spans[0].style.fg).toBe(1);
    expect(spans[1].text).toBe(' plain');
    expect(spans[1].style).toEqual(DEFAULT_STYLE);
  });

  it('reads 256-colour and 24-bit forms', () => {
    const term = new Terminal(20, 2);
    term.write(bytes('\x1b[38;5;208mo\x1b[38;2;10;20;30mt'));

    const spans = spansOf(term.lines[0]);
    expect(spans[0].style.fg).toBe(208);
    expect(spans[1].style.fg).toBe(packRgb(10, 20, 30));
  });

  it('paints bold on a named colour as its bright twin', () => {
    // Programs lean on this: a bold-red error is meant to be the light red.
    const plain = paint({ ...DEFAULT_STYLE, fg: 1 });
    const bold = paint({ ...DEFAULT_STYLE, fg: 1, bold: true });

    expect(bold.color).not.toBe(plain.color);
    expect(bold.color).toBe(paint({ ...DEFAULT_STYLE, fg: 9 }).color);
  });

  it('paints inverse by swapping ground and ink', () => {
    const painted = paint({ ...DEFAULT_STYLE, inverse: true });

    expect(painted.backgroundColor).toBe(TERMINAL_FOREGROUND);
  });
});

describe('the byte stream', () => {
  it('holds a UTF-8 character split across two frames', () => {
    const term = new Terminal(10, 2);
    const encoded = encodeInput('é');

    term.write(encoded.slice(0, 1));
    term.write(encoded.slice(1));

    expect(line(term, 0)).toBe('é');
  });

  it('takes the window title from an OSC sequence and swallows the rest', () => {
    const term = new Terminal(20, 2);
    term.write(bytes('\x1b]0;~/slopcoder\x07ready'));

    expect(term.title).toBe('~/slopcoder');
    expect(line(term, 0)).toBe('ready');
  });

  it('swallows an OSC ended with ST rather than BEL', () => {
    const term = new Terminal(20, 2);
    term.write(bytes('\x1b]2;title\x1b\\ok'));

    expect(term.title).toBe('title');
    expect(line(term, 0)).toBe('ok');
  });

  it('ignores sequences it has no answer for instead of printing them', () => {
    const term = new Terminal(20, 2);
    term.write(bytes('\x1b[6n\x1b[?2004hprompt'));

    expect(line(term, 0)).toBe('prompt');
  });
});

describe('resizing', () => {
  it('clips and pads without losing what scrolled past', () => {
    const term = new Terminal(10, 3);
    term.write(bytes('one\r\ntwo\r\nthree'));

    term.resize(10, 2);
    expect(screen(term)).toEqual(['two', 'three']);
    expect(term.lines).toHaveLength(3);

    term.resize(10, 4);
    expect(screen(term)).toEqual(['two', 'three', '', '']);
  });
});

describe('the wire', () => {
  it('turns the seam base URL into a WebSocket one', () => {
    expect(websocketUrl('https://slop.example/', 'ws/session/1/terminal')).toBe(
      'wss://slop.example/ws/session/1/terminal',
    );
    expect(websocketUrl('http://127.0.0.1:5199', '/ws/x')).toBe('ws://127.0.0.1:5199/ws/x');
  });

  it('reads the control frames the server sends and nothing else', () => {
    expect(parseControl('{"t":"exit"}')).toEqual({ kind: 'exit' });
    expect(parseControl('{"t":"error","msg":"no container"}')).toEqual({
      kind: 'error',
      message: 'no container',
    });
    expect(parseControl('not json')).toBeNull();
    expect(parseControl('{"t":"something-new"}')).toBeNull();
  });

  it('sends control characters as the single bytes a PTY expects', () => {
    expect(Array.from(encodeInput(KEYS.ctrlC))).toEqual([3]);
    expect(Array.from(encodeInput(KEYS.up))).toEqual([0x1b, 0x5b, 0x41]);
    expect(Array.from(encodeInput('é'))).toEqual([0xc3, 0xa9]);
  });
});
