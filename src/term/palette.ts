/**
 * Turning a {@link Color} into something React Native can paint.
 *
 * The first sixteen entries are the ones a program actually names — `ESC[31m`
 * is "red", and which red is the terminal's business. Both sets below are
 * slopterm's, so a log looks the same in the cockpit and on the phone; the rest
 * of the 256 is the standard 6×6×6 cube and greyscale ramp, which is defined
 * arithmetically and identical everywhere.
 *
 * The sheet is dark in both app themes (a terminal is), so there is one set of
 * sixteen rather than a light and a dark cut.
 */
// Unpacking the colours emulator.ts packed; see the disable there.
/* eslint-disable no-bitwise */
import { RGB_FLAG, type Color, type Style } from './emulator';

/** The named sixteen, in ANSI order: black, red, green, yellow, blue, magenta, cyan, white, then bright. */
const ANSI_16 = [
  '#1c1917',
  '#f87171',
  '#4ade80',
  '#fbbf24',
  '#60a5fa',
  '#e879f9',
  '#22d3ee',
  '#d6d3d1',
  '#57534e',
  '#fca5a5',
  '#86efac',
  '#fcd34d',
  '#93c5fd',
  '#f0abfc',
  '#67e8f9',
  '#fafaf9',
] as const;

/** The terminal's own ground and ink, independent of the app's palette. */
export const TERMINAL_BACKGROUND = '#17130f';
export const TERMINAL_FOREGROUND = '#e7e2db';

const CUBE_STEPS = [0, 95, 135, 175, 215, 255];

function hex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/** One of the 256 palette entries, as a CSS colour. */
function palette(index: number): string {
  if (index < 16) return ANSI_16[index];
  if (index < 232) {
    const n = index - 16;
    const r = CUBE_STEPS[Math.floor(n / 36) % 6];
    const g = CUBE_STEPS[Math.floor(n / 6) % 6];
    const b = CUBE_STEPS[n % 6];
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  const level = 8 + (index - 232) * 10;
  return `#${hex(level)}${hex(level)}${hex(level)}`;
}

function resolve(color: Color, fallback: string): string {
  if (color === null) return fallback;
  if (color >= RGB_FLAG) {
    const rgb = color & 0xffffff;
    return `#${rgb.toString(16).padStart(6, '0')}`;
  }
  return palette(color & 0xff);
}

export interface PaintedStyle {
  color: string;
  backgroundColor?: string;
  fontStyle?: 'italic';
  textDecorationLine?: 'underline';
  /** Bold selects the bright half of the sixteen, the way most terminals do. */
  bold: boolean;
  dim: boolean;
}

/** What a run of cells should look like: inverse and bold applied, not deferred. */
export function paint(style: Style): PaintedStyle {
  let fg = style.fg;
  // Bold on one of the eight named colours means its bright twin. Programs lean
  // on this — a bold-red error is meant to be the light red.
  if (style.bold && fg !== null && fg < 8) fg += 8;

  let color = resolve(fg, TERMINAL_FOREGROUND);
  let background = style.bg === null ? undefined : resolve(style.bg, TERMINAL_BACKGROUND);

  if (style.inverse) {
    const swapped = background ?? TERMINAL_BACKGROUND;
    background = color;
    color = swapped;
  }
  if (style.hidden) color = background ?? TERMINAL_BACKGROUND;

  return {
    color,
    backgroundColor: background,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecorationLine: style.underline ? 'underline' : undefined,
    bold: style.bold,
    dim: style.dim,
  };
}
