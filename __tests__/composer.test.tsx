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

function mount(props: { running: boolean; value: string; onStop?: () => void }) {
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

  it('offers no Stop when nothing is running', () => {
    const tree = mount({ running: false, value: '', onStop: () => {} });

    expect(labels(tree)).not.toContain('Stop');
    expect(labels(tree)).toContain('Send');
  });
});
