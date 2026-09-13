/**
 * The sheet is the platform's now; what is left to check is the wiring to it.
 *
 * Everything that used to be tested here — a drag ladder, two detents, a clamp,
 * a strip painted outside a `UIVisualEffectView` — was scaffolding around
 * `UISheetPresentationController`, and took five releases to get half as far as
 * the thing it was standing in for. The tests that went with it are gone too.
 * What remains are the four decisions this file still makes, each of which the
 * app would get wrong silently.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { ScrollView, Text } from 'react-native';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { Sheet } from '../src/ui/Sheet';

function mount(visible: boolean, onClose: () => void = () => {}) {
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(
      <Sheet visible={visible} title="Attach" onClose={onClose}>
        <Text>a repository</Text>
      </Sheet>,
    );
  });
  return tree!;
}

const sheetOf = (tree: ReturnType<typeof create>) => tree.root.findByType(TrueSheet as any);

describe('the sheet', () => {
  /**
   * `auto` first, so a short sheet is exactly as tall as its content and only a
   * sheet with something below the fold has a second detent to grow into.
   * Deciding that from a measurement, rather than letting the platform do it,
   * was two of the five releases.
   */
  it('sizes itself to its content, and grows to full', () => {
    expect(sheetOf(mount(true)).props.detents).toEqual(['auto', 1]);
  });

  /** The affordance the whole saga was about, now the system's own. */
  it('shows a grabber and lets the body expand the sheet', () => {
    const props = sheetOf(mount(true)).props;

    expect(props.grabber).toBe(true);
    // `scrollable` is what pins the list inside the sheet and makes a pull in
    // the body open it instead of scrolling a letterbox.
    expect(props.scrollable).toBe(true);
  });

  /** Otherwise the first tap on a search result is spent closing the keyboard. */
  it('keeps taps alive while the keyboard is up', () => {
    const scroll = mount(true).root.findByType(ScrollView);
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  });

  /**
   * A swipe down dismisses the sheet natively without telling React, so the
   * parent's `visible` would stay true and the sheet could never be reopened.
   */
  it('reports a native dismissal back to the caller', () => {
    const closed = jest.fn();
    const tree = mount(true, closed);

    act(() => sheetOf(tree).props.onDidDismiss());
    expect(closed).toHaveBeenCalled();
  });

  it('presents and dismisses as `visible` changes', () => {
    const tree = mount(false);
    const instance: any = sheetOf(tree).instance;

    expect(instance.present).not.toHaveBeenCalled();

    act(() => {
      tree.update(
        <Sheet visible title="Attach" onClose={() => {}}>
          <Text>a repository</Text>
        </Sheet>,
      );
    });
    expect(instance.present).toHaveBeenCalled();

    act(() => {
      tree.update(
        <Sheet visible={false} title="Attach" onClose={() => {}}>
          <Text>a repository</Text>
        </Sheet>,
      );
    });
    expect(instance.dismiss).toHaveBeenCalled();
  });
});
