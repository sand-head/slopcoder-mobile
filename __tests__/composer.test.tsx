/**
 * Stop is its own control, offered whenever a turn is running.
 *
 * It used to be what the send button turned into when the box was empty, so
 * that Enter could never reach it — a keyboard's problem, and there is no
 * Enter on a phone. The cost was real: with a steer half-typed there was no
 * way to stop without clearing it first.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { ApprovalMode } from '../src/api/contracts';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { Composer } from '../src/ui/Composer';

const options = {
  selection: { auto: true, connectionId: null, modelId: null },
  thinking: null,
  approval: ApprovalMode.Dangerous,
  facet: null,
};

function mount(props: {
  running: boolean;
  value: string;
  onStop?: () => void;
  images?: React.ComponentProps<typeof Composer>['images'];
}) {
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(
      <Composer
        value={props.value}
        onChangeValue={() => {}}
        placeholder="Send a message…"
        action={props.running ? 'Steer' : 'Send'}
        onAction={() => {}}
        running={props.running}
        onStop={props.onStop}
        options={options}
        onChangeOptions={() => {}}
        models={[]}
        facets={[]}
        images={props.images}
      />,
    );
  });
  return tree!;
}

const labels = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAll(node => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityRole === 'button')
    .map(node => node.props.accessibilityLabel as string);

describe('the composer', () => {
  it('offers Stop beside Send while a turn runs, even with a draft in the box', () => {
    const stop = jest.fn();
    const tree = mount({ running: true, value: 'and also check the tests', onStop: stop });

    expect(labels(tree)).toEqual(expect.arrayContaining(['Stop', 'Steer']));

    act(() => {
      tree.root.find(node => node.props.accessibilityLabel === 'Stop').props.onPress();
    });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  /**
   * The `+` is the platform's menu when a prompt can carry images: the
   * library, the camera, and nothing about the workspace in the cockpit,
   * whose workspace is already set.
   */
  it('offers the library and the camera from one native menu', () => {
    const onPick = jest.fn();
    const tree = mount({
      running: false,
      value: '',
      images: { pending: [], onPick, onRemove: () => {}, error: null },
    });

    const menu = tree.root.findByType('MenuView' as never);
    expect(menu.props.actions.map((a: { title: string }) => a.title)).toEqual(['Photo Library', 'Take Photo']);

    act(() => {
      menu.props.onPressAction({ nativeEvent: { event: 'camera' } });
    });
    expect(onPick).toHaveBeenCalledWith('camera');
  });

  it('shows each pending image as a chip that removes it, and the last refusal', () => {
    const onRemove = jest.fn();
    const tree = mount({
      running: false,
      value: '',
      images: {
        pending: [
          { key: 'a', mediaType: 'image/jpeg', base64Data: 'QUJD' },
          { key: 'b', mediaType: 'image/png', base64Data: 'QUJD' },
        ],
        onPick: () => {},
        onRemove,
        error: 'huge.png is over 2 MB.',
      },
    });

    // A Pressable's label is on its host view too; count the labels, not the nodes.
    const chips = [...new Set(labels(tree).filter(label => label.startsWith('Remove image')))];
    expect(chips).toEqual(['Remove image 1 of 2', 'Remove image 2 of 2']);
    expect(tree.root.findAll(node => node.props.children === 'huge.png is over 2 MB.')).not.toHaveLength(0);

    act(() => {
      tree.root.find(node => node.props.accessibilityLabel === 'Remove image 2 of 2').props.onPress();
    });
    expect(onRemove).toHaveBeenCalledWith('b');
  });

  it('offers no Stop when nothing is running', () => {
    const tree = mount({ running: false, value: '', onStop: () => {} });

    expect(labels(tree)).not.toContain('Stop');
    expect(labels(tree)).toContain('Send');
  });
});
