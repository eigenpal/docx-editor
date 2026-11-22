// Content inserted at the edge of a complex field that spans paragraphs goes outside it:
// after `w:fldChar w:fldCharType="end"`, before `w:fldChar w:fldCharType="begin"`. Each lane
// that places content at an offset follows that one rule (`tree-op-field-edge.ts`).

import { expect, test } from 'bun:test';
import { readOoxmlPart, validateOoxmlPart, type OoxmlPart } from '../package/ooxml-tree.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { applyTreeOp, type TreeDocOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const fldChar = (type: string) => `<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`;
const code = `${fldChar('begin')}<w:r><w:instrText>TOC \\o</w:instrText></w:r>${fldChar('separate')}`;
// 0: "Before" + begin + "Entry" (the field begins at offset 6); 1: "Pg" + end + "Tail" (the
// field ends at offset 2); 2: a closing line holding only the end of a second field.
const BODY =
  `<w:p>${run('Before')}${code}${run('Entry')}</w:p>` +
  `<w:p>${run('Pg')}${fldChar('end')}${run('Tail')}</w:p>` +
  `<w:p>${code}${run('Row')}</w:p><w:p>${fldChar('end')}</w:p>`;
const BEGIN_AT = { paragraphId: '/word/document.xml#0.0.0', offset: 6 };
const END_AT = { paragraphId: '/word/document.xml#0.0.1', offset: 2 };
const CLOSING_AT = { paragraphId: '/word/document.xml#0.0.3', offset: 0 };

function load(): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${BODY}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** The serialized paragraph at `index` after applying `op`. */
function paragraphAfter(op: TreeDocOp, index: number): string {
  const result = applyTreeOp(load(), op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  return serializeOoxmlPart(result.part).split('<w:p>')[index + 1]!;
}

const at = (xml: string, needle: string) => {
  const index = xml.indexOf(needle);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
};

const END_CASES: readonly (readonly [string, (where: typeof END_AT) => TreeDocOp, string])[] = [
  [
    'a bookmark',
    (w) => ({ op: 'insertBookmark', name: 'b', start: w, end: w }),
    '<w:bookmarkStart',
  ],
  [
    'a comment marker',
    (w) => ({ op: 'insertCommentMarker', ...w, commentId: '7', marker: 'start' }),
    '<w:commentRangeStart',
  ],
  [
    'an empty content control',
    (w) => ({
      op: 'insertContentControl',
      ...w,
      start: w.offset,
      end: w.offset,
      type: 'plainText',
    }),
    '<w:sdt>',
  ],
  [
    'an inline content control',
    (w) => ({ op: 'insertInlineContentControl', ...w, tag: 't', text: 'X' }),
    '<w:sdt>',
  ],
  ['a field', (w) => ({ op: 'insertComplexField', ...w, instruction: 'PAGE' }), 'PAGE'],
];

for (const [label, make, needle] of END_CASES) {
  test(`${label} at a field's end edge goes after the end character`, () => {
    for (const [where, index] of [
      [END_AT, 1],
      [CLOSING_AT, 3],
    ] as const) {
      const xml = paragraphAfter(make(where), index);
      expect(at(xml, needle)).toBeGreaterThan(at(xml, 'w:fldCharType="end"'));
    }
  });

  test(`${label} at a field's begin edge goes before the begin character`, () => {
    const xml = paragraphAfter(make(BEGIN_AT), 0);
    // The begin character of the field that spans paragraphs, not of a field just inserted.
    const begin = xml.lastIndexOf('w:fldCharType="begin"', at(xml, 'TOC'));
    expect(at(xml, needle)).toBeLessThan(begin);
    expect(at(xml, 'Before')).toBeLessThan(at(xml, needle));
  });
}

test("a link over the text after a field's end leaves the end character outside the link", () => {
  const xml = paragraphAfter(
    { op: 'insertHyperlink', ...END_AT, start: 2, end: 6, anchor: 'x' },
    1
  );
  const link = at(xml, '<w:hyperlink');
  expect(link).toBeGreaterThan(at(xml, 'w:fldCharType="end"'));
  expect(xml.slice(link)).toContain('Tail');
});

test("a link over the text before a field's begin leaves the begin character outside the link", () => {
  const xml = paragraphAfter(
    { op: 'insertHyperlink', ...BEGIN_AT, start: 0, end: 6, anchor: 'x' },
    0
  );
  expect(at(xml, '</w:hyperlink>')).toBeLessThan(at(xml, 'w:fldCharType="begin"'));
});

test("typed text at a field's begin edge joins the run before the field", () => {
  const xml = paragraphAfter({ op: 'insertText', ...BEGIN_AT, text: 'Z' }, 0);
  expect(xml).toContain('BeforeZ');
  expect(at(xml, 'BeforeZ')).toBeLessThan(at(xml, 'w:fldCharType="begin"'));
});
