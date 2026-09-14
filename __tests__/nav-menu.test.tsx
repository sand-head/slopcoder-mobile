/**
 * The menu is the rail, so it has to keep the two properties a rail has.
 *
 * It carries every destination the cockpit's rail does, in its order — a menu
 * that drifts from the rail is a second navigation model to learn — and it is
 * mounted on *every* screen, because a menu that only exists on the home screen
 * is a home screen with a menu.
 *
 * Routines previously hung off Settings, which is where a thing goes when
 * nobody has decided where it goes. That is the regression these guard against.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, create } from 'react-test-renderer';

jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) =>
    select({ credential: { userName: 'jessie', server: 'https://slop.example.com' } }),
}));

import { MenuButton, NavMenu } from '../src/ui/NavMenu';
import { useRoutineAlert } from '../src/state/routines';

const SRC = path.join(__dirname, '..', 'src', 'screens');

function labels(tree: ReturnType<typeof create>): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string') return void found.push(node);
    if (Array.isArray(node)) return void node.forEach(walk);
    (node as { children?: unknown[] }).children?.forEach(walk);
  };
  walk(tree.toJSON());
  return found;
}

/** The strings under one node of the tree, for asking what a row says. */
function textOf(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  return ((node as { children?: unknown[] }).children ?? []).flatMap(textOf);
}

function mount(props: Partial<React.ComponentProps<typeof NavMenu>> = {}) {
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(
      <NavMenu visible onClose={() => {}} onGo={() => {}} {...props} />,
    );
  });
  return tree!;
}

describe('the menu', () => {
  beforeEach(() => act(() => useRoutineAlert.getState().setFailed(false)));

  it('offers the rail destinations, in the rail order', () => {
    const shown = labels(mount());
    const order = ['Sessions', 'New session', 'Routines', 'Code mode', 'Usage', 'Settings'].map(
      label => shown.indexOf(label),
    );

    expect(order.every(at => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  /**
   * The rail greys Code out rather than hiding it, and so does this: leaving it
   * off answers "where is code mode?" with silence, which is how it ended up
   * being asked twice.
   */
  it('lists code mode as somewhere else, and refuses to go there', () => {
    const gone: string[] = [];
    const tree = mount({ onGo: (d: string) => gone.push(d) });

    const shut = tree.root
      .findAll(node => typeof node.props.onPress === 'function' && node.props.disabled === true)
      .map(textOf);

    expect(shut.some(text => text.includes('Code mode'))).toBe(true);
    expect(gone).toEqual([]);
  });

  it('marks the screen you are on rather than offering it', () => {
    const gone: string[] = [];
    const tree = mount({ current: 'Usage', onGo: (d: string) => gone.push(d) });

    expect(labels(tree)).toContain('here');

    // Every other row still goes somewhere.
    const live = tree.root.findAll(
      node => typeof node.props.onPress === 'function' && node.props.disabled === false,
    );
    act(() => live[0].props.onPress());
    expect(gone.length).toBe(1);
  });

  it('says who is signed in, which is what the rail avatar is for', () => {
    expect(labels(mount())).toContain('jessie');
  });

  /** "Something broke overnight" has to reach you wherever you are. */
  it('pips the button, not just the row, when a run failed', () => {
    let tree: ReturnType<typeof create> | undefined;
    act(() => {
      tree = create(<MenuButton onPress={() => {}} />);
    });
    expect(tree!.root.findByProps({ accessibilityRole: 'button' }).props.accessibilityLabel).toBe(
      'Menu',
    );

    act(() => useRoutineAlert.getState().setFailed(true));
    expect(tree!.root.findByProps({ accessibilityRole: 'button' }).props.accessibilityLabel).toBe(
      'Menu — a routine run failed',
    );
  });
});

describe('where the menu is', () => {
  /**
   * A rail is on every page. This is a file scan rather than five render tests
   * because what it is really pinning is that nobody adds a sixth screen and
   * quietly leaves it stranded.
   */
  it.each([
    'Sessions.tsx',
    'NewSession.tsx',
    'SessionDetail.tsx',
    'Routines.tsx',
    'Usage.tsx',
    'Settings.tsx',
  ])('is mounted on %s', file => {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');

    expect(source).toContain('useNavMenu');
    // Both halves: the button in the header, the sheet at the root of it.
    expect(source).toContain('{nav.button}');
    expect(source).toContain('{nav.menu}');
  });

  /** Routines is a destination of its own; it is not a settings row. */
  it('does not smuggle routines back into settings', () => {
    const settings = fs.readFileSync(path.join(SRC, 'Settings.tsx'), 'utf8');
    expect(settings).not.toMatch(/navigate\('Routines'\)/);
  });
});
