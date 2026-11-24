/**
 * The session header holds its title between its buttons by construction.
 *
 * The header it replaces handed UIKit a title view that Yoga had sized against
 * the whole screen, so the title was never truncated and slid under a bar
 * button. Nothing in a diff shows that; these assertions pin the layout that
 * prevents it: fixed-width sides, a centre that takes what is left and may
 * shrink to nothing, and one-line text that ellipsizes in it.
 */
import React from 'react';
import { StyleSheet, Text, type TextStyle, type ViewStyle } from 'react-native';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import {
  ContextRing,
  HEADER_CONTROL,
  HEADER_TEXT_SCALE_CAP,
  SessionHeader,
  ringRotations,
  ringTone,
} from '../src/ui/SessionHeader';
import { sessionSubtitle } from '../src/api/captions';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

const LONG = 'Slopcoder Web and Mobile Redesign, with a title far longer than any phone is wide';

async function render(props: Partial<React.ComponentProps<typeof SessionHeader>> = {}) {
  const handlers = { onBack: jest.fn(), onOpenContext: jest.fn(), onOpenUsage: jest.fn(), terminal: jest.fn() };
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(
      <SessionHeader
        title="Debounce session search"
        subtitle="2 repositories"
        contextPercent={34}
        onBack={handlers.onBack}
        onOpenContext={handlers.onOpenContext}
        onOpenUsage={handlers.onOpenUsage}
        menuItems={[{ key: 'terminal', title: 'Open terminal', symbol: 'terminal', onPress: handlers.terminal }]}
        {...props}
      />,
    );
  });
  return { tree: tree!, handlers };
}

const flat = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) as ViewStyle & TextStyle;
const byTestId = (tree: ReturnType<typeof create>, id: string) =>
  tree.root.findAll(node => node.props.testID === id && typeof node.type !== 'string')[0] ?? tree.root.findByProps({ testID: id });

/** The header row's three children, in order: back, centre, right. */
function row(tree: ReturnType<typeof create>) {
  const header = tree.root.findAll(node => node.props.testID === 'session-header' && typeof node.type === 'string')[0];
  return header.children.filter((child): child is ReactTestInstance => typeof child !== 'string');
}

describe('session header layout', () => {
  it('is one row of three: a fixed back button, a centre that takes the rest, a right capsule', async () => {
    const { tree } = await render();
    const [back, centre, right] = row(tree);
    expect(row(tree)).toHaveLength(3);
    expect(flat(back)).toMatchObject({ width: HEADER_CONTROL, height: HEADER_CONTROL });
    // The centre grows into the gap and may shrink below its content: this is
    // what keeps a long title from pushing the sides out or running under them.
    expect(flat(centre)).toMatchObject({ flex: 1, minWidth: 0 });
    expect(flat(right).flex).toBeUndefined();
  });

  it('truncates the title and subtitle to one line with an ellipsis, however long', async () => {
    const { tree } = await render({ title: LONG, subtitle: `${LONG} repositories` });
    const texts = tree.root.findAllByType(Text).filter(node => node.props.children === LONG || node.props.children === `${LONG} repositories`);
    expect(texts).toHaveLength(2);
    for (const text of texts) {
      expect(text.props.numberOfLines).toBe(1);
      expect(text.props.ellipsizeMode).toBe('tail');
      expect(text.props.maxFontSizeMultiplier).toBe(HEADER_TEXT_SCALE_CAP);
    }
  });

  it('grows the capsule with large text rather than clipping it', async () => {
    const { tree } = await render();
    const [, centre] = row(tree);
    expect(flat(centre).minHeight).toBe(HEADER_CONTROL);
    expect(flat(centre).height).toBeUndefined();
  });

  it('clears the status bar with the safe area', async () => {
    const { tree } = await render();
    const header = tree.root.findAll(node => node.props.testID === 'session-header')[0];
    expect(flat(header).paddingTop).toBe(47 + 6);
  });

  it('wires back, the centre and the ring to what they open', async () => {
    const { tree, handlers } = await render();
    await act(async () => byTestId(tree, 'session-header-back').props.onPress());
    await act(async () => byTestId(tree, 'session-header-title').props.onPress());
    await act(async () => byTestId(tree, 'session-header-ring').props.onPress());
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenContext).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenUsage).toHaveBeenCalledTimes(1);
  });

  it('hands the menu its items, so everything the old header offered stays reachable', async () => {
    const { tree } = await render();
    const menu = tree.root.find(node => node.type === ('MenuView' as never));
    expect(menu.props.actions.map((action: { title: string }) => action.title)).toEqual(['Open terminal']);
  });

  it('keeps the ring when no usage has been reported, empty and saying so', async () => {
    const { tree, handlers } = await render({ contextPercent: null });
    const ring = byTestId(tree, 'session-header-ring');
    expect(ring.props.accessibilityLabel).toBe('Context usage not reported yet. Session usage');
    expect(tree.root.findAll(node => node.props.testID === 'context-ring' && typeof node.type === 'string')).toHaveLength(1);
    // A dash, never a 0 it does not know.
    const texts = ring.findAll(node => (node.type as unknown) === 'Text').map(node => node.children.join(''));
    expect(texts).toEqual(['–']);
    await act(async () => ring.props.onPress());
    expect(handlers.onOpenUsage).toHaveBeenCalledTimes(1);
  });

  it('says what the centre opens', async () => {
    const { tree } = await render({ accessibilityNote: 'archived · read-only' });
    expect(byTestId(tree, 'session-header-title').props.accessibilityLabel).toBe(
      'Debounce session search. 2 repositories. archived · read-only. Session context',
    );
  });
});

