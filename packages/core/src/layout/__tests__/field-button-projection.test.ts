// MACROBUTTON / GOTOBUTTON fields display everything after their first argument.
//
// Word paints the display text and real files carry no cached result for these fields, so
// without synthesis they paint nothing. The macro / jump target is never executed, resolved,
// or navigated — display only. A cached result, when a file does carry one, wins: it is what
// Word last painted.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { piecesOfParagraph, type HyperlinkProjector } from '../field-projection.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';
import type { SpanLinkRecord } from '../semantic-records.ts';

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

function project(
  body: string,
  mode: RevisionDisplayMode = 'all-markup',
  projectLink?: HyperlinkProjector
) {
  return piecesOfParagraph(
    paragraphOf(body),
    [],
    undefined,
    undefined,
    projectLink,
    undefined,
    mode
  );
}

/** A complex field around one instruction: begin/instr[/separate + result]/end. */
function complexField(instr: string, result?: string, chromeRpr = ''): string {
  const middle =
    result === undefined
      ? ''
      : `<w:r>${chromeRpr}<w:fldChar w:fldCharType="separate"/></w:r>` + result;
  return (
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r>${chromeRpr}<w:instrText>${instr}</w:instrText></w:r>` +
    middle +
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="end"/></w:r>`
  );
}

describe('a complex MACROBUTTON field', () => {
  test('the no-separate shape paints the display text over one atom unit', () => {
    const pieces = project(
      `<w:p><w:r><w:t>A</w:t></w:r>${complexField(' MACROBUTTON DoThing Click Here ')}<w:r><w:t>B</w:t></w:r></w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'Click Here', 'B']);
    const button = pieces[1]!;
    expect(button).toMatchObject({ start: 1, end: 2, projected: true });
    expect(button.fieldAtom).toEqual({ formField: false });
    expect(pieces[2]).toMatchObject({ start: 2, end: 3 });
  });

  test('with a separate and a cached result, the cache wins', () => {
    const pieces = project(
      `<w:p>${complexField(' MACROBUTTON DoThing Click Here ', '<w:r><w:t>Cached</w:t></w:r>')}</w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Cached']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
  });

  test('with a separate and an EMPTY result, the display text fills in', () => {
    const pieces = project(
      `<w:p>${complexField(' GOTOBUTTON bookmark3 Go to section 3 ', '')}</w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Go to section 3']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
  });

  test('hidden chrome paints nothing but keeps the unit', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        complexField(' MACROBUTTON M Click ', undefined, '<w:rPr><w:vanish/></w:rPr>') +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'B']);
    expect(pieces[1]).toMatchObject({ start: 2, end: 3 });
  });

  test('a tracked-deleted button is gone from the proposed result', () => {
    const pieces = project(
      `<w:p><w:del w:id="1" w:author="A">${complexField(' MACROBUTTON M Click ')}</w:del></w:p>`,
      'proposed'
    );
    expect(pieces.map((piece) => piece.text)).toEqual([]);
  });

  test('an enclosing w:hyperlink carries its link onto the display text', () => {
    const link: SpanLinkRecord = Object.freeze({
      id: 'enclosing',
      kind: 'external' as const,
      href: 'https://enclosing.example',
    });
    const pieces = project(
      `<w:p><w:hyperlink w:anchor="a">${complexField(' MACROBUTTON M Click ')}</w:hyperlink></w:p>`,
      'all-markup',
      () => link
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Click']);
    expect(pieces[0]!.link).toBe(link);
  });
});

describe('a simple MACROBUTTON / GOTOBUTTON field', () => {
  test('empty children paint the display text over one model unit', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        '<w:fldSimple w:instr=" MACROBUTTON DoThing Click Here "></w:fldSimple>' +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'Click Here', 'B']);
    const button = pieces[1]!;
    expect(button).toMatchObject({ start: 1, end: 2, projected: true });
    expect(button.fieldAtom).toEqual({ formField: false });
  });

  test('GOTOBUTTON paints the same way and never navigates — no link record', () => {
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" GOTOBUTTON bookmark3 Go there "></w:fldSimple></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Go there']);
    expect(pieces[0]!.link).toBeUndefined();
  });

  test('a cached child run wins over the synthesized display', () => {
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" MACROBUTTON M Click "><w:r><w:t>Cached</w:t></w:r></w:fldSimple></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Cached']);
  });

  test('a tracked-deleted simple button is gone from the proposed result', () => {
    const pieces = project(
      '<w:p><w:del w:id="1" w:author="A">' +
        '<w:fldSimple w:instr=" MACROBUTTON M Click "></w:fldSimple></w:del></w:p>',
      'proposed'
    );
    expect(pieces.map((piece) => piece.text)).toEqual([]);
  });
});
