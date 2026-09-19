/**
 * Headings in prose, and the room they need.
 *
 * The markdown display sizes headings for a web page and gives none of them a
 * line height, so `body`'s came down the inheritance chain instead: a 32px h1
 * was drawn in 23px of leading, which clips the glyphs and overlaps the lines
 * when the heading wraps. Nothing in a diff shows that — the styles look fine,
 * and only a long heading on a phone screen proves otherwise — so the leading
 * is asserted here, per level.
 */
import React from 'react';
import { StyleSheet, Text, type TextStyle } from 'react-native';
import { act, create } from 'react-test-renderer';
import { Prose } from '../src/ui/kit';

const LEVELS = [1, 2, 3, 4, 5, 6];

/** The style a heading's own text node ends up wearing, inheritance and all. */
async function headingStyle(level: number): Promise<TextStyle> {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(<Prose>{`${'#'.repeat(level)} Heading\n`}</Prose>);
  });

  const node = tree!.root
    .findAllByType(Text)
    .find(candidate => candidate.props?.children === 'Heading');
  expect(node).toBeDefined();

  const style = StyleSheet.flatten(node!.props.style) as TextStyle;
  await act(async () => tree!.unmount());
  return style;
}

describe('a heading', () => {
  // A line needs more room than its glyphs: at its own size exactly, the
  // ascenders and descenders are clipped and two wrapped lines touch. A fifth
  // again is the least that reads as a heading rather than a squeeze, and it
  // is the number that fails the moment a heading is left borrowing `body`'s
  // leading instead of naming its own.
  it.each(LEVELS)('h%i has leading of its own, and room to draw in it', async level => {
    const { fontSize, lineHeight } = await headingStyle(level);

    expect(fontSize).toBeGreaterThan(0);
    expect(lineHeight).toBeGreaterThanOrEqual(fontSize! * 1.2);
  });

  it('descends level by level, at sizes that belong on a phone', async () => {
    const sizes: number[] = [];
    for (const level of LEVELS) sizes.push((await headingStyle(level)).fontSize!);

    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    // The library's own h1 is 32, which is a page's heading, not a phone's.
    expect(sizes[0]).toBeLessThanOrEqual(24);
  });
});
