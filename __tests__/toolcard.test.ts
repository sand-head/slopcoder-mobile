/**
 * The app's tool cards must be the cockpit's tool cards.
 *
 * `fixtures/tool-cards.json` is a byte-identical copy of the file slopcoder's
 * own suite replays against `ToolCards.Build` (see
 * `tests/SlopCoder.Web.Tests/ToolCardTests.cs`). Nothing mechanically proves the
 * two *copies* stay identical — this repo cannot reach the private one — but
 * each side proving itself against the same cases is what stops the C# and the
 * TypeScript drifting into two different ideas of what an edit looks like.
 *
 * When the C# side changes intentionally: regenerate there with
 * `TOOLCARDS_REGENERATE=1 dotnet test --filter ToolCardTests`, copy the file
 * over, and this suite says exactly which cards moved.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildProposalCard,
  buildToolCard,
  humanize,
  lineDiff,
  parseUnifiedDiff,
  type ToolBlock,
  type ToolCard,
} from '../src/api/toolcard';

interface Fixture {
  name: string;
  tool: string;
  input: unknown;
  raw?: boolean;
  result: string | null;
  isError?: boolean;
  expected: unknown;
}

const fixtures: Fixture[] = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'tool-cards.json'), 'utf8'),
);

/**
 * The card as plain JSON, in the shape `ToolCardTests.Describe` emits. Written
 * by hand on both sides rather than serialized, so neither language's defaults
 * leak into the contract.
 */
function describe_(card: ToolCard): unknown {
  return {
    verb: card.verb,
    subject: card.subject,
    subjectStyle: card.subjectStyle,
    facets: card.facets,
    blocks: card.blocks.map(describeBlock),
    // Written only when true, matching the C# encoder: an absent key is false.
    ...(card.bare ? { bare: true } : null),
  };
}

function describeBlock(block: ToolBlock): unknown {
  const head = { type: block.type, label: block.label, open: block.open };
  switch (block.type) {
    case 'text':
      return { ...head, tone: block.tone, text: block.text };
    case 'code':
      return { ...head, language: block.language, text: block.text };
    case 'diff':
      return {
        ...head,
        lines: block.lines.map(l => [l.kind, l.text, l.oldNumber, l.newNumber]),
      };
    case 'list':
      return { ...head, entries: block.entries.map(e => [e.text, e.detail]) };
    case 'pairs':
      return { ...head, pairs: block.pairs.map(p => [p.key, p.value]) };
    case 'artifact':
      return { ...head, name: block.name, kind: block.kind, size: block.size, artifactId: block.artifactId };
  }
}

function buildFrom(fixture: Fixture): ToolCard {
  return buildToolCard(
    fixture.tool,
    // "raw" fixtures carry a string that is not JSON, which is the point of them.
    fixture.raw === true ? (fixture.input as string) : JSON.stringify(fixture.input),
    fixture.result,
    fixture.isError === true,
  );
}

describe('tool cards match the server fixtures', () => {
  it.each(fixtures.map(f => [f.name, f] as const))('%s', (_name, fixture) => {
    expect(describe_(buildFrom(fixture))).toEqual(fixture.expected);
  });

  it('covers every fixture in the file', () => {
    expect(fixtures.length).toBeGreaterThan(40);
  });
});

describe('the pieces the fixtures cannot pin', () => {
  it('numbers a whole-file diff and leaves a fragment unnumbered', () => {
    const whole = lineDiff('a\nb', 'a\nB');
    expect(whole.map(l => [l.kind, l.oldNumber, l.newNumber])).toEqual([
      ['context', 1, 1],
      ['remove', 2, null],
      ['add', null, 2],
    ]);

    expect(lineDiff('a\nb', 'a\nB', false).every(l => l.oldNumber === null && l.newNumber === null)).toBe(
      true,
    );
  });

  it('elides unchanged runs and says how many it dropped', () => {
    const before = ['x', ...Array.from({ length: 20 }, (_, i) => `line ${i}`)].join('\n');
    const after = ['y', ...Array.from({ length: 20 }, (_, i) => `line ${i}`)].join('\n');

    const lines = lineDiff(before, after);
    expect(lines.filter(l => l.kind === 'hunk').map(l => l.text)).toEqual(['17 unchanged lines']);
    expect(lines).toHaveLength(6);
  });

  it('reads line numbers out of a unified hunk header', () => {
    const lines = parseUnifiedDiff('@@ -10,3 +20,4 @@\n keep\n-gone\n+new');
    expect(lines.map(l => [l.kind, l.oldNumber, l.newNumber])).toEqual([
      ['hunk', null, null],
      ['context', 10, 20],
      ['remove', 11, null],
      ['add', null, 21],
    ]);
  });

  it('opens everything on a proposal and lifts the command out of the header', () => {
    const card = buildProposalCard('run_bash', JSON.stringify({ command: 'rm -rf build' }));
    expect(card.blocks.every(b => b.open)).toBe(true);
    expect(card.blocks[0]).toMatchObject({ type: 'code', label: 'command', text: 'rm -rf build' });
  });

  /**
   * Claude Code says what each command is for. That sentence is the header;
   * the command it describes is the first thing behind the chevron, and the
   * millisecond timeout is nowhere.
   */
  it('heads a described Claude Code command with its description', () => {
    const input = JSON.stringify({
      command: 'cd /repo; sed -n 1,130p src/Harness.cs',
      description: 'Check StartProcessAsync signatures',
      timeout: 120000,
    });
    const card = buildToolCard('Bash', input, 'exit code: 0\nok', false);
    expect(card).toMatchObject({
      verb: 'Bash',
      title: 'Check StartProcessAsync signatures',
      subjectStyle: 'command',
      facets: ['exit 0'],
    });
    expect(card.blocks[0]).toMatchObject({ type: 'code', label: 'command', open: false, text: 'cd /repo; sed -n 1,130p src/Harness.cs' });
    expect(card.blocks[1]).toMatchObject({ type: 'code', label: 'output', text: 'ok' });

    // Gated, it is the same one command block, opened — not two.
    const proposal = buildProposalCard('PowerShell', input);
    expect(proposal.title).toBe('Check StartProcessAsync signatures');
    expect(proposal.blocks.filter(b => b.type === 'code' && b.label === 'command')).toHaveLength(1);
    expect(proposal.blocks.every(b => b.open)).toBe(true);
  });

  it('keeps an undescribed command in the header', () => {
    const card = buildToolCard('Bash', JSON.stringify({ command: 'ls', run_in_background: true }), null, false);
    expect(card.title).toBeUndefined();
    expect(card).toMatchObject({ verb: 'Bash', subject: 'ls', facets: ['background'], blocks: [] });
  });

  it('opens an edit proposal on its diff', () => {
    const card = buildProposalCard(
      'edit_file',
      JSON.stringify({ path: 'a.ts', old_str: 'let x', new_str: 'const x' }),
    );
    expect(card.blocks[0]).toMatchObject({ type: 'diff', open: true });
  });

  it.each([
    ['get_weather', 'Get weather'],
    ['skill', 'Skill'],
    ['a__b', 'A b'],
  ])('humanizes %s', (input, want) => {
    expect(humanize(input)).toBe(want);
  });

  it('never throws, whatever the input', () => {
    for (const input of ['{not json', '', 'null', '[1,2,3]', '"a string"', '{"a":{"b":[1]}}'])
      expect(() => buildToolCard('anything', input, 'ok', false)).not.toThrow();
  });
});
