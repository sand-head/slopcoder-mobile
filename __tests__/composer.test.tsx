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
import { Sheet } from '../src/ui/Sheet';

const options = {
  selection: { auto: true, connectionId: null, modelId: null },
  thinking: null,
  approval: ApprovalMode.Dangerous,
  facet: null,
};

function mount(props: {
  running: boolean;
  launcher?: boolean;
  value: string;
  onStop?: () => void;
  onChangeValue?: (next: string) => void;
  images?: React.ComponentProps<typeof Composer>['images'];
  commands?: React.ComponentProps<typeof Composer>['commands'];
  sessionStatus?: string;
  onJumpStatus?: () => void;
  onJumpLatest?: () => void;
}) {
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(
      <Composer
        launcher={props.launcher}
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
        sessionStatus={props.sessionStatus}
        onJumpStatus={props.onJumpStatus}
        onJumpLatest={props.onJumpLatest}
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
  it('keeps real status and latest navigation inside the composer', () => {
    const status = jest.fn();
    const latest = jest.fn();
    const tree = mount({ running: true, value: '', sessionStatus: 'Waiting for permission', onJumpStatus: status, onJumpLatest: latest });
    act(() => tree.root.find(node => node.props.accessibilityLabel === 'Waiting for permission. Jump to current request' && node.props.onPress).props.onPress());
    act(() => tree.root.find(node => node.props.accessibilityLabel === 'Jump to the latest' && node.props.onPress).props.onPress());
    expect(status).toHaveBeenCalledTimes(1);
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('places selected images in a horizontal strip before the transparent input', () => {
    const tree = mount({ running: false, value: '', images: {
      pending: [{ key: 'a', mediaType: 'image/jpeg', base64Data: 'QUJD' }],
      onPick: () => {}, onRemove: () => {}, error: null,
    } });
    const strip = tree.root.findAll(node => node.props.accessibilityLabel === 'Selected context' && node.props.horizontal)[0];
    expect(strip).toBeDefined();
    expect(strip.findAll(node => node.props.accessibilityLabel === 'Remove image 1 of 1').length).toBeGreaterThan(0);
    const input = tree.root.findAll(node => node.props.placeholder === 'Send a message…' && node.props.style?.backgroundColor === 'transparent')[0];
    expect(input.props.style.backgroundColor).toBe('transparent');
  });

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

/**
 * The toolbar is one line. It used to wrap, and with a model, two dials and a
 * labelled Start it ran to two rows and spilled off the card.
 */
it('keeps the toolbar on one line and gives send and stop expanded touch targets', () => {
  const tree = mount({ running: true, value: 'draft', onStop: () => {} });
  const toolbar = tree.root.findByProps({ testID: 'composer-toolbar' });
  expect(toolbar.props.style.flexWrap).toBeUndefined();
  // The dials scroll sideways inside the line instead.
  const dials = tree.root.findByProps({ testID: 'composer-dials' });
  expect(dials.props.horizontal).toBe(true);
  for (const label of ['Stop', 'Steer']) {
    const button = tree.root.find(node => node.props.accessibilityLabel === label && node.props.hitSlop === 5);
    expect(button.props.hitSlop).toBe(5);
  }
});

it('draws the launcher toolbar as icons, and exposes model through turn settings', () => {
  const tree = mount({ launcher: true, running: false, value: 'hello', images: {
    pending: [], onPick: () => {}, onRemove: () => {}, error: null,
  } });
  const input = tree.root.find(node => node.props.placeholder === 'Send a message…' && node.props.style?.minHeight === 72);
  expect(input.props.style.maxHeight).toBeUndefined();
  const toolbar = tree.root.findByProps({ testID: 'composer-toolbar' });
  // Named for a screen reader, not written on the card.
  for (const word of ['Attach', 'Settings', 'Send'])
    expect(toolbar.findAll(node => node.props.children === word)).toHaveLength(0);
  expect(labels(tree)).toEqual(expect.arrayContaining(['Attach', 'Turn settings', 'Send']));
  expect(toolbar.findAll(node => node.props.children === 'Auto')).toHaveLength(0);
  act(() => tree.root.find(node => node.props.accessibilityLabel === 'Turn settings' && node.props.onPress).props.onPress());
  expect(tree.root.findAllByType(Sheet).find(sheet => sheet.props.title === 'Turn settings')?.props.visible).toBe(true);
  act(() => tree.root.find(node => node.props.accessibilityLabel === 'Model: Auto' && node.props.onPress).props.onPress());
  expect(tree.root.findAllByType(Sheet).find(sheet => sheet.props.title === 'Select model')?.props.visible).toBe(true);
  act(() => tree.unmount());
});
