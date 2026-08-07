// A tracked field RESULT is tracked, and says so.
//
// A field's displayed text does not reach the page the way a run's does. It is buffered while
// the field is open and flushed when `fldChar end` arrives, by which point the depth-first walk
// has left whatever `w:del`/`w:ins` enclosed it. Attribution read at flush time was therefore
// empty, and a deleted field result painted as ordinary unchanged text: no strike, no author,
// nothing for a reviewer to see. Fields are how Word writes cross-references, page numbers and
// form-field values, so this covered a lot of a real contract.
//
// The two arms below are the two shapes Word actually writes, and they need different capture
// points — one wraps the whole `begin`…`end` sequence, the other wraps only the result run.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { piecesOfParagraph, type ModelRange } from '../field-projection.ts';
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

function project(
  body: string,
  mode: RevisionDisplayMode = 'all-markup',
  deletedRanges?: ModelRange[]
) {
  return piecesOfParagraph(
    paragraphOf(body),
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    mode,
    deletedRanges as never
  );
}

/** The revision kinds attributed to the piece carrying `text`, or undefined when untracked. */
function attributionOf(
  pieces: ReturnType<typeof project>,
  text: string
): readonly string[] | undefined {
  const piece = pieces.find((candidate) => candidate.text === text);
  if (!piece) throw new Error(`no piece painted ${JSON.stringify(text)}`);
  return piece.revisions?.map((revision) => `${revision.kind}:${revision.author}`);
}

const FIELD_CHROME =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> REF _Ref1 \\h </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';

describe('a deletion around only the field RESULT', () => {
  // How Word records a legacy form field whose filled-in value was replaced: begin and end sit
  // outside the deletion, and only the run holding the displayed value is struck.
  const body =
    '<w:p>' +
    '<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Text1"/><w:enabled/>' +
    '<w:textInput><w:default w:val="Placeholder"/></w:textInput></w:ffData></w:fldChar></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:del w:id="1" w:author="Reviewer" w:date="2026-08-05T08:12:15Z">' +
    '<w:r><w:delText>Placeholder</w:delText></w:r></w:del>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
    '<w:ins w:id="2" w:author="Reviewer" w:date="2026-08-05T11:42:40Z">' +
    '<w:r><w:t>Replacement</w:t></w:r></w:ins>' +
    '<w:r><w:t xml:space="preserve">, a company</w:t></w:r>' +
    '</w:p>';

  test('the result paints as a deletion by its author', () => {
    expect(attributionOf(project(body), 'Placeholder')).toEqual(['delete:Reviewer']);
  });

  test('the insertion beside it is unaffected', () => {
    expect(attributionOf(project(body), 'Replacement')).toEqual(['insert:Reviewer']);
  });

  test('untracked text in the same paragraph stays untracked', () => {
    expect(attributionOf(project(body), ', a company')).toBeUndefined();
  });

  test('the proposed result drops it entirely', () => {
    const texts = project(body, 'proposed').map((piece) => piece.text);
    expect(texts).not.toContain('Placeholder');
    expect(texts).toContain('Replacement');
  });

  test('the deleted range is the atom, never a negative offset', () => {
    // The atom reserved ONE model unit at `begin`; deriving the range from the running offset
    // instead produced a start before the paragraph began, which the caret then stepped into.
    for (const mode of ['all-markup', 'proposed', 'original'] as const) {
      const ranges: ModelRange[] = [];
      project(body, mode, ranges);
      expect(ranges.length).toBeGreaterThan(0);
      for (const range of ranges) {
        expect(range.start).toBeGreaterThanOrEqual(0);
        expect(range.end).toBeGreaterThan(range.start);
      }
      expect(ranges[0]).toEqual({ start: 0, end: 1 });
    }
  });
});

describe('a revision around the WHOLE field', () => {
  // How Word records an inserted cross-reference: `w:ins` encloses begin, instruction,
  // separate, result and end together.
  const inserted =
    '<w:p>' +
    `<w:ins w:id="3" w:author="Author" w:date="2026-07-07T20:18:00Z">${FIELD_CHROME}` +
    '<w:r><w:t>Section 3</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:ins>' +
    '</w:p>';

  test('the result paints as an insertion', () => {
    expect(attributionOf(project(inserted), 'Section 3')).toEqual(['insert:Author']);
  });

  test('nesting is kept whole, outermost first', () => {
    // A wrapper around the whole field means `atomicFieldSpansOf` — which does not descend into
    // revision wrappers — never forms an atom, so the result is ordinary buffered content and
    // carries the full stack exactly as a plain run would. The outer decides whether the text
    // exists at all; the inner is still someone's pending decision about it.
    const nested =
      '<w:p>' +
      `<w:ins w:id="4" w:author="Outer" w:date="2026-07-07T20:18:00Z">${FIELD_CHROME}` +
      '<w:ins w:id="5" w:author="Inner" w:date="2026-07-08T20:18:00Z">' +
      '<w:r><w:t>Section 4</w:t></w:r></w:ins>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:ins>' +
      '</w:p>';
    expect(attributionOf(project(nested), 'Section 4')).toEqual(['insert:Outer', 'insert:Inner']);
  });
});

describe('a field result inside a hyperlink', () => {
  test('keeps the link every other run in that link keeps', () => {
    const body =
      '<w:p><w:hyperlink w:anchor="target">' +
      `${FIELD_CHROME}<w:r><w:t>Section 5</w:t></w:r>` +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '</w:hyperlink></w:p>';
    const pieces = piecesOfParagraph(
      paragraphOf(body),
      [],
      undefined,
      undefined,
      () => ({ href: '#target' }),
      undefined,
      'all-markup'
    );
    const piece = pieces.find((candidate) => candidate.text === 'Section 5');
    expect(piece?.link).toEqual({ href: '#target' });
  });
});
