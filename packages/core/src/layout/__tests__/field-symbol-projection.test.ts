// The SYMBOL field paints from its instruction (§17.16.5.60).
//
// Real files carry NO cached result for SYMBOL — Word always renders from the instruction —
// so layout synthesizes the glyph over the field's single reserved model unit. Every hostile
// instruction falls back to the previous behavior (cached text or nothing), never a throw.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { piecesOfParagraph } from '../field-projection.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function partOf(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphOf(body: string): OoxmlNode {
  const find = (node: OoxmlNode): OoxmlNode | undefined => {
    if (node.kind === 'paragraph') return node;
    if (node.kind === 'textValue') return undefined;
    for (const child of node.children ?? []) {
      const hit = find(child);
      if (hit) return hit;
    }
    return undefined;
  };
  const paragraph = find(partOf(body).root);
  if (!paragraph) throw new Error('no paragraph');
  return paragraph;
}

function project(body: string, mode: RevisionDisplayMode = 'all-markup') {
  return piecesOfParagraph(paragraphOf(body), [], undefined, undefined, undefined, undefined, mode);
}

/** A complete complex field around one instruction, with an optional cached result. */
function complexField(instr: string, result = '', chromeRpr = ''): string {
  return (
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r>${chromeRpr}<w:instrText>${instr}</w:instrText></w:r>` +
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="separate"/></w:r>` +
    result +
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="end"/></w:r>`
  );
}

describe('a complex SYMBOL field', () => {
  test('paints the mapped glyph over one atom unit with the \\f family', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        complexField(' SYMBOL 0xF0FC \\f "Wingdings" ') +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', '✔', 'B']);
    const glyph = pieces[1]!;
    expect(glyph).toMatchObject({ start: 1, end: 2, projected: true });
    expect(glyph.style.fontFamily).toBe('Wingdings');
    expect(glyph.fieldAtom).toEqual({ formField: false });
    expect(pieces[2]).toMatchObject({ start: 2, end: 3 });
  });

  test('a decimal code on a symbol font normalizes onto the 0xF000 page', () => {
    const pieces = project(`<w:p>${complexField(' SYMBOL 183 \\f "Symbol" ')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['•']);
  });

  test('\\u renders the codepoint directly and \\s sets whole points', () => {
    const pieces = project(`<w:p>${complexField(' SYMBOL 8226 \\u \\s 24 ')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['•']);
    expect(pieces[0]!.style.fontSizePt).toBe(24);
  });

  test('an unquoted \\f token works', () => {
    const pieces = project(`<w:p>${complexField(' SYMBOL 0xF06C \\f Wingdings ')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['●']);
    expect(pieces[0]!.style.fontFamily).toBe('Wingdings');
  });

  test('the instruction wins over a stale cached result', () => {
    const pieces = project(
      `<w:p>${complexField(' SYMBOL 0xF0FC \\f "Wingdings" ', '<w:r><w:t>OLD</w:t></w:r>')}</w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['✔']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
  });

  test('the begin/instr/end shape without separate still paints', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> SYMBOL 0xF0FC \\f "Wingdings" </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', '✔', 'B']);
    expect(pieces[1]).toMatchObject({ start: 1, end: 2, projected: true });
  });

  test('hidden chrome runs paint nothing but keep the unit', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        complexField(' SYMBOL 0xF0FC \\f "Wingdings" ', '', '<w:rPr><w:vanish/></w:rPr>') +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'B']);
    expect(pieces[1]).toMatchObject({ start: 2, end: 3 });
  });

  test('a tracked-deleted SYMBOL is gone from the proposed result', () => {
    const pieces = project(
      `<w:p><w:del w:id="1" w:author="A">${complexField(' SYMBOL 0xF0FC \\f "Wingdings" ')}</w:del></w:p>`,
      'proposed'
    );
    expect(pieces.map((piece) => piece.text)).toEqual([]);
  });

  test('hostile instructions stay inert without throwing', () => {
    for (const instr of [
      ' SYMBOL 999999999999 ',
      ' SYMBOL 0xD800 ',
      ' SYMBOL 0xFFFC ',
      ' SYMBOL ',
    ]) {
      // Previous behavior: the cached result paints; the instruction never does.
      const pieces = project(`<w:p>${complexField(instr, '<w:r><w:t>cached</w:t></w:r>')}</w:p>`);
      expect(pieces.map((piece) => piece.text)).toEqual(['cached']);
      // And with an empty result the unit stays empty.
      const empty = project(`<w:p>${complexField(instr)}<w:r><w:t>B</w:t></w:r></w:p>`);
      expect(empty.map((piece) => piece.text)).toEqual(['B']);
      expect(empty[0]).toMatchObject({ start: 1, end: 2 });
    }
  });

  test('garbage switches never fail the parse', () => {
    const pieces = project(`<w:p>${complexField(' SYMBOL 65 \\zz \\h \\j "stray" ')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['A']);
  });
});

describe('a simple SYMBOL field', () => {
  test('paints the glyph over its reserved unit', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        '<w:fldSimple w:instr=" SYMBOL 0xF0FC \\f &quot;Wingdings&quot; "/>' +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', '✔', 'B']);
    const glyph = pieces[1]!;
    expect(glyph).toMatchObject({ start: 1, end: 2, projected: true });
    expect(glyph.style.fontFamily).toBe('Wingdings');
    expect(glyph.fieldAtom).toEqual({ formField: false });
  });

  test('the instruction wins over the cached result', () => {
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" SYMBOL 183 \\f Symbol ">' +
        '<w:r><w:t>OLD</w:t></w:r></w:fldSimple></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['•']);
  });

  test('a hostile instruction falls back to the cached result', () => {
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" SYMBOL 0xD800 ">' +
        '<w:r><w:t>cached</w:t></w:r></w:fldSimple></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['cached']);
  });
});
