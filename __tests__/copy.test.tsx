/**
 * Getting text off the phone.
 *
 * A transcript you cannot copy out of is one you have to retype, and this app
 * is often the only screen in front of someone when the useful line — a
 * command, an error, a relay URL — goes past. Two mechanisms carry that, and
 * both are invisible in a diff: `selectable` is one word on a `Text`, and the
 * fence's copy button only exists because `Prose` passes `onCopyCode`. Either
 * can be dropped by accident and nothing else would notice.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';

const mockSetString = jest.fn();
jest.mock('react-native/Libraries/Components/Clipboard/Clipboard', () => ({
  __esModule: true,
  default: { setString: (value: string) => mockSetString(value) },
}));

const mockTapSelect = jest.fn();
jest.mock('../src/ui/haptics', () => ({
  tapSelect: () => mockTapSelect(),
  tapConfirm: jest.fn(),
  tapRefuse: jest.fn(),
  tapError: jest.fn(),
  tapSuccess: jest.fn(),
}));

import { copyText } from '../src/ui/clipboard';
import { Prose } from '../src/ui/kit';

/** Every string drawn anywhere in the tree. */
function strings(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  const element = node as { children?: unknown[] };
  (element.children ?? []).forEach(child => strings(child, out));
  return out;
}

/** Every node of a type, anywhere in the tree. */
function findAll(node: unknown, type: string, out: Record<string, unknown>[] = []) {
  if (node == null || typeof node === 'string') return out;
  const element = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] };
  if (element.type === type) out.push(element.props ?? {});
  (element.children ?? []).forEach(child => findAll(child, type, out));
  return out;
}

describe('copyText', () => {
  beforeEach(() => {
    mockSetString.mockClear();
    mockTapSelect.mockClear();
  });

  it('puts the text on the pasteboard and taps to say so', () => {
    copyText('npm run bundle:check');

    expect(mockSetString).toHaveBeenCalledWith('npm run bundle:check');
    expect(mockTapSelect).toHaveBeenCalledTimes(1);
  });

  it('trims, because a line copied out of a fence carries the newline with it', () => {
    copyText('  - run: npm run bundle:check\n');

    expect(mockSetString).toHaveBeenCalledWith('- run: npm run bundle:check');
  });

  /** Clearing the pasteboard is worse than doing nothing at all. */
  it.each([['empty', ''], ['blank', '   \n'], ['missing', null], ['absent', undefined]])(
    'leaves the pasteboard alone for %s text',
    (_name, value) => {
      copyText(value as string | null | undefined);

      expect(mockSetString).not.toHaveBeenCalled();
      expect(mockTapSelect).not.toHaveBeenCalled();
    },
  );
});

describe('Prose', () => {
  it('gives every fence a copy button, by handing the renderer somewhere to copy to', async () => {
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<Prose>{'Run it:\n\n```bash\nnpm run bundle:check\n```\n'}</Prose>);
    });

    // The button is the library's, and it only renders when `onCopyCode` is
    // set — so its presence is the assertion that the prop still arrives.
    const buttons = findAll(tree!.toJSON(), 'View').filter(
      props => props.accessibilityLabel === 'Copy code',
    );
    expect(buttons).toHaveLength(1);

    await act(async () => tree!.unmount());
  });

  /**
   * The library labels that button with an icon font it brings along itself,
   * and nothing links that font: it is a transitive dependency, so the CLI
   * never autolinks it and its pod — which is where the .ttf lives — is never
   * installed. On the phone the button drew a missing-glyph box. The patch in
   * `patches/` says the word instead, in the mono this app does ship.
   */
  it('says the word, because the icon font it wanted is not in this app', async () => {
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<Prose>{'```bash\nnpm run bundle:check\n```\n'}</Prose>);
    });

    expect(strings(tree!.toJSON())).toContain('Copy');

    await act(async () => tree!.unmount());
  });

  it('renders its text selectable, so a reader can take one line and not the lot', async () => {
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<Prose>{'the relay is https://slop.example.com/push'}</Prose>);
    });

    const texts = findAll(tree!.toJSON(), 'Text');
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.some(props => props.selectable === true)).toBe(true);

    await act(async () => tree!.unmount());
  });
});
