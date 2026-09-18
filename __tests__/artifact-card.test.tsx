/**
 * The artifact a publish leaves behind, as the transcript shows it.
 *
 * The card is the one block that names a resource rather than describing
 * content, so the two things worth holding still are that it says what the file
 * is without being opened, and that tapping it lands on that artifact's screen
 * — on the phone the whole card is the button, because there is no hover to
 * hang an "Open" on.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { buildToolCard } from '../src/api/toolcard';

// `mock`-prefixed so jest lets the factory below close over it.
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

import { ToolCard } from '../src/ui/ToolCard';

const RESULT =
  'Published "Battery landscape" as artifact `battery-landscape` (markdown, 12.4 KB). ' +
  'The user can read it at /artifacts/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b. It is private until they share it.';

function card(result: string | null) {
  return buildToolCard(
    'publish_artifact',
    JSON.stringify({ title: 'Battery landscape', slug: 'battery-landscape' }),
    result,
    false,
  );
}

async function mount(result: string | null) {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(<ToolCard card={card(result)} state="ok" />);
  });
  return tree!;
}

function text(tree: ReturnType<typeof create>): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string') return void parts.push(node);
    if (Array.isArray(node)) return void node.forEach(walk);
    (node as { children?: unknown[] }).children?.forEach(walk);
  };
  walk(tree.toJSON());
  return parts.join(' ');
}

beforeEach(() => mockNavigate.mockReset());

it('names the file and its type without being opened', async () => {
  const tree = await mount(RESULT);
  const shown = text(tree);

  expect(shown).toContain('battery-landscape');
  expect(shown).toContain('Markdown · 12.4 KB');
  // The sentence it was read from is not repeated underneath it.
  expect(shown).not.toContain('It is private until they share it.');
});

it('opens that artifact when the card is tapped', async () => {
  const tree = await mount(RESULT);
  const pressable = tree.root.findAll(
    n => typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('battery-landscape'),
  )[0];

  await act(async () => pressable.props.onPress());

  expect(mockNavigate).toHaveBeenCalledWith('Tabs', {
    screen: 'ArtifactsTab',
    params: { screen: 'Artifact', params: { id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', title: 'battery-landscape' } },
  });
});

/** A call still at the approval gate has nothing to open, and must not pretend. */
it('offers nothing to tap before the call has run', async () => {
  const tree = await mount(null);
  const pressable = tree.root.findAll(
    n => typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('battery-landscape'),
  )[0];

  expect(pressable.props.disabled).toBe(true);
  expect(text(tree)).toContain('Artifact');
});
