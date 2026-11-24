import React from 'react';
import { act, create } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { ToolCard } from '../src/ui/ToolCard';
import { font } from '../src/theme';
import type { ToolCard as Card } from '../src/api/toolcard';

it('uses sans for the human verb and mono for the technical subject', () => {
  const card: Card = { verb: 'Read', subject: 'src/example.ts', subjectStyle: 'path', facets: [], blocks: [], bare: false };
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<ToolCard card={card} state="ok" />); });
  const verb = tree.root.find(node => node.props.children === 'Read' && node.props.style?.fontFamily === font.sansMedium);
  const subject = tree.root.find(node => node.props.children === 'src/example.ts' && StyleSheet.flatten(node.props.style)?.fontFamily === font.mono);
  expect(verb).toBeTruthy();
  expect(subject).toBeTruthy();
  act(() => tree.unmount());
});

it('keeps actual output without adding an outer bordered evidence box', () => {
  const card: Card = { verb: 'Run', subject: 'tests', subjectStyle: 'plain', facets: [],
    blocks: [{ type: 'code', text: 'actual output', language: null, open: true, label: null }], bare: false };
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<ToolCard card={card} state="ok" />); });
  expect(JSON.stringify(tree.toJSON())).toContain('actual output');
  const outer = tree.root.findByType(ToolCard).children[0];
  expect(typeof outer === 'string' ? null : outer.props.style.borderWidth).toBeUndefined();
  act(() => tree.unmount());
});
