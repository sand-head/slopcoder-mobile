/**
 * The default git identity: the author a user's sessions commit as.
 *
 * The check is the contract's own (`GitIdentityPrefs.Problem`), run before the
 * save, because the server answers a bad value with a bare 400 — on a phone
 * that is a status code where a sentence should be.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { gitIdentityProblem, gitIdentityProblems } from '../src/api/settings';

describe('gitIdentityProblem', () => {
  it('takes blank as unset and a plain name or address as fine', () => {
    expect(gitIdentityProblem('', 'Name')).toBeNull();
    expect(gitIdentityProblem('   ', 'Name')).toBeNull();
    expect(gitIdentityProblem(null, 'Name')).toBeNull();
    expect(gitIdentityProblem('  Ada Lovelace  ', 'Name')).toBeNull();
    expect(gitIdentityProblem('ada@example.com', 'Email')).toBeNull();
  });

  it('refuses what git or a config line would mangle, in the server’s words', () => {
    expect(gitIdentityProblem('Ada\nLovelace', 'Name')).toBe("Name can't contain line breaks or control characters.");
    expect(gitIdentityProblem('Ada\u0085', 'Name')).toBe("Name can't contain line breaks or control characters.");
    expect(gitIdentityProblem('<ada@example.com>', 'Email')).toBe("Email can't contain < or >.");
    expect(gitIdentityProblem('x'.repeat(257), 'Name')).toBe('Name must be at most 256 characters.');
    // Trimmed first, as the server does.
    expect(gitIdentityProblem(` ${'x'.repeat(256)} `, 'Name')).toBeNull();
    expect(gitIdentityProblems('Ada', 'a<b')).toBe("Email can't contain < or >.");
  });
});

const mockSeam = {
  gitIdentity: jest.fn(() => Promise.resolve({ name: 'Ada', email: null as string | null })),
  saveGitIdentity: jest.fn(() => Promise.resolve(null)),
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));
jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) => select({ seam: mockSeam }),
}));

const { GitIdentityScreen } = require('../src/screens/settings/GitIdentity');

function text(tree: ReturnType<typeof create>): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string') return void parts.push(node);
    if (Array.isArray(node)) return void node.forEach(walk);
    (node as { children?: unknown[] }).children?.forEach(walk);
  };
  walk(tree.toJSON());
  return parts.join('');
}

describe('the git identity page', () => {
  const navigation = { setOptions: jest.fn() };
  const save = () => navigation.setOptions.mock.calls[navigation.setOptions.mock.calls.length - 1][0].unstable_headerRightItems()[0];

  async function mount() {
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<GitIdentityScreen navigation={navigation} />);
    });
    await act(async () => {});
    return tree!;
  }

  async function type(tree: ReturnType<typeof create>, label: string, value: string) {
    const fields = tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function');
    await act(async () => fields[fields.length - 1].props.onChangeText(value));
  }

  beforeEach(() => {
    navigation.setOptions.mockClear();
    mockSeam.saveGitIdentity.mockClear();
  });

  it('loads what is stored, saves an edit, and says when it applies', async () => {
    const tree = await mount();
    expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Name' && n.props.value === 'Ada').length).toBeGreaterThan(0);
    // Nothing to save until something changes.
    expect(save().disabled).toBe(true);

    await type(tree, 'Email', 'ada@example.com');
    expect(save().disabled).toBe(false);
    await act(async () => save().onPress());
    await act(async () => {});

    expect(mockSeam.saveGitIdentity).toHaveBeenCalledWith('Ada', 'ada@example.com');
    expect(text(tree)).toContain("applies from each session's next turn");
  });

  it('explains a bad value instead of sending it', async () => {
    const tree = await mount();
    await type(tree, 'Email', 'Ada <ada@example.com>');
    await act(async () => save().onPress());

    expect(mockSeam.saveGitIdentity).not.toHaveBeenCalled();
    expect(text(tree)).toContain("Email can't contain < or >.");
  });
});
