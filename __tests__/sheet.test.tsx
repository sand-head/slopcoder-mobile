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
   * The sheet configures itself. Every prop this file used to pass was either
   * redundant — `grabber` already defaults to true, `cornerRadius` and
   * `backgroundColor` to the system's — or a fault: `detents={['auto', 1]}`
   * puts a *content-measured* detent at rest, so the sheet settled, sat for a
   * fifth of a second and then stepped 65px when the list re-measured. With a
   * long list `auto` clamps to the container, which is where `1` already is,
   * so the two detents were the same height and there was nothing to drag
   * between.
   */
  it('leaves the sheet to decide how a sheet behaves', () => {
    const props = sheetOf(mount(true)).props;

    for (const decision of [
      'detents',
      'grabber',
      'cornerRadius',
      'backgroundColor',
      'dimmed',
      'draggable',
      'dismissible',
      'initialDetentIndex',
      'maxContentHeight',
    ]) {
      expect(props[decision]).toBeUndefined();
    }
  });

  /** What we do have to say is what our own content is. */
  it('tells the sheet the body is a scroll view', () => {
    // `scrollable` pins the list inside the sheet and is what makes a pull in
    // the body open it instead of scrolling a letterbox.
    expect(sheetOf(mount(true)).props.scrollable).toBe(true);
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
