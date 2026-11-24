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
    expect(link.fontFamily).toBe('Allo-Medium');
    expect(link.fontSize).toBe(reading.prose.fontSize);
    // An inline view's bottom sits on the baseline: no leading of its own, and
    // dropped by the descent so the two baselines meet.
    expect('lineHeight' in link).toBe(false);
    expect(link.marginBottom).toBeCloseTo(-3.4, 1);
  });

  it('steps down inside a card', () => {
    expect(markdownStyles(paletteFor(true), 'small').body.fontSize).toBe(reading.proseSmall.fontSize);
  });
});

describe('blocks in a message, against the web transcript stylesheet', () => {
  const styles = markdownStyles(paletteFor(false));

  it('sets h1–h4 alike, one quiet step above the text, as the web does', () => {
    for (const level of [1, 2, 3, 4] as const) {
      const heading = styles[`heading${level}`];
      expect(heading.fontSize).toBe(15);
      // 20 above and 8 below once the paragraph's half gap is added back.
      expect(heading.marginTop + reading.paragraphGap / 2).toBe(20);
      expect(heading.marginBottom + reading.paragraphGap / 2).toBe(8);
    }
  });

  it('keeps a document its hierarchy', () => {
    const doc = markdownStyles(paletteFor(false), 'document');
    expect(doc.heading1.fontSize).toBeGreaterThan(doc.heading4.fontSize);
  });

  it('rules tables in the border colour, not the library black', () => {
    const c = paletteFor(true);
    const dark = markdownStyles(c);
    expect(dark.table.borderColor).toBe(c.border);
    expect(dark.tr.borderColor).toBe(c.border);
  });

  it('pads fences and code blocks as the web pre', () => {
    expect(styles.fence_code.padding).toBe(12);
    expect(styles.code_block.padding).toBe(12);
    expect(styles.fence_token.lineHeight).toBe(20);
  });
});
