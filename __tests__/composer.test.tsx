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
  onChangeValue?: (next: string) => void;
  images?: React.ComponentProps<typeof Composer>['images'];
  commands?: React.ComponentProps<typeof Composer>['commands'];
}) {
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(
      <Composer
        value={props.value}
        onChangeValue={props.onChangeValue ?? (() => {})}
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
        commands={props.commands}
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

  /**
   * The slash menu: a bare "/" offers the lot, and opening it is what asks the
   * screen to refresh the list — a composer nobody types a slash into never
   * sends the server looking through the sandbox for repo templates.
   */
  it('offers every command on a bare slash, and asks for the list as it opens', () => {
    const onNeeded = jest.fn();
    const list = [
      { name: 'compact', help: 'summarize older history' },
      { name: 'cost', help: 'what this session has spent' },
    ];

    const idle = mount({ running: false, value: '', commands: { list, onNeeded } });
    expect(onNeeded).not.toHaveBeenCalled();
    expect(labels(idle)).not.toContain('/compact');

    const open = mount({ running: false, value: '/', commands: { list, onNeeded } });
    expect(onNeeded).toHaveBeenCalled();
    expect(labels(open)).toEqual(expect.arrayContaining(['/compact', '/cost']));
  });

  it('narrows to the prefix, and a tap puts the command in the box ready for arguments', () => {
    const onChangeValue = jest.fn();
    const list = [
      { name: 'compact', help: 'summarize older history' },
      { name: 'rewind', help: 'restore a checkpoint' },
    ];

    const tree = mount({
      running: false,
      value: '/com',
      onChangeValue,
      commands: { list, onNeeded: () => {} },
    });

    expect(labels(tree)).toContain('/compact');
    expect(labels(tree)).not.toContain('/rewind');

    act(() => {
      tree.root.find(node => node.props.accessibilityLabel === '/compact').props.onPress();
    });
    expect(onChangeValue).toHaveBeenCalledWith('/compact ');
  });

  /** Once the arguments start, the name is settled and the menu is in the way. */
  it('closes the menu as soon as an argument is typed', () => {
    const list = [{ name: 'rewind', help: 'restore a checkpoint' }];
    const tree = mount({
      running: false,
      value: '/rewind 3',
      commands: { list, onNeeded: () => {} },
    });

    expect(labels(tree)).not.toContain('/rewind');
  });

  it('offers no Stop when nothing is running', () => {
    const tree = mount({ running: false, value: '', onStop: () => {} });

    expect(labels(tree)).not.toContain('Stop');
    expect(labels(tree)).toContain('Send');
  });
});
