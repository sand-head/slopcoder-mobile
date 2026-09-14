/**
 * The panel is the rail, so it has to keep what a rail is.
 *
 * It carries every destination the cockpit's rail does, in its order — a menu
 * that drifts from the rail is a second navigation model to learn — it comes in
 * from the same edge, and it is on the pages the rail is on: the places you
 * switch *between*. A pushed screen keeps its back chevron and gets none.
 *
 * Two shapes this went through first, both wrong, both cheap to slip back into:
 * Routines hanging off Settings, which is where a thing goes when nobody has
 * decided where it goes; and the panel as a bottom sheet, which is the gesture
 * for choices *this* screen is making, not for leaving it.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { Animated, Modal } from 'react-native';
import { act, create } from 'react-test-renderer';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) =>
    select({ credential: { userName: 'jessie', server: 'https://slop.example.com' } }),
}));

import { MenuButton, NavPanel } from '../src/ui/NavMenu';
import { useRoutineAlert } from '../src/state/routines';

const SRC = path.join(__dirname, '..', 'src', 'screens');

/** Screens that carry the panel, and screens that must not. */
const ROOT = ['Sessions.tsx', 'Routines.tsx', 'Usage.tsx', 'Settings.tsx'];
const PUSHED = ['NewSession.tsx', 'SessionDetail.tsx', 'Routine.tsx'];

function text(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  return ((node as { children?: unknown[] }).children ?? []).flatMap(text);
}

function mount(props: Partial<React.ComponentProps<typeof NavPanel>> = {}) {
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(<NavPanel visible onClose={() => {}} onGo={() => {}} {...props} />);
  });
  return tree!;
}

describe('the panel', () => {
  beforeEach(() => act(() => useRoutineAlert.getState().setFailed(false)));

  it('offers the rail destinations, in the rail order', () => {
    const shown = text(mount().toJSON());
    const order = ['Sessions', 'New session', 'Routines', 'Code mode', 'Usage', 'Settings'].map(
      label => shown.indexOf(label),
    );

    expect(order.every(at => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  /**
   * The whole point of the rewrite: it comes in from the left, over the screen,
   * rather than up from the bottom. A transform that starts at +width, or a
   * height instead of a width, is this test failing.
   */
  it('comes in from the left edge, over the screen', () => {
    const tree = mount();

    expect(tree.root.findByType(Modal).props.transparent).toBe(true);
    // Ours, not the modal's: a second animation over the slide is the jank.
    expect(tree.root.findByType(Modal).props.animationType).toBe('none');

    const panel = tree.root
      .findAllByType(Animated.View)
      .map(node => node.props.style)
      .find(style => style && style.width !== undefined);

    expect(panel.left).toBe(0);
    expect(panel.top).toBe(0);
    expect(panel.bottom).toBe(0);
    expect(panel.width).toBeGreaterThan(200);
    expect(panel.transform[0].translateX).toBeDefined();
  });

  /** Tapping the dimmed part of the screen behind is how a panel is dismissed. */
  it('closes when the screen behind it is tapped', () => {
    const closed = jest.fn();
    const tree = mount({ onClose: closed });

    act(() => tree.root.findByProps({ accessibilityLabel: 'Close the menu' }).props.onPress());
    expect(closed).toHaveBeenCalled();
  });

  /**
   * The rail greys Code out rather than hiding it: leaving it off answers
   * "where is code mode?" with silence.
   */
  it('lists code mode as somewhere else, and refuses to go there', () => {
    const gone: string[] = [];
    const tree = mount({ onGo: (d: string) => gone.push(d) });

    const shut = tree.root
      .findAll(node => typeof node.props.onPress === 'function' && node.props.disabled === true)
      .map(text);

    expect(shut.some(words => words.includes('Code mode'))).toBe(true);
    expect(gone).toEqual([]);
  });

  it('marks the screen you are on rather than offering it', () => {
    const gone: string[] = [];
    const tree = mount({ current: 'Usage', onGo: (d: string) => gone.push(d) });

    const rows = tree.root.findAll(node => typeof node.props.onPress === 'function');
    const usage = rows.find(row => text(row).includes('Usage'))!;
    expect(usage.props.disabled).toBe(true);
    expect(usage.props.accessibilityState.selected).toBe(true);

    const sessions = rows.find(row => text(row).includes('Sessions'))!;
    act(() => sessions.props.onPress());
    expect(gone).toEqual(['Sessions']);
  });

  it('says who is signed in, which is what the rail avatar is for', () => {
    expect(text(mount().toJSON())).toContain('jessie');
  });

  /** "Something broke overnight" has to reach you wherever you are. */
  it('pips the button, not just the row, when a run failed', () => {
    let tree: ReturnType<typeof create> | undefined;
    act(() => {
      tree = create(<MenuButton onPress={() => {}} />);
    });
    const label = () =>
      tree!.root.findByProps({ accessibilityRole: 'button' }).props.accessibilityLabel;

    expect(label()).toBe('Menu');
    act(() => useRoutineAlert.getState().setFailed(true));
    expect(label()).toBe('Menu — a routine run failed');
  });

  /** Closed is closed: nothing of it is mounted, so nothing of it can be hit. */
  it('is not in the tree at all when it is shut', () => {
    let tree: ReturnType<typeof create> | undefined;
    act(() => {
      tree = create(<NavPanel visible={false} onClose={() => {}} onGo={() => {}} />);
    });
    expect(tree!.toJSON()).toBeNull();
  });
});

describe('where the panel is', () => {
  /**
   * A file scan rather than four render tests, because what it really pins is
   * that a fifth root screen is not left stranded — and that a detail screen
   * does not quietly grow a second way out.
   */
  it.each(ROOT)('leads the header on %s', file => {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');

    expect(source).toContain('useNavMenu');
    expect(source).toContain('{nav.menu}');

    // It leads: the button comes before whatever the header calls the screen.
    const at = (needle: string) => {
      const found = source.indexOf(needle);
      return found === -1 ? Infinity : found;
    };
    expect(at('{nav.button}')).toBeLessThan(Math.min(at('<Brand />'), at('fontSize: 14 }}>')));

    // Once, and in place of the back chevron rather than crowding beside it.
    expect(source.split('{nav.button}').length - 1).toBe(1);
    expect(source).not.toContain('<BackButton');
  });

  it.each(PUSHED)('is not on %s, which has a back chevron instead', file => {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');

    expect(source).not.toContain('useNavMenu');
    expect(source).toContain('<BackButton');
  });

  /** Routines is a destination of its own; it is not a settings row. */
  it('does not smuggle routines back into settings', () => {
    const settings = fs.readFileSync(path.join(SRC, 'Settings.tsx'), 'utf8');
    expect(settings).not.toMatch(/navigate\('Routines'\)/);
  });
});
