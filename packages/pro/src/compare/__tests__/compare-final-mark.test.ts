/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A story's final paragraph mark can never be inserted or deleted: a file that marks it cannot
// have all of its changes accepted. Range markers after the last paragraph do not move it.
import { expect, test } from 'bun:test';
import { readOoxmlPackage, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { compareDocuments } from '../index.ts';

const DATE = new Date('2026-01-10T12:00:00Z');
const para = (text: string, pPr = '') =>
  `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function lastParagraph(base: string, revised: string): string {
  const result = compareDocuments(buildDocx({ body: base }), buildDocx({ body: revised }), {
    authorName: 'Test',
    date: DATE,
  });
  if (!result.ok) throw new Error(result.message);
  const read = readOoxmlPackage(result.bytes);
  if (!read.ok) throw new Error(read.reason);
  const xml = serializeOoxmlPart(read.package.parts.get(read.package.mainDocumentPart)!);
  const paragraphs = xml.match(/<w:p\b(?:(?!<w:p\b).)*?<\/w:p>/gs) ?? [];
  return paragraphs[paragraphs.length - 1] ?? '';
}

const start = '<w:bookmarkStart w:id="1" w:name="all"/>';
const end = '<w:bookmarkEnd w:id="1"/>';

test('a bookmark end after the last paragraph leaves the final mark unmarked', () => {
  const last = lastParagraph(
    `${start}${para('Kept.')}${para('Payment terms.')}${para('Invoices are due in 30 days.')}${end}`,
    `${start}${para('Kept.')}${para('A new closing sentence.', '<w:pPr><w:jc w:val="both"/></w:pPr>')}${end}`
  );
  expect(last).not.toMatch(/<w:pPr>(?:(?!<\/w:pPr>).)*<w:rPr>(?:(?!<\/w:rPr>).)*<w:(?:del|ins)\b/s);
  // The kept mark takes the revised paragraph's properties as a recorded change.
  expect(last).toContain('<w:jc w:val="both"/>');
  expect(last).toContain('<w:pPrChange');
});

test('an element the body does not allow after the last paragraph leaves the final mark', () => {
  const stray = '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>';
  const last = lastParagraph(
    `${para('Kept.')}${para('Content after the break.')}`,
    `${para('Kept.')}${para('A new closing sentence.')}${stray}`
  );
  expect(last).not.toMatch(/<w:pPr>(?:(?!<\/w:pPr>).)*<w:rPr>(?:(?!<\/w:rPr>).)*<w:(?:del|ins)\b/s);
});

test('the final mark stays unmarked without trailing markers too', () => {
  const last = lastParagraph(
    `${para('Kept.')}${para('Invoices are due in 30 days.')}`,
    `${para('Kept.')}${para('A new closing sentence.')}`
  );
  expect(last).not.toMatch(/<w:pPr>(?:(?!<\/w:pPr>).)*<w:rPr>(?:(?!<\/w:rPr>).)*<w:(?:del|ins)\b/s);
});
