/**
 * How a session reads, against the web cockpit at phone width.
 *
 * The markdown library brings its own defaults — 10 above and 10 below every
 * paragraph, an underline and a negative margin on every link — and they win
 * silently wherever a key is left unset. Nothing in a diff shows two
 * paragraphs standing 20 apart instead of the web's 8; these assertions do.
 */
import React from 'react';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { act, create } from 'react-test-renderer';
import { Prose, markdownStyles } from '../src/ui/kit';
import { paletteFor, reading } from '../src/theme';

async function render(markdown: string) {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(<Prose>{markdown}</Prose>);
  });
  return tree!;
}

describe('reading tokens', () => {
  it('match the web at 390px', () => {
    expect(reading.column).toBe(21);
    expect(reading.prose).toEqual({ fontSize: 14, lineHeight: 24 });
    expect(reading.paragraphGap).toBe(8);
    expect(reading.user.fontSize).toBe(12);
  });

  it('leave every line room for its glyphs', () => {
    for (const style of [reading.prose, reading.proseSmall, reading.user, reading.summary, reading.note, reading.caption, reading.date]) {
      expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize * 1.2);
    }
  });
});

describe('prose', () => {
  it('sets two paragraphs the web paragraph gap apart, not the library default', async () => {
    const tree = await render('First paragraph.\n\nSecond paragraph.\n');
    const paragraphs = tree.root
      .findAllByType(View)
      .map(node => StyleSheet.flatten(node.props.style) as ViewStyle)
      .filter(style => style && style.flexWrap === 'wrap' && style.flexDirection === 'row');
    expect(paragraphs.length).toBe(2);
    const between = Number(paragraphs[0].marginBottom) + Number(paragraphs[1].marginTop);
    expect(between).toBe(reading.paragraphGap);
    await act(async () => tree.unmount());
  });

  it('draws body text at the reading size', async () => {
    const tree = await render('Plain words.\n');
    const node = tree.root.findAllByType(Text).find(candidate => candidate.props?.children === 'Plain words.');
    const style = StyleSheet.flatten(node!.props.style) as TextStyle;
    expect(style.fontSize).toBe(reading.prose.fontSize);
    expect(style.lineHeight).toBe(reading.prose.lineHeight);
    await act(async () => tree.unmount());
  });

  it('draws links medium and without the underline the web only shows on hover', () => {
    const link = markdownStyles(paletteFor(false)).link;
    expect(link.textDecorationLine).toBe('none');
    expect(link.marginBottom).toBe(0);
    expect(link.fontFamily).toBe('Allo-Medium');
  });

  it('steps down inside a card', () => {
    expect(markdownStyles(paletteFor(true), 'small').body.fontSize).toBe(reading.proseSmall.fontSize);
  });
});
