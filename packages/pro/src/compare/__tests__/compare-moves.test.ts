/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A moved paragraph is one move, recorded at both ends. When its formatting changed too, both
// ends carry the revised formatting with the original's in change records, so a reject restores
// the source exactly and an accept keeps the destination exactly.
import { expect, test } from 'bun:test';
import { applyTreeOp, readOoxmlPackage, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { compareDocuments } from '../index.ts';

const DATE = new Date('2026-01-10T12:00:00Z');
const para = (text: string, rPr = '', pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const MOVED = 'This paragraph moves to the end of the document.';

function decided(
  base: string,
  revised: string
): { out: string; accepted: string; rejected: string } {
  const result = compareDocuments(buildDocx({ body: base }), buildDocx({ body: revised }), {
    authorName: 'Test',
    date: DATE,
  });
  if (!result.ok) throw new Error(result.message);
  const read = readOoxmlPackage(result.bytes);
  if (!read.ok) throw new Error(read.reason);
  const part = read.package.parts.get(read.package.mainDocumentPart)!;
  const decide = (op: 'acceptAllRevisions' | 'rejectAllRevisions') => {
    const next = applyTreeOp(part, { op });
    if (!next.ok) throw new Error(next.reason);
    return serializeOoxmlPart(next.part);
  };
  return {
    out: serializeOoxmlPart(part),
    accepted: decide('acceptAllRevisions'),
    rejected: decide('rejectAllRevisions'),
  };
}

/** The paragraph that holds the moved text. */
const movedParagraphOf = (xml: string) =>
  (xml.match(/<w:p>(?:(?!<w:p>).)*?<\/w:p>/gs) ?? []).find((p) => p.includes('moves to the end'));

test('a moved paragraph with new formatting records it at both ends', () => {
  const base =
    para(MOVED, '<w:color w:val="2D6A4F"/>', '<w:spacing w:after="60"/>') +
    para('First kept paragraph.') +
    para('Second kept paragraph.') +
    para('Last paragraph.');
  const revised =
    para('First kept paragraph.') +
    para('Second kept paragraph.') +
    para(MOVED, '<w:color w:val="0C4A35"/><w:sz w:val="22"/>', '<w:spacing w:after="120"/>') +
    para('Last paragraph.');
  const { out, accepted, rejected } = decided(base, revised);
  expect(out).toContain('<w:moveFrom ');
  expect(out).toContain('<w:moveTo ');
  // Both ends: the revised formatting, with the original's recorded.
  expect(out.match(/<w:rPrChange\b/g)?.length).toBe(2);
  expect(out.match(/<w:pPrChange\b/g)?.length).toBe(2);
  expect(movedParagraphOf(accepted)).toContain('<w:color w:val="0C4A35"/>');
  expect(movedParagraphOf(accepted)).toContain('<w:spacing w:after="120"/>');
  expect(movedParagraphOf(rejected)).toContain('<w:color w:val="2D6A4F"/>');
  expect(movedParagraphOf(rejected)).not.toContain('w:sz');
  expect(movedParagraphOf(rejected)).toContain('<w:spacing w:after="60"/>');
});

test('a moved paragraph with the same formatting has no change records', () => {
  const base = para(MOVED, '<w:b/>') + para('First kept paragraph.') + para('Last paragraph.');
  const revised = para('First kept paragraph.') + para(MOVED, '<w:b/>') + para('Last paragraph.');
  const { out } = decided(base, revised);
  expect(out).toContain('<w:moveFrom ');
  expect(out).not.toContain('Change');
});

// A paragraph moves to the front while the last paragraph is replaced. The moved paragraph's
// source stays in its place before the replaced text, so reject restores the original order.
test('a moved paragraph keeps its place before a replaced last paragraph', () => {
  const line = (n: number) =>
    para(`Wrapping line ${n} with AV office glyph clusters and fixed vertical metrics.`);
  const base = line(31) + line(35) + line(40) + line(46);
  const revised =
    line(40) +
    line(31) +
    line(35) +
    para('The previous option includes the report service. The balance internal confirms it.');
  const { out, accepted, rejected } = decided(base, revised);
  expect(out).toContain('<w:moveFrom ');
  const order = (xml: string) =>
    [...xml.matchAll(/Wrapping line (\d+)|(The previous option)/g)].map((m) => m[1] ?? 'new');
  expect(order(rejected)).toEqual(['31', '35', '40', '46']);
  expect(order(accepted)).toEqual(['40', '31', '35', 'new']);
});
