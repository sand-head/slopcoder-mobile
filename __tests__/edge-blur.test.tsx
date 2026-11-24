/**
 * The session header's backdrop: the native blur only on iOS with glass
 * available, the painted fade everywhere else — Android, iOS before 26, and
 * Reduce Transparency, followed live.
 */
import React from 'react';
import { AccessibilityInfo, Platform, StyleSheet, type ViewStyle } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SessionHeader } from '../src/ui/SessionHeader';
import { edgeBlurEnabled } from '../src/ui/EdgeBlur';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

const glass = require('@callstack/liquid-glass');
const originalOS = Platform.OS;

function header() {
  return (
    <SessionHeader
      title="Debounce session search"
      subtitle="2 repositories"
      contextPercent={34}
      onBack={() => {}}
      onOpenContext={() => {}}
      onOpenUsage={() => {}}
      menuItems={[]}
    />
  );
}

const blurs = (tree: ReactTestRenderer) => tree.root.findAll(node => node.props.testID === 'edge-blur' && typeof node.type !== 'string');
const containerStyle = (tree: ReactTestRenderer) =>
  StyleSheet.flatten(tree.root.findAll(node => node.props.testID === 'session-header' && typeof node.type === 'string')[0].props.style) as ViewStyle & { backgroundImage?: string };

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS });
  glass.isLiquidGlassSupported = false;
  jest.restoreAllMocks();
});

describe('edgeBlurEnabled', () => {
  it('is iOS with glass available, and nothing else', () => {
    expect(edgeBlurEnabled({ os: 'ios', glassAvailable: true })).toBe(true);
    expect(edgeBlurEnabled({ os: 'ios', glassAvailable: false })).toBe(false);
    expect(edgeBlurEnabled({ os: 'android', glassAvailable: true })).toBe(false);
    expect(edgeBlurEnabled({ os: 'android', glassAvailable: false })).toBe(false);
  });
});

describe('the header backdrop', () => {
  it('blurs on iOS with glass, fades under Reduce Transparency, and follows the setting live', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    glass.isLiquidGlassSupported = true;
    let change!: (value: boolean) => void;
    jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_, cb) => {
      change = cb as (value: boolean) => void;
      return { remove: jest.fn() };
    });
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(header());
    });
    expect(blurs(tree)).toHaveLength(1);
    expect(containerStyle(tree).backgroundImage).toBeUndefined();
    // The blur is a backdrop: it must never take a touch meant for a capsule.
    expect(blurs(tree)[0].props.pointerEvents).toBe('none');

    await act(async () => change(true));
    expect(blurs(tree)).toHaveLength(0);
    expect(containerStyle(tree).backgroundImage).toMatch(/^linear-gradient/);

    await act(async () => change(false));
    expect(blurs(tree)).toHaveLength(1);
  });

  it('fades on iOS before 26, where there is no glass', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    glass.isLiquidGlassSupported = false;
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(header());
    });
    expect(blurs(tree)).toHaveLength(0);
    expect(containerStyle(tree).backgroundImage).toMatch(/^linear-gradient/);
  });

  it('paints the header on Android and never asks for the native view', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    glass.isLiquidGlassSupported = true;
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(header());
    });
    expect(blurs(tree)).toHaveLength(0);
    expect(containerStyle(tree).backgroundImage).toBeUndefined();
    expect(containerStyle(tree).backgroundColor).toBeDefined();
  });
});
