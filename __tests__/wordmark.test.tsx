/**
 * "slop" and "coder" must sit on one baseline.
 *
 * They are two `Text` nodes in two different faces, and React Native aligns
 * *boxes*, not baselines — so whether the wordmark reads as one word or as a
 * word with a superscript falls out of the two fonts' vertical metrics and
 * whatever `lineHeight` the style asks for. Baloo 2 ships Devanagari metrics
 * (1.078em over 0.524em, a 1.6em line box); pinning that box to 1em on iOS
 * pushes the glyphs up and out of it, which is exactly what shipped in the
 * first TestFlight build.
 *
 * Nothing in a JS test can render type, so this reads the shipped `.ttf`s and
 * does the arithmetic React Native's layout would do.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { Brand } from '../src/ui/kit';

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');

/** Ascent and descent in em, straight out of the font's `hhea` table. */
function metrics(family: string): { ascent: number; descent: number; lineGap: number } {
  const file = fs.readFileSync(path.join(FONT_DIR, `${family}.ttf`));
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);

  const tables = new Map<string, number>();
  const count = view.getUint16(4);
  for (let i = 0; i < count; i++) {
    const entry = 12 + i * 16;
    tables.set(file.toString('ascii', entry, entry + 4), view.getUint32(entry + 8));
  }

  const head = tables.get('head');
  const hhea = tables.get('hhea');
  if (head === undefined || hhea === undefined) throw new Error(`${family} has no head/hhea`);

  const upm = view.getUint16(head + 18);
  return {
    ascent: view.getInt16(hhea + 4) / upm,
    descent: view.getInt16(hhea + 6) / upm,
    lineGap: view.getInt16(hhea + 8) / upm,
  };
}

interface Word {
  fontFamily: string;
  fontSize: number;
  lineHeight?: number;
}

function flatten(style: unknown): Record<string, any> | undefined {
  return Array.isArray(style) ? Object.assign({}, ...style) : (style as Record<string, any>);
}

/** The two words, and how the row they share aligns them. */
function wordmark(size: number): { words: Word[]; alignItems?: string } {
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(<Brand size={size} />);
  });

  const words: Word[] = [];
  let alignItems: string | undefined;

  const walk = (node: any) => {
    if (!node || typeof node === 'string') return;

    const style = flatten(node.props?.style);
    if (style?.fontFamily) words.push(style as Word);
    // The row that holds the words is the one whose own children carry faces.
    if ((node.children ?? []).some((child: any) => flatten(child?.props?.style)?.fontFamily))
      alignItems = style?.alignItems;

    for (const child of node.children ?? []) walk(child);
  };

  walk(tree!.toJSON());
  return { words, alignItems };
}

describe('the wordmark', () => {
  it('renders both words in the faces the theme names', () => {
    expect(wordmark(15).words.map(w => w.fontFamily)).toEqual([
      'Baloo2-ExtraBold',
      'GeistMono-Regular',
    ]);
  });

  it.each([13, 15, 17])('sits both words on one baseline at size %s', size => {
    const { words, alignItems } = wordmark(size);
    const [slop, coder] = words;

    // The arithmetic below is the arithmetic for centred boxes; say so.
    expect(alignItems).toBe('center');

    // The precondition, stated so a regression names itself rather than showing
    // up as a number that drifted: a pinned line box is what breaks this.
    expect(slop.lineHeight).toBeUndefined();
    expect(coder.lineHeight).toBeUndefined();

    // Each word's box is its font's natural line height, and `alignItems:
    // 'center'` puts the two box centres on one line. Where the baseline lands
    // relative to that centre is what has to agree.
    const below = (word: Word) => {
      const { ascent, descent, lineGap } = metrics(word.fontFamily);
      const box = (ascent - descent + lineGap) * word.fontSize;
      return ascent * word.fontSize - box / 2;
    };

    expect(Math.abs(below(slop) - below(coder))).toBeLessThan(1);
  });

  it('would fail the same way the shipped build did', () => {
    // Baloo 2's box crushed to its own font size — the bug — drops the baseline
    // a third of a line, which is the drift the test above is sized to catch.
    const { ascent, descent } = metrics('Baloo2-ExtraBold');
    expect(ascent - descent).toBeGreaterThan(1.5);
  });
});
