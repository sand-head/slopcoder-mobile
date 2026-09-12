/**
 * Every character the app renders in a bundled font must exist in that font.
 *
 * React Native has no font fallback stack the way CSS does: a missing glyph
 * becomes whatever the OS substitutes — a different typeface, or tofu — and it
 * fails silently. Geist Mono turns out to carry none of ✓ ✗ ◐ ☰ ∴ ⑂ ◈, which is
 * why those marks are drawn as shapes instead. This pins the ones that are
 * still characters, and fails if someone types a new mark that has no glyph.
 */
import fs from 'fs';
import path from 'path';
import { GLYPHS } from '../src/ui/kit';

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');

/**
 * Minimal TrueType cmap reader — enough to answer "is this codepoint mapped?".
 * The format-4 subtable is defined in terms of 16-bit wraparound arithmetic, so
 * the masking below is the specification, not a shortcut.
 */
/* eslint-disable no-bitwise */
function codepoints(file: string): Set<number> {
  const b = fs.readFileSync(file);
  const numTables = b.readUInt16BE(4);
  let cmapOffset = 0;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (b.toString('ascii', rec, rec + 4) === 'cmap') cmapOffset = b.readUInt32BE(rec + 8);
  }
  if (!cmapOffset) throw new Error(`no cmap in ${file}`);

  const found = new Set<number>();
  const numSub = b.readUInt16BE(cmapOffset + 2);
  for (let i = 0; i < numSub; i++) {
    const sub = cmapOffset + 4 + i * 8;
    const offset = cmapOffset + b.readUInt32BE(sub + 4);
    if (b.readUInt16BE(offset) !== 4) continue; // format 4 covers the BMP

    const segX2 = b.readUInt16BE(offset + 6);
    const ends = offset + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;

    for (let s = 0; s < segX2 / 2; s++) {
      const end = b.readUInt16BE(ends + s * 2);
      const start = b.readUInt16BE(starts + s * 2);
      if (start === 0xffff) continue;
      for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
        const rangeOffset = b.readUInt16BE(ranges + s * 2);
        let glyph: number;
        if (rangeOffset === 0) {
          glyph = (cp + b.readInt16BE(deltas + s * 2)) & 0xffff;
        } else {
          const gi = ranges + s * 2 + rangeOffset + (cp - start) * 2;
          if (gi + 1 >= b.length) continue;
          glyph = b.readUInt16BE(gi);
          if (glyph !== 0) glyph = (glyph + b.readInt16BE(deltas + s * 2)) & 0xffff;
        }
        if (glyph !== 0) found.add(cp);
      }
    }
  }
  return found;
}

describe('glyph coverage', () => {
  const mono = codepoints(path.join(FONT_DIR, 'GeistMono-Regular.ttf'));

  it.each(Object.entries(GLYPHS))('%s (%s) exists in Geist Mono', (_name, ch) => {
    expect(mono.has(ch.codePointAt(0)!)).toBe(true);
  });

  it('proves the reader works by rejecting a mark we deliberately do not type', () => {
    // ✓ U+2713 — absent, which is exactly why tool rows draw a dot instead.
    expect(mono.has(0x2713)).toBe(false);
  });

  it('finds ordinary characters, so a pass is not a vacuous one', () => {
    for (const ch of 'abcXYZ0189 ·—') expect(mono.has(ch.codePointAt(0)!)).toBe(true);
  });
});
