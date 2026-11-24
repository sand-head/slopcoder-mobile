import React from 'react';
import { AccessibilityInfo, LayoutAnimation, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { animateNextLayout, useReducedMotion } from '../src/ui/motion';

function Probe() { return <Text>{useReducedMotion() ? 'still' : 'motion'}</Text>; }

test('reduced motion is safe before the OS read and follows live changes', async () => {
  let resolve!: (value: boolean) => void;
  let event!: (value: boolean) => void;
  const remove = jest.fn();
  const read = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise(r => { resolve = r; }));
  const listen = jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_, cb) => { event = cb as (value: boolean) => void; return { remove }; });
  const animation = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {});
  let tree: ReturnType<typeof create>;
  act(() => { tree = create(<Probe />); });
  expect(tree!.root.findByType(Text).props.children).toBe('still');
  animateNextLayout();
  expect(animation).not.toHaveBeenCalled();
  act(() => event(false));
  animateNextLayout();
  expect(animation).toHaveBeenCalledTimes(1);
  act(() => event(true));
  await act(async () => { resolve(false); await Promise.resolve(); });
  expect(tree!.root.findByType(Text).props.children).toBe('still');
  animateNextLayout();
  expect(animation).toHaveBeenCalledTimes(1);
  act(() => tree!.unmount());
  expect(remove).toHaveBeenCalledTimes(1);
  read.mockRestore(); listen.mockRestore(); animation.mockRestore();
});
