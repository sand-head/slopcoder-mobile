/**
 * The rule that a row with a menu can still be tapped.
 *
 * On iOS the native menu is a `UIButton` wrapped around whatever it is given,
 * and the button takes the tap: a `Pressable` inside one is pressed and never
 * fires. Rows and cards were wrapped that way so that a long press would open
 * the menu — and the tap went nowhere at all, so for a while the only way to
 * open a memory, an MCP server or a published artifact was to long-press it and
 * pick Open from the menu.
 *
 * Nothing about that is visible from JS: `onPress` is on the tree, a test that
 * calls it passes, and the screenshot looks right. What *is* visible is the
 * shape — a press handler standing underneath a `MenuView` — so that is what
 * this holds still, for every shared row and card at once.
 */
import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import type { ArtifactSummary } from '../src/api/contracts';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));

import { ArtifactCard } from '../src/ui/ArtifactCard';
import { ListRow } from '../src/ui/settings';

const artifact: ArtifactSummary = {
  id: 'a-1',
  slug: 'battery-landscape',
  title: 'Battery chemistry landscape',
  format: 'markdown',
  contentType: 'text/markdown; charset=utf-8',
  description: '',
  preview: '# Findings\n\nSodium-ion is shipping.',
  size: 4096,
  version: 3,
  sessionId: 's-1',
  sessionTitle: 'Battery research',
  routineId: null,
  routineName: null,
  shareToken: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-17T09:00:00Z',
  shared: false,
  sharePath: null,
};

const menu = [
  { key: 'open', title: 'Open', onPress: jest.fn() },
  { key: 'delete', title: 'Delete', destructive: true, onPress: jest.fn() },
];

function mount(element: React.ReactElement): ReturnType<typeof create> {
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(element);
  });
  return tree!;
}

/**
 * Every press handler a `MenuView` has under it, named — the instances
 * themselves print a whole fiber when an assertion fails, which is unreadable.
 */
function pressablesInsideMenus(tree: ReturnType<typeof create>): string[] {
  return tree.root
    .findAll(node => node.type === ('MenuView' as unknown as React.ElementType))
    .flatMap(menuView =>
      menuView.findAll(
        (node: ReactTestInstance) =>
          typeof node.type === 'string' && typeof node.props?.onPress === 'function',
      ),
    )
    .map(node => String(node.props.accessibilityLabel ?? node.type));
}

describe('a row that carries a menu', () => {
  it('keeps its tap out of the menu — a card', () => {
    const tree = mount(<ArtifactCard artifact={artifact} onPress={jest.fn()} menu={menu} />);

    expect(pressablesInsideMenus(tree)).toHaveLength(0);
  });

  it('keeps its tap out of the menu — a settings row', () => {
    const tree = mount(
      <ListRow title="Sodium notes" subtitle="pinned" chevron onPress={jest.fn()} menu={menu} />,
    );

    expect(pressablesInsideMenus(tree)).toHaveLength(0);
  });

  it('still offers the menu, on a control of its own', () => {
    const tree = mount(<ArtifactCard artifact={artifact} onPress={jest.fn()} menu={menu} />);
    // Host nodes only: a `Pressable` is a component *and* the view it renders.
    const trigger = tree.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props?.accessibilityLabel === `Actions for ${artifact.title}`,
    );

    expect(trigger).toHaveLength(1);
    // And its actions are the ones it was handed, in order.
    const menuView = tree.root.findAll(
      node => node.type === ('MenuView' as unknown as React.ElementType),
    )[0];
    expect(menuView.props.actions.map((action: { title: string }) => action.title)).toEqual([
      'Open',
      'Delete',
    ]);
  });

  it('opens on a tap of the card itself', () => {
    const onPress = jest.fn();
    const tree = mount(<ArtifactCard artifact={artifact} onPress={onPress} menu={menu} />);
    const card = tree.root.findAll(
      node => node.props?.accessibilityLabel?.startsWith?.(artifact.title) === true,
    )[0];

    act(() => card.props.onPress());

    expect(onPress).toHaveBeenCalled();
  });
});
