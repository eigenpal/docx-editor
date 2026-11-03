/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Links that start inside a word, content control properties, markup between table rows next
// to a deleted row, a deleted table before inserted closing text, and the text size limit.
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { applyTreeOp, readOoxmlPackage, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { p } from '../../../../../scripts/compare-corpus/xml.ts';
import { compareDocuments } from '../index.ts';

const DATE = new Date('2026-01-10T12:00:00Z');
const docx = (body: string) => buildDocx({ body });
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function resolved(bytes: Uint8Array, op: 'acceptAllRevisions' | 'rejectAllRevisions'): string {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error(read.reason);
  const part = read.package.parts.get(read.package.mainDocumentPart)!;
  const result = applyTreeOp(part, { op });
  if (!result.ok) throw new Error(result.reason);
  return serializeOoxmlPart(result.part);
}

function compared(base: Uint8Array, revised: Uint8Array): Uint8Array {
  const result = compareDocuments(base, revised, { authorName: 'Test', date: DATE });
  if (!result.ok) throw new Error(result.message);
  return result.bytes;
}

const refusal = (base: Uint8Array, revised: Uint8Array) => {
  const result = compareDocuments(base, revised, { authorName: 'Test', date: DATE });
  return result.ok ? '' : result.code;
};

test('a link that starts inside a word comes back on reject', () => {
  const linked = buildDocx({
    body:
      `<w:p>${run('Click foo')}<w:hyperlink xmlns:r="${R_NS}" w:anchor="target">` +
      `${run('bar')}</w:hyperlink>${run(' now')}</w:p>`,
  });
  const plain = docx(`<w:p>${run('Click foo')}${run('bar')}${run(' now')}</w:p>`);
  // The deleted link is written as a hyperlink field inside the deletion, so reject restores it.
  expect(resolved(compared(linked, plain), 'rejectAllRevisions')).toMatch(
    /HYPERLINK \\l &quot;target&quot;.*fldCharType="separate".*bar.*fldCharType="end"/s
  );
  const rejected = resolved(compared(plain, linked), 'rejectAllRevisions');
  expect(rejected).not.toContain('<w:hyperlink');
  expect(rejected).not.toContain('HYPERLINK');
});

test('a block content control takes the revised properties; text moves between inline controls', () => {
  const block = (tag: string) =>
    docx(
      `${p('One')}<w:sdt><w:sdtPr><w:tag w:val="${tag}"/></w:sdtPr><w:sdtContent>${p('Inside')}` +
        `</w:sdtContent></w:sdt>${p('Three')}`
    );
  // Control properties have no revision form: the result keeps the revised control, unrecorded.
  const result = compareDocuments(block('A'), block('B'), { authorName: 'Test', date: DATE });
  if (!result.ok) throw new Error(result.message);
  expect(result).toMatchObject({ changed: true, revisionCount: 0 });
  const xml = strFromU8(unzipSync(result.bytes)['word/document.xml']!);
  expect(xml).toContain('<w:tag w:val="B"/>');
  expect(xml).toContain('Inside');
  const inline = (properties: string, text = 'here') =>
    docx(
      `<w:p>${run('Click ')}<w:sdt><w:sdtPr>${properties}</w:sdtPr><w:sdtContent>` +
        `${run(text)}</w:sdtContent></w:sdt>${run(' now')}</w:p>`
    );
  // Two different controls: the text leaves one and enters the other, so each keeps its own.
  const moved = compared(inline('<w:tag w:val="A"/>'), inline('<w:tag w:val="B"/>'));
  const accepted = resolved(moved, 'acceptAllRevisions');
  const rejected = resolved(moved, 'rejectAllRevisions');
  expect(accepted).toMatch(/<w:tag w:val="B"\/>.*here/s);
  expect(accepted).not.toMatch(/<w:tag w:val="A"\/><\/w:sdtPr><w:sdtContent>.*here/s);
  expect(rejected).toMatch(/<w:tag w:val="A"\/><\/w:sdtPr><w:sdtContent>(?:(?!<\/w:sdt>).)*here/s);
  // The same control, filled in: its equal text stays, and it takes the revised properties.
  const filled = compared(
    inline('<w:id w:val="7"/><w:showingPlcHdr/>', 'Type here'),
    inline('<w:id w:val="7"/>', 'Type here or there')
  );
  const filledXml = strFromU8(unzipSync(filled)['word/document.xml']!);
  expect(filledXml).not.toContain('showingPlcHdr');
  expect(filledXml).not.toMatch(/<w:delText[^>]*>[^<]*Type/);
});

test('a bookmark between rows stays in place when the next row is deleted', () => {
  const cell = (text: string) => `<w:tr><w:tc>${p(text)}</w:tc></w:tr>`;
  const table = (rows: string) =>
    docx(`<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>${rows}</w:tbl>${p('')}`);
  const mark = '<w:bookmarkStart w:id="3" w:name="Mark"/><w:bookmarkEnd w:id="3"/>';
  const base = table(`${cell('A')}${mark}${cell('B')}${cell('C')}`);
  const rejected = resolved(
    compared(base, table(`${cell('A')}${mark}${cell('C')}`)),
    'rejectAllRevisions'
  );
  const order = [...rejected.matchAll(/<w:bookmarkStart|<w:t>([ABC])<\/w:t>/g)].map(
    (match) => match[1] ?? 'mark'
  );
  expect(order).toEqual(['A', 'mark', 'B', 'C']);
});

test('a deleted table never lands after inserted closing text', () => {
  const table = `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p('cell text')}</w:tc></w:tr></w:tbl>`;
  const bytes = compared(
    docx(`${p('Intro')}${table}<w:p/>`),
    docx(`${p('Intro')}${p('New closing words')}`)
  );
  const body = strFromU8(unzipSync(bytes)['word/document.xml']!);
  expect(body).not.toMatch(/<\/w:tbl><w:sectPr/);
  const order = [
    ...resolved(bytes, 'rejectAllRevisions').matchAll(/<w:tbl>|<w:t>(Intro|cell text)<\/w:t>/g),
  ].map((match) => match[1] ?? 'table');
  expect(order).toEqual(['Intro', 'table', 'cell text']);
});

test('text over the size limit is refused before any work', () => {
  const long = docx(p('a'.repeat(1_600_000)));
  expect(refusal(long, docx(p('b'.repeat(1_600_000))))).toBe('tooLarge');
});

test('two documents of over a million characters each compare', () => {
  // 2,000 paragraphs of 600 characters: some 500 pages each, one word changed.
  const words = (word: string) =>
    Array.from({ length: 2000 }, (_, i) => p(`${word}${i} `.repeat(100).slice(0, 600)));
  const base = words('alpha');
  const revised = [...base];
  revised[1000] = p('changed '.repeat(75));
  const result = compareDocuments(docx(base.join('')), docx(revised.join('')), {
    authorName: 'Test',
    date: DATE,
  });
  expect(result.ok && result.revisionCount).toBe(2);
}, 60_000);

const timed = (base: Uint8Array, revised: Uint8Array) => {
  const started = performance.now();
  const result = compareDocuments(base, revised, { authorName: 'Test', date: DATE });
  return { ok: result.ok, ms: performance.now() - started };
};

/**
 * How much longer a compare of `make(4 * n)` takes than one of `make(n)`. Linear work grows
 * about 4 times, a quadratic step 16 times, so the ratio holds on a slow or busy machine where
 * a fixed time limit does not. The small size runs twice, so the first run warms the engine.
 */
function growth(make: (n: number) => readonly [Uint8Array, Uint8Array], n: number): number {
  const small = make(n);
  const large = make(4 * n);
  timed(...small);
  const first = timed(...small);
  const second = timed(...large);
  expect(first.ok && second.ok).toBe(true);
  return second.ms / Math.max(first.ms, 1);
}

test('many inserted tables against one long deleted paragraph stay linear', () => {
  const table = (i: number) =>
    `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p(`c${i}`)}</w:tc></w:tr></w:tbl><w:p/>`;
  const make = (n: number) => {
    const text = Array.from({ length: n * 37 }, (_, i) => `w${i % 97}`).join(' ');
    return [
      docx(`${p(text)}${p('end')}`),
      docx(`${Array.from({ length: n }, (_, i) => table(i)).join('')}${p('end')}`),
    ] as const;
  };
  expect(growth(make, 2000)).toBeLessThan(8);
}, 120_000);

test('a block with many links stays linear', () => {
  const make = (n: number) => {
    const links = Array.from(
      { length: n },
      (_, i) => `<w:hyperlink r:id="rIdL1">${run(`l${i % 10} `)}</w:hyperlink>`
    ).join('');
    const block = `<w:sdt><w:sdtPr><w:tag w:val="t"/></w:sdtPr><w:sdtContent><w:p>${links}</w:p></w:sdtContent></w:sdt>`;
    const doc = (text: string) =>
      buildDocx({ body: block + p(text), hyperlinks: { rIdL1: 'https://example.com/' } });
    return [doc('a'), doc('b')] as const;
  };
  expect(growth(make, 10_000)).toBeLessThan(8);
}, 120_000);

test('a deleted paragraph of many tabs stays linear', () => {
  const make = (n: number) =>
    [docx(`<w:p>${'<w:r><w:tab/></w:r>'.repeat(n)}</w:p>${p('end')}`), docx(p('end'))] as const;
  expect(growth(make, 8000)).toBeLessThan(8);
}, 120_000);

test('smart tag and custom XML properties never land inside a revision', () => {
  const smartTag = (value: string) =>
    `<w:smartTag w:uri="u" w:element="place"><w:smartTagPr><w:attr w:name="n" w:val="${value}"/>` +
    `</w:smartTagPr>${run('Paris')}</w:smartTag>`;
  const result = compareDocuments(
    docx(`<w:p>${run('A ')}${smartTag('v1')}${run(' B')}</w:p>`),
    docx(`<w:p>${run('A ')}${smartTag('v2')}${run(' B')}</w:p>`),
    { authorName: 'Test', date: DATE }
  );
  if (result.ok) {
    const body = strFromU8(unzipSync(result.bytes)['word/document.xml']!);
    expect(body).not.toMatch(/<w:(ins|del)\b[^>]*>\s*<w:(smartTagPr|customXmlPr)\b/);
  } else expect(result.code).toBe('unsupportedContent');
});

test('field data never lands inside a revision', () => {
  const field = (data: string, result: string) =>
    `<w:p>${run('By ')}<w:fldSimple w:instr=" AUTHOR "><w:fldData>${data}</w:fldData>` +
    `${run(result)}</w:fldSimple></w:p>`;
  for (const [before, after] of [
    [field('AAAA', 'Ann'), field('BBBB', 'Ann')],
    [field('AAAA', 'Ann'), field('AAAA', 'Bob')],
    [field('AAAA', 'Ann'), `<w:p>${run('By Ann')}</w:p>`],
  ] as const) {
    const result = compareDocuments(docx(before), docx(after), { authorName: 'Test', date: DATE });
    if (!result.ok) {
      expect(result.code).toBe('unsupportedContent');
      continue;
    }
    const body = strFromU8(unzipSync(result.bytes)['word/document.xml']!);
    expect(body).not.toMatch(/<w:(ins|del)\b[^>]*>\s*<w:fldData\b/);
    expect(body.match(/<w:fldData\b/g)?.length ?? 0).toBeLessThanOrEqual(1);
  }
});

test('many tiny runs count against the size limit', () => {
  const tabs = (count: number) => '<w:r><w:tab/></w:r>'.repeat(count);
  const doc = (count: number, end: string) => docx(`<w:p>${tabs(count)}</w:p>${p(end)}`);
  expect(refusal(doc(130_000, 'a'), doc(130_000, 'b'))).toBe('tooLarge');
});

// An emptied control shows placeholder spaces. They carry no text of either document, so the
// compare is not refused for them.
test('an inline control whose text goes is compared; its placeholder is no text', () => {
  const control = (text: string) =>
    `<w:sdt><w:sdtPr><w:tag w:val="combo"/></w:sdtPr><w:sdtContent>${run(text)}</w:sdtContent></w:sdt>`;
  const base = docx(`<w:p>${run('Combo box')}${control(' value')}${run(': Medium')}</w:p>`);
  const revised = docx(`<w:p>${run('Combo box')}${run(': Medium')}</w:p>`);
  const bytes = compared(base, revised);
  expect(resolved(bytes, 'rejectAllRevisions')).toContain(' value');
  expect(resolved(bytes, 'acceptAllRevisions')).toContain('<w:showingPlcHdr/>');
});

test('a paragraph never joins across a block control that both documents keep', () => {
  // The revised paragraph holds the text of the paragraphs before and after the control, and
  // the control moves after it. The two controls compare as a pair; no mark joins across one.
  const control = (rows: string) =>
    `<w:sdt><w:sdtPr><w:tag w:val="rows"/></w:sdtPr><w:sdtContent>${rows}</w:sdtContent></w:sdt>`;
  const base = docx(
    `${p('Opening section test')}${control(p('Row one') + p('Row two'))}${p('End.')}`
  );
  const revised = docx(`${p('Opening section the closing record.')}${control(p(' '))}`);
  const bytes = compared(base, revised);
  const text = (xml: string) =>
    [...xml.matchAll(/<w:p\b[^>]*>(.*?)<\/w:p>|<w:p\b[^>]*\/>/gs)].map((match) =>
      [...(match[1] ?? '').matchAll(/<w:t[^>]*>([^<]*)</g)].map((t) => t[1]).join('')
    );
  expect(text(resolved(bytes, 'acceptAllRevisions'))[0]).toBe(
    'Opening section the closing record.'
  );
  expect(text(resolved(bytes, 'rejectAllRevisions'))).toEqual([
    'Opening section test',
    'Row one',
    'Row two',
    'End.',
  ]);
});
