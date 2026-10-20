/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { exportPdf } from '../src/index.ts';
import { collectLines, unitsOf, type LaidOutLine } from '../scripts/lib/layout-lines.ts';
import { selectLines } from '../scripts/layout-dump.ts';
import { pairLines, readReferenceLines, trend, type ReferenceLine } from '../scripts/pdf-drift.ts';
import { docx, paragraph } from './fixture.ts';

const BODY =
  paragraph('First paragraph of the fixture') + paragraph('Second paragraph, other text');

test('layout lines carry text, geometry and the painted baseline in reading order', async () => {
  const document = await collectLines(docx(BODY), { useSystemFonts: false });
  expect(document.pageCount).toBe(1);
  expect(document.lines.map((line) => line.text)).toEqual([
    'First paragraph of the fixture',
    'Second paragraph, other text',
  ]);
  const [first, second] = document.lines as [LaidOutLine, LaidOutLine];
  expect(first.baseline).toBeGreaterThan(first.top);
  expect(second.top).toBeGreaterThan(first.top);
  // The painted baseline sits on the 0.24pt device grid and within half a unit of layout's.
  expect(Math.abs(unitsOf(first.painted) - Math.round(unitsOf(first.painted)))).toBeLessThan(1e-6);
  expect(Math.abs(first.painted - first.baseline)).toBeLessThan(0.24);
  // No `w:rFonts` on the run: the family is the document default, shaped by its substitute.
  expect(first.spans[0]!.family).toBeNull();
  expect(first.spans[0]!.face).toBe('Carlito');
  // A grep keeps the matching paragraph's lines only.
  expect(selectLines(document.lines, 'OTHER text', undefined).map((l) => l.text)).toEqual([
    'Second paragraph, other text',
  ]);
  expect(selectLines(document.lines, undefined, 2)).toEqual([]);
});

test('our own PDF, read back as a reference, pairs every line with no drift', async () => {
  const bytes = docx(BODY + paragraph('Third line for good measure'));
  const [ours, result] = await Promise.all([
    collectLines(bytes, { useSystemFonts: false }),
    exportPdf(bytes, { useSystemFonts: false }),
  ]);
  const reference = await readReferenceLines(result.bytes);
  expect(reference.pageCount).toBe(1);
  const { paired, unpairedOurs, unpairedRefs } = pairLines(ours.lines, reference.lines);
  expect(paired).toHaveLength(3);
  expect(unpairedOurs).toEqual([]);
  expect(unpairedRefs).toEqual([]);
  for (const pair of paired) {
    expect(Math.abs(unitsOf(pair.dyPt))).toBeLessThan(0.01);
    expect(Math.abs(unitsOf(pair.dxPt))).toBeLessThan(0.5);
  }
});

test('repeated text pairs with the nearest baseline, and deltas summarise as runs', () => {
  const ours = (text: string, painted: number): LaidOutLine =>
    ({
      page: 1,
      text,
      painted,
      baseline: painted,
      x: 72,
      right: 200,
      story: 'body',
    }) as LaidOutLine;
  const ref = (text: string, baseline: number): ReferenceLine => ({
    page: 1,
    text,
    baseline,
    x: 72,
    right: 200,
  });
  const { paired } = pairLines(
    [ours('cell', 100), ours('cell', 200), ours('tail', 300)],
    [ref('cell', 200.24), ref('cell', 100), ref('tail', 300.48)]
  );
  expect(paired.map((pair) => Math.round(unitsOf(pair.dyPt)))).toEqual([0, -1, -2]);
  expect(trend([0, 0.1, 1.2, 0.9, 1.1, 2])).toBe('L0..L1 0u | L2..L4 +1u | L5..L5 +2u');
});
