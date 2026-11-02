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
    .replace(/<w:(trPr|tcPr|tblPrEx)\/>/g, '');

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
