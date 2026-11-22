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

// 0: "Before" and the begin character share a run; 1: "Pg", the end character, and "Tail" share one.
const SHARED =
  `<w:p><w:r><w:t>Before</w:t><w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r><w:instrText>TOC \\o</w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/><w:t>Entry</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>Pg</w:t><w:fldChar w:fldCharType="end"/><w:t>Tail</w:t></w:r></w:p>`;

function sharedAfter(op: TreeDocOp, index: number): string {
  const loaded = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${SHARED}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  const result = applyTreeOp(loaded.part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  return serializeOoxmlPart(result.part).split('<w:p>')[index + 1]!;
}

for (const [label, make, needle] of END_CASES) {
  test(`${label} at a field edge stays outside when the field character shares a run`, () => {
    const end = sharedAfter(make(END_AT), 1);
    expect(at(end, needle)).toBeGreaterThan(at(end, 'w:fldCharType="end"'));
    expect(at(end, needle)).toBeLessThan(at(end, 'Tail'));
    const begin = sharedAfter(make(BEGIN_AT), 0);
    expect(at(begin, needle)).toBeLessThan(
      begin.lastIndexOf('w:fldCharType="begin"', at(begin, 'TOC'))
    );
    expect(at(begin, 'Before')).toBeLessThan(at(begin, needle));
  });
}

test('a link over the text after a shared-run end character leaves the character outside', () => {
  const xml = sharedAfter({ op: 'insertHyperlink', ...END_AT, start: 2, end: 6, anchor: 'x' }, 1);
  expect(at(xml, '<w:hyperlink')).toBeGreaterThan(at(xml, 'w:fldCharType="end"'));
});

test("a link over a field's first result text leaves the field code outside the link", () => {
  const xml = paragraphAfter(
    { op: 'insertHyperlink', ...BEGIN_AT, start: 6, end: 11, anchor: 'x' },
    0
  );
  expect(at(xml, '<w:hyperlink')).toBeGreaterThan(at(xml, 'w:fldCharType="separate"'));
  expect(xml.slice(at(xml, '<w:hyperlink'))).toContain('Entry');
});

test('a tracked insertion at a field edge stays outside when the field character shares a run', () => {
  const revision = { author: 'A', date: '2024-01-01T00:00:00Z' };
  const begin = sharedAfter({ op: 'insertText', ...BEGIN_AT, text: 'Z', revision }, 0);
  expect(at(begin, '>Z<')).toBeLessThan(
    begin.lastIndexOf('w:fldCharType="begin"', at(begin, 'TOC'))
  );
  const end = sharedAfter({ op: 'insertText', ...END_AT, text: 'Z', revision }, 1);
  expect(at(end, '>Z<')).toBeGreaterThan(at(end, 'w:fldCharType="end"'));
});

const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const DRAWING_NAMESPACES =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  `xmlns:pic="${PIC_URI}"`;
const PICTURE =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="152400" cy="152400"/><wp:docPr id="1" name="pic"/><wp:cNvGraphicFramePr/>' +
  `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/>` +
  '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId14"/><a:stretch><a:fillRect/>' +
  '</a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="152400" cy="152400"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
  '</wp:inline></w:drawing></w:r>';

test('an inline picture moved to a field edge lands outside the field', () => {
  const loaded = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:r="${R}" ${DRAWING_NAMESPACES}><w:body>${BODY}<w:p>${PICTURE}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  const drawingNodeId = findDrawingId(loaded.part.root)!;
  for (const [where, index, after] of [
    [BEGIN_AT, 0, false],
    [END_AT, 1, true],
  ] as const) {
    const result = applyTreeOp(loaded.part, { op: 'moveInlineDrawing', drawingNodeId, ...where });
    if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
    const paragraph = serializeOoxmlPart(result.part).split('<w:p>')[index + 1]!;
    const drawing = at(paragraph, '<w:drawing');
    if (after) expect(drawing).toBeGreaterThan(at(paragraph, 'w:fldCharType="end"'));
    else
      expect(drawing).toBeLessThan(
        paragraph.lastIndexOf('w:fldCharType="begin"', at(paragraph, 'TOC'))
      );
  }
});

function findDrawingId(node: OoxmlPart['root']): string | null {
  if (node.kind === 'textValue') return null;
  if (node.kind === 'drawing') return node.id;
  for (const child of node.children) {
    const found = findDrawingId(child as OoxmlPart['root']);
    if (found) return found;
  }
  return null;
}

// A field character inside a wrapper that also holds content on the far side of it: the
// wrapper divides into two copies, so the inserted content lands between them.
const REVISION = 'w:author="B" w:date="2024-01-01T00:00:00Z" w:id="9"';
const WRAPPERS: readonly (readonly [string, string, string, string])[] = [
  ['a tracked insertion', `<w:ins ${REVISION}>`, '</w:ins>', `<w:ins ${REVISION}>`],
  ['a link', '<w:hyperlink w:anchor="t">', '</w:hyperlink>', '<w:hyperlink w:anchor="t">'],
  [
    'a smart tag',
    '<w:smartTag w:element="place" w:uri="urn:x">',
    '</w:smartTag>',
    '<w:smartTag w:element="place" w:uri="urn:x">',
  ],
];

function wrappedAfter(open: string, close: string, op: TreeDocOp, index: number): string {
  const body =
    `<w:p>${open}${run('Before')}${code}${close}${run('Entry')}</w:p>` +
    `<w:p>${open}${run('Pg')}${fldChar('end')}${run('Tail')}${close}</w:p>`;
  const loaded = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  const result = applyTreeOp(loaded.part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  return serializeOoxmlPart(result.part).split('<w:p>')[index + 1]!;
}

const count = (xml: string, needle: string) => xml.split(needle).length - 1;
const revision = { author: 'A', date: '2024-01-01T00:00:00Z' };
const WRAPPED_CASES: readonly (readonly [string, (w: typeof END_AT) => TreeDocOp, string])[] = [
  // An empty content control is taken whole and never goes inside a wrapper (below).
  ...END_CASES.filter(([label]) => label !== 'an empty content control'),
  ['typed text', (w) => ({ op: 'insertText', ...w, text: 'Z' }), '>Z<'],
  ['a tracked insertion', (w) => ({ op: 'insertText', ...w, text: 'Z', revision }), '>Z<'],
];

/**
 * Whether the halves of a divided insertion join again around the insert: untracked runs and
 * controls do. Range markers stay between the halves, which still form one change, and a
 * tracked insertion is another change between them.
 */
const rejoins = (wrapper: string, label: string) =>
  wrapper === 'a tracked insertion' &&
  !['a bookmark', 'a comment marker', 'a tracked insertion'].includes(label);

for (const [wrapper, open, close, serialized] of WRAPPERS)
  for (const [label, make, needle] of WRAPPED_CASES) {
    test(`${label} at a field edge inside ${wrapper} goes outside the field`, () => {
      const end = wrappedAfter(open, close, make(END_AT), 1);
      expect(at(end, needle)).toBeGreaterThan(at(end, 'w:fldCharType="end"'));
      expect(at(end, needle)).toBeLessThan(at(end, 'Tail'));
      const begin = wrappedAfter(open, close, make(BEGIN_AT), 0);
      const character = begin.lastIndexOf('w:fldCharType="begin"', at(begin, 'TOC'));
      expect(at(begin, needle)).toBeLessThan(character);
      expect(at(begin, 'Before')).toBeLessThan(at(begin, needle));
      if (rejoins(wrapper, label)) {
        // Untracked content joins the insertion again, so it stays one change.
        expect(count(end, serialized)).toBe(1);
        expect(count(begin, serialized)).toBe(1);
        return;
      }
      // Both sides keep the wrapper, with the same attributes.
      expect(at(end, serialized)).toBeLessThan(at(end, 'w:fldCharType="end"'));
      expect(end.slice(at(end, 'w:fldCharType="end"'), at(end, needle))).toContain(close);
      expect(end.slice(at(end, needle), at(end, 'Tail'))).toContain(serialized);
      expect(begin.lastIndexOf(serialized, character)).toBeGreaterThan(at(begin, needle));
      expect(begin.slice(at(begin, 'Before'), at(begin, needle))).toContain(close);
    });
  }

test('a link over the text after a wrapped end character leaves the character outside', () => {
  const [, open, close] = WRAPPERS[0]!;
  const xml = wrappedAfter(
    open,
    close,
    { op: 'insertHyperlink', ...END_AT, start: 2, end: 6, anchor: 'x' },
    1
  );
  expect(at(xml, 'w:anchor="x"')).toBeGreaterThan(at(xml, 'w:fldCharType="end"'));
});

test('an empty content control at a wrapped field edge is refused, not placed inside', () => {
  for (const [, open, close] of WRAPPERS) {
    const body = `<w:p>${run('A')}${code}${run('E')}</w:p><w:p>${open}${run('Pg')}${fldChar('end')}${run('Tail')}${close}</w:p>`;
    const loaded = readOoxmlPart(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!loaded.ok) throw new Error(loaded.reason);
    const op = END_CASES.find(([label]) => label === 'an empty content control')![1](END_AT);
    const result = applyTreeOp(loaded.part, op);
    expect(result.ok ? 'ok' : result.reason).toBe('indivisible-content');
  }
});

test('a content control holding a field character is not divided', () => {
  const xml = wrappedAfter(
    '<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent>',
    '</w:sdtContent></w:sdt>',
    { op: 'insertBookmark', name: 'b', start: END_AT, end: END_AT },
    1
  );
  expect(count(xml, '<w:sdt>')).toBe(1);
  expect(count(xml, '<w:id w:val="7"/>')).toBe(1);
});
