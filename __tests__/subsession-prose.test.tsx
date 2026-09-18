/**
 * A partner's name in the agent's prose.
 *
 * Sub-sessions run on their own clock and answer in their own turns, so a
 * delegation-heavy transcript is full of names — "asked Ada to take the relay
 * while Bruno finishes". Colouring those names is what turns reading it from
 * parsing into scanning, and the two things worth holding still are that the
 * colour lands on the name and nowhere else, and that a code fence keeps its
 * ink whatever the text inside it happens to say.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { Prose } from '../src/ui/kit';
import { tintFor } from '../src/theme';

const team = [
  { persona: 'Ada', color: 'violet' },
  { persona: 'Bruno', color: 'amber' },
];

async function mount(markdown: string) {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(<Prose mentions={team}>{markdown}</Prose>);
  });
  return tree!;
}

/**
 * Every text node wearing one of the team's colours. Matched against the
 * palette rather than "has a colour at all", because a fence brings chrome of
 * its own and this test is about the names.
 */
const teamColors = team.map(m => tintFor(m.color, false));

function tinted(
  tree: ReturnType<typeof create>,
): { text: string; color: unknown }[] {
  return tree.root
    .findAllByType(Text)
    .map(node => ({
      text: String(node.props?.children ?? ''),
      style: node.props?.style,
    }))
    .filter(
      (node): node is { text: string; style: { color: string } } =>
        !!node.style &&
        !Array.isArray(node.style) &&
        typeof node.style === 'object' &&
        teamColors.includes((node.style as { color?: string }).color ?? ''),
    )
    .map(node => ({ text: node.text, color: node.style.color }));
}

it('tints a name in prose and leaves the words around it alone', async () => {
  const tree = await mount('Asked Ada to take the relay while Bruno finishes.');

  expect(tinted(tree)).toEqual([
    { text: 'Ada', color: tintFor('violet', false) },
    { text: 'Bruno', color: tintFor('amber', false) },
  ]);
});

it('leaves a word that merely starts with a name alone', async () => {
  const tree = await mount('The Adapter is fine.');

  expect(tinted(tree)).toEqual([]);
});

it('leaves code and links in their own ink', async () => {
  // Inside a fence a name is an identifier; inside a link it is the link's own
  // words. Neither is the agent talking about a colleague.
  expect(tinted(await mount('```\nvar Ada = new Adapter();\n```'))).toEqual([]);
  expect(tinted(await mount('Ask `Ada` about it.'))).toEqual([]);
  expect(tinted(await mount('Read [Ada](https://example.com/Ada).'))).toEqual(
    [],
  );
});

it('does no work at all when the session has no partners', async () => {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(<Prose>Ada did it.</Prose>);
  });

  expect(tinted(tree!)).toEqual([]);
});
