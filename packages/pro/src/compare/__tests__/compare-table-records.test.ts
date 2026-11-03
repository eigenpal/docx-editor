/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A reject restores the formatting of a table row, and of a table with alignment or grid
// history, as one decision. Each compared table must reject to the original's properties.
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { applyTreeOp, readOoxmlPackage, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { p, table } from '../../../../../scripts/compare-corpus/xml.ts';
import { compareDocuments } from '../index.ts';

const DATE = new Date('2026-01-10T12:00:00Z');
const docx = (body: string) => buildDocx({ body });

/** The table XML, without empty property containers (they state nothing). */
const tableOf = (xml: string) =>
  xml
    .slice(xml.indexOf('<w:tbl>'), xml.indexOf('</w:tbl>') + 8)
    .replace(/<w:(trPr|tcPr|tblPrEx)\/>/g, '')
    .replace(/<w:pPr><w:rPr\/><\/w:pPr>/g, '');

function mainXml(bytes: Uint8Array): string {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error(read.reason);
  return serializeOoxmlPart(read.package.parts.get(read.package.mainDocumentPart)!);
}

function rejectedTable(base: Uint8Array, revised: Uint8Array): { out: string; rejected: string } {
  const result = compareDocuments(base, revised, { authorName: 'Test', date: DATE });
  if (!result.ok) throw new Error(result.message);
  const read = readOoxmlPackage(result.bytes);
  if (!read.ok) throw new Error(read.reason);
  const part = read.package.parts.get(read.package.mainDocumentPart)!;
  const rejected = applyTreeOp(part, { op: 'rejectAllRevisions' });
  if (!rejected.ok) throw new Error(rejected.reason);
  return {
    out: strFromU8(unzipSync(result.bytes)['word/document.xml']!),
    rejected: tableOf(serializeOoxmlPart(rejected.part)),
  };
}

test('a compared table with no properties keeps its required properties element', () => {
  const bare = (text: string) =>
    docx(
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p(text)}</w:tc></w:tr></w:tbl>${p('After.')}`
    );
  const { out, rejected } = rejectedTable(bare('Cell text'), bare('Other text'));
  // Without it the table reads with legacy defaults: other margins and an automatic width.
  expect(out).toMatch(/<w:tbl><w:tblPr\/><w:tblGrid>/);
  expect(rejected).toMatch(/<w:tbl><w:tblPr\/><w:tblGrid>/);
});

test('a compared cell keeps one properties element', () => {
  const { out } = rejectedTable(docx(table([['a', 'b']])), docx(table([['a', 'B']])));
  expect(out.match(/<w:tc>/g)?.length).toBe(2);
  expect(out.match(/<w:tc><w:tcPr>/g)?.length).toBe(2);
  expect(out).not.toMatch(/<\/w:tcPr><w:tcPr>/);
});

const cases: readonly [string, string, string][] = [
  [
    'row height added',
    table([['a', 'b']]),
    table([['a', 'b']], { trPr: () => '<w:trHeight w:val="800"/>' }),
  ],
  [
    'one cell aligned',
    table([['a', 'b', 'c']]),
    table([['a', { text: 'b', tcPr: '<w:vAlign w:val="center"/>' }, 'c']]),
  ],
  ['table centered', table([['a', 'b']]), table([['a', 'b']], { tblPr: '<w:jc w:val="center"/>' })],
  [
    'table centered and a row deleted',
    table([['a'], ['b'], ['c']]),
    table([['a'], ['c']], { tblPr: '<w:jc w:val="center"/>' }),
  ],
];

for (const [name, before, after] of cases) {
  test(`a reject restores the original table: ${name}`, () => {
    const base = docx(before);
    expect(rejectedTable(base, docx(after)).rejected).toBe(tableOf(mainXml(base)));
  });
}

test('a reject restores the original grid', () => {
  const grid = (widths: number[]) =>
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${widths
      .map((w) => `<w:gridCol w:w="${w}"/>`)
      .join(
        ''
      )}</w:tblGrid><w:tr><w:tc>${p('a')}</w:tc><w:tc>${p('b')}</w:tc></w:tr></w:tbl>${p('')}`;
  const base = docx(grid([4680, 4680]));
  expect(rejectedTable(base, docx(grid([2000, 7360]))).rejected).toBe(tableOf(mainXml(base)));
});

test('markup around rows and cells stays in a compared table', () => {
  const cell = (text: string) => `<w:tc>${p(text)}</w:tc>`;
  const markup = (text: string) =>
    docx(
      `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/>` +
        `<w:gridCol w:w="4000"/></w:tblGrid><w:bookmarkStart w:id="7" w:name="RowMark"/>` +
        `<w:tr><w:bookmarkStart w:id="8" w:name="CellMark"/>${cell('a')}<w:bookmarkEnd w:id="8"/>` +
        `${cell(text)}</w:tr><w:bookmarkEnd w:id="7"/><w:sdt><w:sdtPr><w:id w:val="5"/></w:sdtPr>` +
        `<w:sdtContent><w:tr>${cell('')}${cell('')}</w:tr></w:sdtContent></w:sdt></w:tbl>${p('')}`
    );
  const base = markup('b');
  const { out, rejected } = rejectedTable(base, markup('b2'));
  expect(rejected).toBe(tableOf(mainXml(base)));
  expect(out.match(/<w:bookmarkStart\b/g)?.length).toBe(2);
  expect(out).toContain('<w:sdt>');
});

test('markup only the revised table has is refused', () => {
  const table = (extra: string) =>
    docx(
      `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>${extra}` +
        `<w:tr><w:tc>${p('a')}</w:tc></w:tr></w:tbl>${p('')}`
    );
  const result = compareDocuments(
    table(''),
    table('<w:bookmarkStart w:id="1" w:name="New"/><w:bookmarkEnd w:id="1"/>'),
    { authorName: 'Test', date: DATE }
  );
  expect(result.ok ? '' : result.code).toBe('unsupportedContent');
});

test('a row exception only the original has is recorded; a reject restores it', () => {
  const row = (exception: string, text: string) =>
    `<w:tr>${exception}<w:tc>${p(text)}</w:tc></w:tr>`;
  const margins =
    '<w:tblPrEx><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPrEx>';
  const doc = (exception: string) =>
    docx(
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>${row('', 'First')}${row(exception, 'Second')}</w:tbl>${p('After.')}`
    );
  const { out, rejected } = rejectedTable(doc(margins), doc(''));
  expect(out).toContain('<w:tblPrExChange');
  expect(rejected).toContain('<w:tr><w:tblPrEx><w:tblCellMar><w:top w:type="dxa" w:w="0"/>');
  expect(rejected).not.toContain('tblPrExChange');
});
