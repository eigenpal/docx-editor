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

test('content controls with other properties are refused', () => {
  const block = (tag: string) =>
    docx(
      `${p('One')}<w:sdt><w:sdtPr><w:tag w:val="${tag}"/></w:sdtPr><w:sdtContent>${p('Inside')}` +
        `</w:sdtContent></w:sdt>${p('Three')}`
    );
  expect(refusal(block('A'), block('B'))).toBe('unsupportedContent');
  const inline = (tag: string) =>
    docx(
      `<w:p>${run('Click ')}<w:sdt><w:sdtPr><w:tag w:val="${tag}"/></w:sdtPr><w:sdtContent>` +
        `${run('here')}</w:sdtContent></w:sdt>${run(' now')}</w:p>`
    );
  expect(refusal(inline('A'), inline('B'))).toBe('unsupportedContent');
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
  const long = docx(p('a'.repeat(800_000)));
  expect(refusal(long, docx(p('b'.repeat(800_000))))).toBe('tooLarge');
});

// Each shape took 13 s or more with a quadratic step; the bounds leave room for a busy machine.
const timed = (base: Uint8Array, revised: Uint8Array) => {
  const started = performance.now();
  const result = compareDocuments(base, revised, { authorName: 'Test', date: DATE });
  return { ok: result.ok, ms: performance.now() - started };
};

test('many inserted tables against one long deleted paragraph stay linear', () => {
  const text = Array.from({ length: 300_000 }, (_, i) => `w${i % 97}`).join(' ');
  const table = (i: number) =>
    `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p(`c${i}`)}</w:tc></w:tr></w:tbl><w:p/>`;
  const { ok, ms } = timed(
    docx(`${p(text)}${p('end')}`),
    docx(`${Array.from({ length: 8000 }, (_, i) => table(i)).join('')}${p('end')}`)
  );
  expect(ok).toBe(true);
  expect(ms).toBeLessThan(10_000);
}, 60_000);

test('a block with many links stays linear', () => {
  const links = Array.from(
    { length: 40_000 },
    (_, i) => `<w:hyperlink r:id="rIdL1">${run(`l${i % 10} `)}</w:hyperlink>`
  ).join('');
  const block = `<w:sdt><w:sdtPr><w:tag w:val="t"/></w:sdtPr><w:sdtContent><w:p>${links}</w:p></w:sdtContent></w:sdt>`;
  const doc = (text: string) =>
    buildDocx({ body: block + p(text), hyperlinks: { rIdL1: 'https://example.com/' } });
  const { ok, ms } = timed(doc('a'), doc('b'));
  expect(ok).toBe(true);
  expect(ms).toBeLessThan(10_000);
}, 60_000);

test('a deleted paragraph of many tabs stays linear', () => {
  const tabs = '<w:r><w:tab/></w:r>'.repeat(32_000);
  const { ok, ms } = timed(docx(`<w:p>${tabs}</w:p>${p('end')}`), docx(p('end')));
  expect(ok).toBe(true);
  expect(ms).toBeLessThan(8_000);
}, 60_000);

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
  expect(refusal(doc(70_000, 'a'), doc(70_000, 'b'))).toBe('tooLarge');
});
