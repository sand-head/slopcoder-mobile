import { splitMentions } from '../src/api/mentions';
import { tintFor, tintNames } from '../src/theme';

/**
 * A partner's name is the only thread tying a sentence of the agent's prose to
 * the cards around it, so it gets their colour wherever it appears. The rules
 * here are the cockpit's, deliberately: each of them is a way to get this
 * visibly wrong, and they were worked out once already.
 */
const team = [
  { persona: 'Ada', color: 'violet' },
  { persona: 'Bruno', color: 'amber' },
];

const tinted = (text: string) =>
  splitMentions(text, team)
    .filter(run => run.color !== null)
    .map(run => run.text);

const rejoin = (text: string) =>
  splitMentions(text, team)
    .map(run => run.text)
    .join('');

test('a name in prose becomes its own run, in that partner colour', () => {
  const runs = splitMentions(
    'Asked Ada to take the relay while Bruno finishes.',
    team,
  );

  expect(runs.filter(r => r.color !== null)).toEqual([
    { text: 'Ada', color: 'violet' },
    { text: 'Bruno', color: 'amber' },
  ]);
});

test('a word that merely starts with a name is left alone', () => {
  // Adapter is the one that would have burned us: a substring match tints half
  // a word and the reader sees a rendering bug.
  expect(tinted('The Adapter is fine.')).toEqual([]);
  // A hyphen and an apostrophe are not word characters, so those do match.
  expect(tinted('Ada-ish, and Ada’s too')).toEqual(['Ada', 'Ada']);
});

test('matching ignores case but the run carries the text as written', () => {
  expect(tinted('ada says so')).toEqual(['ada']);
});

test('a longer name wins over one that shares its prefix', () => {
  const runs = splitMentions('Ada II reported.', [
    { persona: 'Ada', color: 'violet' },
    { persona: 'Ada II', color: 'sky' },
  ]);

  expect(runs.filter(r => r.color !== null)).toEqual([
    { text: 'Ada II', color: 'sky' },
  ]);
});

test('the runs always rejoin into exactly the text that went in', () => {
  for (const text of [
    '',
    'Ada',
    'Ada and Bruno',
    'nobody here',
    'AdaAdaAda',
    '  Ada  ',
    'Ada, Bruno, Ada.',
  ]) {
    expect(rejoin(text)).toBe(text);
  }
});

test('an empty team leaves the text in one plain run', () => {
  expect(splitMentions('Ada did it.', [])).toEqual([
    { text: 'Ada did it.', color: null },
  ]);
});

test('a partner with no colour is not tinted', () => {
  // A sub-session from before tints: it still has a name, and the prose must
  // not half-highlight it.
  expect(splitMentions('Ada did it.', [{ persona: 'Ada', color: '' }])).toEqual(
    [{ text: 'Ada did it.', color: null }],
  );
});

test('every palette name the server can send resolves to a colour', () => {
  for (const name of tintNames) {
    expect(tintFor(name, false)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tintFor(name, true)).toMatch(/^#[0-9a-f]{6}$/i);
    // Light and dark are different shades of the same idea, never the same hex.
    expect(tintFor(name, false)).not.toBe(tintFor(name, true));
  }
  // Emerald and amber already mean ok and running; a partner must not wear them.
  expect(tintNames).not.toContain('emerald');
  expect(tintFor('teal-ish', false)).toBeNull();
  expect(tintFor('', false)).toBeNull();
  expect(tintFor(undefined, false)).toBeNull();
});
