import React from 'react';
import { AccessibilityInfo, Platform, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { GlassSurface } from '../src/ui/kit';

const glass = require('@callstack/liquid-glass');
const originalOS = Platform.OS;

describe('GlassSurface accessibility', () => {
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS });
    glass.isLiquidGlassSupported = false;
    jest.restoreAllMocks();
  });

  it('stays opaque on unsupported platforms', () => {
    let tree: ReturnType<typeof create>;
    act(() => { tree = create(<GlassSurface><Text>Content</Text></GlassSurface>); });
    expect(tree!.root.findAllByProps({ effect: 'regular' })).toHaveLength(0);
    expect(tree!.root.findByType(Text).props.children).toBe('Content');
  });

  it('switches with reduce transparency and ignores a stale initial read', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    glass.isLiquidGlassSupported = true;
    let resolve!: (value: boolean) => void;
    let change!: (value: boolean) => void;
    const remove = jest.fn();
    jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockReturnValue(new Promise(r => { resolve = r; }));
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_, cb) => { change = cb as (value: boolean) => void; return { remove }; });
    let tree: ReturnType<typeof create>;
    act(() => { tree = create(<GlassSurface><Text>Content</Text></GlassSurface>); });
    expect(tree!.root.findAllByProps({ effect: 'regular' })).toHaveLength(0);
    act(() => change(false));
    expect(tree!.root.findAllByProps({ effect: 'regular' }).length).toBeGreaterThan(0);
    act(() => change(true));
    await act(async () => { resolve(false); await Promise.resolve(); });
    expect(tree!.root.findAllByProps({ effect: 'regular' })).toHaveLength(0);
    act(() => tree!.unmount());
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
