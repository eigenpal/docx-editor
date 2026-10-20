/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';
import { glyphPositions } from './glyph-positions.ts';
import { paragraphGridOffsetX } from '../src/paragraph-grid-origin.ts';

const GRID = 0.24;
// 1276 twips is 63.8pt, which is not a whole device unit. The reference rounds the
// paragraph's left edge to the grid before it advances any glyph.
const SECTION =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1276" w:bottom="1440" w:left="1276" w:header="720" w:footer="720" w:gutter="0"/>' +
  '</w:sectPr>';
const onGrid = (value: number): boolean => Math.abs(value / GRID - Math.round(value / GRID)) < 1e-6;

test('a left-aligned paragraph starts on the device grid', async () => {
  const result = await exportPdf(
    docx(`<w:p><w:r><w:t xml:space="preserve">Origin</w:t></w:r></w:p>${SECTION}`),
    { useSystemFonts: false }
  );
  expect(result.diagnostics).toEqual([]);
  const xs = await glyphPositions(result.bytes);
  expect(xs.length).toBeGreaterThan(0);
  expect(onGrid(xs[0]!)).toBe(true);
});

test('a centered paragraph is not itself rounded onto the grid', async () => {
  const centered =
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">Centered</w:t></w:r></w:p>';
  const left = '<w:p><w:r><w:t xml:space="preserve">Centered</w:t></w:r></w:p>';
  const run = async (body: string): Promise<number> => {
    const result = await exportPdf(docx(`${body}${SECTION}`), { useSystemFonts: false });
    expect(result.diagnostics).toEqual([]);
    const xs = await glyphPositions(result.bytes);
    expect(xs.length).toBeGreaterThan(0);
    return xs[0]!;
  };
  const centeredX = await run(centered);
  const leftX = await run(left);
  // The edge is rounded once, so the left-aligned start lands on the grid and the centered
  // start, measured from that same rounded edge, does not.
  expect(onGrid(leftX)).toBe(true);
  expect(onGrid(centeredX)).toBe(false);
  expect(centeredX).toBeGreaterThan(leftX);
});

test('a justified right-to-left line snaps from its text, not its hanging space', () => {
  const shaping = { script: 'Arab', direction: 'rtl', level: 1, baseLevel: 1 } as const;
  const span = (text: string, x: number, width: number, style: object = { shaping }) => ({
    text,
    box: { x, y: 0, width, height: 12 },
    style,
  });
  // The text starts at 63.8pt, off the grid; the line-end space hangs 3.18pt left of it.
  const rtl = [span('word ', 100, 27.8), span('word', 63.8, 36.2), span(' ', 60.62, 3.18)];
  const visit = (spans: readonly object[], contentX: number) =>
    ({
      paragraph: { alignment: 'both', box: { x: 63.8 } },
      storyOrigin: { x: 0, y: 0 },
      line: { contentX, spans },
    }) as unknown as Parameters<typeof paragraphGridOffsetX>[0];
  const snap = (origin: number) => Math.round(origin / GRID) * GRID - origin;
  expect(paragraphGridOffsetX(visit(rtl, 60.62))).toBeCloseTo(snap(63.8), 9);
  expect(onGrid(63.8 + paragraphGridOffsetX(visit(rtl, 60.62)))).toBe(true);
  // A line without a hanging space, and a left-to-right line, snap from `contentX`.
  expect(paragraphGridOffsetX(visit(rtl.slice(0, 2), 63.8))).toBeCloseTo(snap(63.8), 9);
  const ltr = [span('word ', 60.62, 30, {}), span(' ', 90.62, 3, {})];
  expect(paragraphGridOffsetX(visit(ltr, 60.62))).toBeCloseTo(snap(60.62), 9);
});
