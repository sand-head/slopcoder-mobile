/**
 * A file read, opened from the transcript.
 *
 * What holds still: a read stays one line until tapped; the tap shows a
 * capped preview, never the whole file in the list; the preview opens a
 * sheet titled with the path holding exactly the text the read returned,
 * selectable; Claude Code's own `Read` gets the same card; and an image read
 * says plainly that the image was not kept rather than showing a placeholder
 * as if it were code.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { buildToolCard, imageRead } from '../src/api/toolcard';
import { PREVIEW_CHARS, PREVIEW_LINES, previewOf } from '../src/ui/FilePeek';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

import { ToolCard } from '../src/ui/ToolCard';

const FILE = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');

function texts(tree: ReturnType<typeof create>): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string') return void parts.push(node);
    if (Array.isArray(node)) return void node.forEach(walk);
    (node as { children?: unknown[] }).children?.forEach(walk);
  };
  walk(tree.toJSON());
  return parts.join('\n');
}

describe('the card', () => {
  it('carries the read for the sheet, path and chips included', () => {
    const card = buildToolCard('read_file', JSON.stringify({ path: 'src/app.ts', offset: 5 }), FILE + '\n', false);
    expect(card.verb).toBe('Read');
    expect(card.peek).toEqual({ path: 'src/app.ts', text: FILE, facets: ['40 lines', 'from 5'] });
    // The code block is still there, closed, for anything that reads blocks.
    expect(card.blocks).toEqual([expect.objectContaining({ type: 'code', open: false, text: FILE })]);
  });

  it("maps Claude Code's Read (file_path) onto the same card", () => {
    const card = buildToolCard('Read', JSON.stringify({ file_path: '/workspace/repo/README.md' }), '     1\t# Title', false);
    expect(card.verb).toBe('Read');
    expect(card.subject).toBe('/workspace/repo/README.md');
    expect(card.subjectStyle).toBe('path');
    expect(card.peek?.text).toBe('     1\t# Title');
  });

  it('has no peek for a failed read, and shows the failure', () => {
    const card = buildToolCard('read_file', JSON.stringify({ path: 'gone.ts' }), 'Error: file not found: gone.ts', true);
    expect(card.peek).toBeUndefined();
    expect(card.blocks).toEqual([expect.objectContaining({ type: 'text', tone: 'error', open: true })]);
  });

  it('says an image read was not kept, rather than showing its placeholder as code', () => {
    const result = '[read_file: shots/home.png — image/png, 182 KB]';
    expect(imageRead(result)).toEqual({ mediaType: 'image/png', size: '182 KB' });
    const card = buildToolCard('read_file', JSON.stringify({ path: 'shots/home.png' }), result, false);
    expect(card.peek).toBeUndefined();
    expect(card.facets).toEqual(['image/png']);
    expect(card.blocks).toHaveLength(1);
    expect(card.blocks[0]).toMatchObject({ type: 'text', tone: 'muted' });
    expect((card.blocks[0] as { text: string }).text).toContain('not kept');
  });

  it('does not mistake a text file that mentions read_file for an image read', () => {
    expect(imageRead('[read_file: notes.md is 900 lines — over the read cap.]')).toBeNull();
    expect(imageRead('ordinary text')).toBeNull();
  });
});

describe('the preview', () => {
  it('caps lines', () => {
    const preview = previewOf(FILE);
    expect(preview.cut).toBe(true);
    expect(preview.text.split('\n')).toHaveLength(PREVIEW_LINES);
  });

  it('caps characters, for files of very long lines', () => {
    const preview = previewOf('x'.repeat(PREVIEW_CHARS * 3));
    expect(preview.cut).toBe(true);
    expect(preview.text).toHaveLength(PREVIEW_CHARS);
  });

  it('is the whole text when the read is short', () => {
    expect(previewOf('a\nb')).toEqual({ text: 'a\nb', cut: false });
  });
});

describe('in the transcript', () => {
  async function mount() {
    const card = buildToolCard('read_file', JSON.stringify({ path: 'src/app.ts' }), FILE, false);
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<ToolCard card={card} state="ok" />);
    });
    return tree!;
  }

  it('is one line until tapped', async () => {
    const tree = await mount();
    expect(texts(tree)).not.toContain('line 1\n');
    expect(tree.root.findAllByProps({ testID: 'file-peek-preview' })).toHaveLength(0);
  });

  it('shows a capped preview on a tap, and the whole read in a sheet titled with the path', async () => {
    const tree = await mount();
    const head = tree.root.find(node => node.props.accessibilityLabel === 'Read src/app.ts' && node.props.onPress);
    await act(async () => head.props.onPress());

    const preview = tree.root.findByProps({ testID: 'file-peek-preview' });
    // One clipped row per source line: wrapping let two long lines eat the preview on a phone.
    const rows = preview.findAll(node => node.props.numberOfLines === 1 && node.props.ellipsizeMode === 'clip' && typeof node.type !== 'string');
    expect(rows).toHaveLength(12);
    const shown = texts(tree);
    expect(shown).toContain('line 12');
    expect(shown).not.toContain('line 13');
    expect(shown).toContain('open all 40 lines');
    expect(tree.root.findAllByProps({ testID: 'file-peek-text' })).toHaveLength(0);

    await act(async () => preview.props.onPress());
    const sheet = tree.root.find(node => node.props.title === 'src/app.ts' && node.props.visible === true);
    expect(sheet).toBeDefined();
    const body = tree.root.find(node => node.props.testID === 'file-peek-text' && typeof node.type !== 'string');
    expect(body.props.children).toBe(FILE);
    expect(body.props.selectable).toBe(true);

    // Closing the sheet unmounts it: a long run carries no sheets.
    await act(async () => sheet.props.onClose());
    expect(tree.root.findAllByProps({ testID: 'file-peek-text' })).toHaveLength(0);
  });
});
