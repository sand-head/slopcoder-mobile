import React from 'react';
import { act, create } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { ListRow } from '../src/ui/settings';
import { font } from '../src/theme';

it('renders human subtitles and warnings in Allo while preserving literal file identifiers in mono', () => {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<ListRow title="Hooks" subtitle="Review hooks.json before running" warn="Needs attention" />); });
  expect(tree.root.findAll(node => node.props.children === 'hooks.json' && StyleSheet.flatten(node.props.style)?.fontFamily === font.mono).length).toBeGreaterThan(0);
  expect(tree.root.findAll(node => node.props.children === 'Needs attention' && StyleSheet.flatten(node.props.style)?.fontFamily === font.sans).length).toBeGreaterThan(0);
  act(() => tree.unmount());
});
