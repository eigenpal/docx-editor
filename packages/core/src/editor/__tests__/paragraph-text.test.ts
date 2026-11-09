import { afterEach, describe, expect, test } from 'bun:test';
import { docx } from './paginated-surface-fixtures.ts';
import { mountAnchorEditor } from './scroll-to-anchor-fixture.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`;
const byReviewer = 'w:author="Reviewer" w:date="2026-10-07T00:00:00Z"';

function mount(body: string) {
  const mounted = mountAnchorEditor(docx(body));
  cleanups.push(mounted.destroy);
  return mounted.editor;
}

function blockOf(editor: ReturnType<typeof mount>, word: string): string {
  const [match] = editor.findMatches(word);
  if (!match) throw new Error(`no ${word}`);
  return match.blockId;
}

describe('getParagraphText', () => {
  test('returns the text in the offsets setHighlights takes', () => {
    const editor = mount(
      p(
        run('Page '),
        '<w:fldSimple w:instr="PAGE">' + run('1') + '</w:fldSimple>',
        run(' 😀 recieve')
      )
    );
    const paragraph = editor.getParagraphText(blockOf(editor, 'recieve'))!;
    const start = paragraph.text.indexOf('recieve');

    expect(
      editor.setHighlights('spelling', [
        { blockId: paragraph.blockId, start, length: 7, expectedText: 'recieve' },
      ])
    ).toEqual({ applied: 1, unavailable: 0 });
  });

  test('reports tracked deletions as spans of the text', () => {
    const editor = mount(
      p(
        run('Keep '),
        `<w:del w:id="1" ${byReviewer}><w:r><w:delText xml:space="preserve">teh </w:delText></w:r></w:del>`,
        run('notes')
      )
    );

    expect(editor.getParagraphText(blockOf(editor, 'notes'))).toEqual({
      blockId: blockOf(editor, 'notes'),
      text: 'Keep teh notes',
      deletions: [{ start: 5, length: 4 }],
    });
  });

  test('returns no deletions for a paragraph without tracked deletions', () => {
    const editor = mount(p(run('Plain text')));

    expect(editor.getParagraphText(blockOf(editor, 'Plain'))?.deletions).toEqual([]);
  });

  test('returns null for an id the document does not hold', () => {
    const editor = mount(p(run('Plain text')));

    expect(editor.getParagraphText('/word/document.xml#0.0.999')).toBeNull();
  });
});

describe('getPaintedParagraphs', () => {
  const lines = Array.from({ length: 400 }, (_, index) => p(run(`Line ${index}.`))).join('');

  test('returns the paragraphs on the painted pages, in order', () => {
    const editor = mount(lines);

    const texts = editor.getPaintedParagraphs().map((paragraph) => paragraph.text);

    expect(texts[0]).toBe('Line 0.');
    expect(texts).not.toContain('Line 399.');
    expect(texts).toEqual(
      [...texts].sort((a, b) => Number(a.slice(5, -1)) - Number(b.slice(5, -1)))
    );
  });

  test('includes a page once it is painted', () => {
    const editor = mount(lines);

    editor.scrollToBlock(blockOf(editor, 'Line 399.'));

    expect(editor.getPaintedParagraphs().map((paragraph) => paragraph.text)).toContain('Line 399.');
  });
});
