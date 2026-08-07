// `w:fldSimple` paints its cached result.
//
// The simple field (§17.16.19) keeps its instruction in `@w:instr` and its last-computed result
// as child runs — there is no `separate` marker, so none of the complex-field machine applies to
// it. Layout used to advance one model unit past the element and emit nothing, which kept every
// offset correct and painted the result as blank. A document that writes its cross-references
// this way showed empty space where Word shows text.
//
// The single model unit is the part that must not move: it is what keeps `paragraphTextOf`,
// selection and the caret agreeing that a field is one thing.

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

const SIMPLE =
  '<w:p><w:r><w:t>A</w:t></w:r>' +
  '<w:fldSimple w:instr=" REF _Ref1 \\h "><w:r><w:t>Section 3</w:t></w:r></w:fldSimple>' +
  '<w:r><w:t>B</w:t></w:r></w:p>';

describe('a simple field', () => {
  test('paints its cached result', () => {
    expect(project(SIMPLE).map((piece) => piece.text)).toEqual(['A', 'Section 3', 'B']);
  });

  test('occupies exactly one model unit, however long the result', () => {
    const pieces = project(SIMPLE);
    const field = pieces.find((piece) => piece.text === 'Section 3')!;
    expect(field.start).toBe(1);
    expect(field.end).toBe(2);
    expect(field.projected).toBe(true);
    // The run after it must still start where it did when the field painted nothing.
    expect(pieces.find((piece) => piece.text === 'B')).toMatchObject({ start: 2, end: 3 });
  });

  test('an empty result still occupies its unit', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r><w:fldSimple w:instr=" REF x "/><w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'B']);
    expect(pieces[1]).toMatchObject({ start: 2, end: 3 });
  });

  test('the instruction is never displayed', () => {
    // `@w:instr` is the field's CODE. Painting it would put ` REF _Ref1 \h ` on the page, and
    // instructions are attacker-controlled.
    expect(
      project(SIMPLE)
        .map((piece) => piece.text)
        .join('')
    ).not.toContain('REF');
  });

  test('a nested field inside the result contributes no chrome', () => {
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" REF a ">' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>7</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '</w:fldSimple></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['7']);
  });

  test('a hidden result paints nothing but keeps its unit', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        '<w:fldSimple w:instr=" REF x "><w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden</w:t></w:r></w:fldSimple>' +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'B']);
    expect(pieces[1]).toMatchObject({ start: 2, end: 3 });
  });
});

describe('a tracked simple field', () => {
  const inserted =
    '<w:p><w:ins w:id="1" w:author="Author" w:date="2026-07-07T20:18:00Z">' +
    '<w:fldSimple w:instr=" REF _Ref1 \\h "><w:r><w:t>Section 9</w:t></w:r></w:fldSimple>' +
    '</w:ins></w:p>';

  test('carries the attribution of the revision around it', () => {
    const piece = project(inserted).find((candidate) => candidate.text === 'Section 9');
    expect(piece?.revisions?.map((revision) => revision.kind)).toEqual(['insert']);
  });

  test('is absent from the original view', () => {
    expect(project(inserted, 'original').map((piece) => piece.text)).toEqual([]);
  });
});
