// FORMCHECKBOX / FORMDROPDOWN legacy form fields render from their `w:ffData` state.
//
// The checkbox state is the authority — Word paints ☐/☒ from `w:checked`, never from a stale
// cached glyph. The dropdown prefers its cached result (what Word last painted) and falls back
// to the selected `w:listEntry` only when the cache is empty. Everything hostile or malformed
// falls back to the previous behavior (cached text or nothing), never a throw.

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

/** FORMCHECKBOX the way Word writes it: begin(ffData)/instr/end, NO separate. */
function checkboxField(checkBoxInner: string, chromeRpr = ''): string {
  return (
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="begin">` +
    `<w:ffData><w:name w:val="Check1"/><w:enabled/><w:calcOnExit w:val="0"/>` +
    `<w:checkBox>${checkBoxInner}</w:checkBox></w:ffData>` +
    `</w:fldChar></w:r>` +
    `<w:r>${chromeRpr}<w:instrText> FORMCHECKBOX </w:instrText></w:r>` +
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="end"/></w:r>`
  );
}

/** FORMDROPDOWN the way Word writes it: begin(ffData)/instr/separate/result/end. */
function dropdownField(ddListInner: string, result = ''): string {
  return (
    `<w:r><w:fldChar w:fldCharType="begin">` +
    `<w:ffData><w:name w:val="Dropdown1"/><w:ddList>${ddListInner}</w:ddList></w:ffData>` +
    `</w:fldChar></w:r>` +
    `<w:r><w:instrText> FORMDROPDOWN </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    result +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>`
  );
}

const ENTRIES = '<w:listEntry w:val="Red"/><w:listEntry w:val="Green"/><w:listEntry w:val="Blue"/>';

describe('a FORMCHECKBOX field', () => {
  test('the no-separate shape paints an unchecked box over one atom unit', () => {
    const pieces = project(
      `<w:p><w:r><w:t>A</w:t></w:r>${checkboxField('<w:sizeAuto/>')}<w:r><w:t>B</w:t></w:r></w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', '☐', 'B']);
    const box = pieces[1]!;
    expect(box).toMatchObject({ start: 1, end: 2, projected: true });
    expect(box.fieldAtom).toEqual({ formField: true });
    expect(pieces[2]).toMatchObject({ start: 2, end: 3 });
  });

  test('w:checked paints the checked box', () => {
    const pieces = project(`<w:p>${checkboxField('<w:checked/><w:sizeAuto/>')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['☒']);
  });

  test('w:default is the fallback when w:checked is absent', () => {
    const pieces = project(`<w:p>${checkboxField('<w:default w:val="1"/><w:sizeAuto/>')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['☒']);
  });

  test('an explicit w:size of 24 half-points paints at 12pt', () => {
    const pieces = project(`<w:p>${checkboxField('<w:size w:val="24"/>')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['☐']);
    expect(pieces[0]!.style.fontSizePt).toBe(12);
  });

  test('the ffData state wins over a stale cached result', () => {
    const pieces = project(
      '<w:p>' +
        `<w:r><w:fldChar w:fldCharType="begin">` +
        `<w:ffData><w:checkBox><w:checked/></w:checkBox></w:ffData>` +
        `</w:fldChar></w:r>` +
        `<w:r><w:instrText> FORMCHECKBOX </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>OLD</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        '</w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['☒']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
  });

  test('hidden chrome paints nothing but keeps the unit', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        checkboxField('<w:checked/>', '<w:rPr><w:vanish/></w:rPr>') +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'B']);
    expect(pieces[1]).toMatchObject({ start: 2, end: 3 });
  });

  test('a tracked-deleted checkbox is gone from the proposed result', () => {
    const pieces = project(
      `<w:p><w:del w:id="1" w:author="A">${checkboxField('<w:checked/>')}</w:del></w:p>`,
      'proposed'
    );
    expect(pieces.map((piece) => piece.text)).toEqual([]);
  });

  test('the instruction without ffData paints nothing (fail closed)', () => {
    const pieces = project(
      '<w:p>' +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText> FORMCHECKBOX </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['B']);
    expect(pieces[0]).toMatchObject({ start: 1, end: 2 });
  });
});

describe('a FORMDROPDOWN field', () => {
  test('a non-empty cached result wins — it is what Word last painted', () => {
    const pieces = project(
      `<w:p>${dropdownField(`<w:result w:val="1"/>${ENTRIES}`, '<w:r><w:t>Cached</w:t></w:r>')}</w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Cached']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
    expect(pieces[0]!.fieldAtom).toEqual({ formField: true });
  });

  test('an empty cached result synthesizes the selected entry', () => {
    const pieces = project(
      `<w:p><w:r><w:t>A</w:t></w:r>${dropdownField(`<w:result w:val="1"/>${ENTRIES}`)}</w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'Green']);
    const entry = pieces[1]!;
    expect(entry).toMatchObject({ start: 1, end: 2, projected: true });
    expect(entry.fieldAtom).toEqual({ formField: true });
  });

  test('an out-of-range result falls back to default, then to the first entry', () => {
    const viaDefault = project(
      `<w:p>${dropdownField(`<w:result w:val="9"/><w:default w:val="2"/>${ENTRIES}`)}</w:p>`
    );
    expect(viaDefault.map((piece) => piece.text)).toEqual(['Blue']);
    const viaFirst = project(
      `<w:p>${dropdownField(`<w:result w:val="9"/><w:default w:val="8"/>${ENTRIES}`)}</w:p>`
    );
    expect(viaFirst.map((piece) => piece.text)).toEqual(['Red']);
  });

  test('an empty w:ddList paints nothing', () => {
    const pieces = project(
      `<w:p>${dropdownField('<w:result w:val="0"/>')}<w:r><w:t>B</w:t></w:r></w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['B']);
    expect(pieces[0]).toMatchObject({ start: 1, end: 2 });
  });
});
