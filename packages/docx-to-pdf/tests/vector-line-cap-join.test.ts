/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import type { SemanticDrawingVisit } from '@docx-editor.dev/core/layout';
import { paintVectorShape } from '../src/vector-shapes.ts';
import { Work } from '../src/context.ts';

async function paint(cap?: 'butt' | 'round' | 'square', join?: 'round' | 'bevel') {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  const bounds = { x: 10, y: 10, width: 10, height: 10 };
  const visit = {
    drawing: {
      x: 10,
      y: 10,
      paintBounds: bounds,
      accessibility: { hidden: false },
      hyperlinkHref: null,
      geometry: { contentBounds: bounds },
      vectorShape: {
        extentEmu: { cx: 127000, cy: 127000 },
        components: [
          {
            subpathsEmu: [
              [
                { x: 0, y: 0 },
                { x: 127000, y: 127000 },
              ],
            ],
            subpathsClosed: [false],
            fillHex: null,
            fillAlpha: 1,
            strokeHex: '112233',
            strokeAlpha: 1,
            strokeWidthEmu: 25400,
            ...(cap ? { strokeCap: cap } : {}),
            ...(join ? { strokeJoin: join } : {}),
          },
        ],
      },
    },
    absolutePaintBounds: bounds,
    drawingOrigin: { x: 10, y: 10 },
    page: { box: { x: 0, y: 0 } },
  } as unknown as SemanticDrawingVisit;
  return paintVectorShape(doc, page, visit, new Work(new AbortController().signal));
}

test('PDF uses round cap and bevel join with the unchanged source width', async () => {
  const commands = await paint('round', 'bevel');
  expect(commands).toContain('1 J 2 j');
  expect(commands).toContain('2 w');
  expect(commands).toContain('0 0 m 10 10 l');
  expect(commands).toContain('S');
});

test('PDF resets every component to authored square and round properties', async () => {
  expect(await paint('square', 'round')).toContain('2 J 1 j');
  expect(await paint()).toContain('0 J 0 j');
});