describe('context ring', () => {
  it('uses the web ContextRing thresholds', () => {
    expect(ringTone(0)).toBe('ok');
    expect(ringTone(69)).toBe('ok');
    expect(ringTone(70)).toBe('warn');
    expect(ringTone(89)).toBe('warn');
    expect(ringTone(90)).toBe('hot');
  });

  it('sweeps clockwise: nothing at 0, the right half at 50, all of it at 100', () => {
    expect(ringRotations(0)).toEqual({ right: -135, left: 45 });
    expect(ringRotations(50)).toEqual({ right: 45, left: 45 });
    expect(ringRotations(100)).toEqual({ right: 45, left: 225 });
    expect(ringRotations(150)).toEqual(ringRotations(100));
    expect(ringRotations(-5)).toEqual(ringRotations(0));
  });

  it('shows the rounded percent in the ring', async () => {
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<ContextRing percent={33.6} />);
    });
    expect(tree!.root.findAllByType(Text).map(node => node.props.children)).toContain(34);
  });
});

describe('subtitle', () => {
  it('says what the session works on, as the eyebrow did', () => {
    expect(sessionSubtitle([])).toBe('No repositories');
    expect(sessionSubtitle(['web', 'mobile'])).toBe('2 repositories');
    expect(sessionSubtitle(['slopcoder'])).toBe('slopcoder');
    expect(sessionSubtitle(['slopcoder'], [{ repo: 'slopcoder', branch: 'main' }])).toBe('slopcoder · main');
    expect(sessionSubtitle(['slopcoder'], [{ repo: 'other', branch: 'main' }])).toBe('slopcoder');
  });
});

describe('an empty ring', () => {
  // Each drawn half of the arc is a view rotated inside a clip; with nothing to
  // show, none may be drawn, or its anti-aliased edge shows at six o'clock.
  const arcs = (tree: ReturnType<typeof create>) =>
    tree.root.findAll(node => typeof node.type === 'string' && JSON.stringify(StyleSheet.flatten(node.props.style)?.transform ?? '').includes('rotate'));

  it.each([null, 0])('draws no arc for %p', async percent => {
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<ContextRing percent={percent} />);
    });
    expect(arcs(tree!)).toHaveLength(0);
  });

  it('draws the arc once there is usage', async () => {
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<ContextRing percent={1} />);
    });
    expect(arcs(tree!).length).toBeGreaterThan(0);
  });
});
