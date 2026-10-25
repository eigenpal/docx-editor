/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An inset outline clips and fills with the component's own fill rule, as a plain outline
// does: a nonzero component keeps an overlapping subpath filled, an even-odd one punches it.
import { expect, test } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import type { VectorShapeComponent } from '@docx-editor.dev/core/layout';
import { vectorComponentOps } from '../src/vector-shapes.ts';

const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

async function ops(extra: Partial<VectorShapeComponent>): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const component: VectorShapeComponent = {
    subpathsEmu: [SQUARE, SQUARE],
    fillHex: 'FF0000',
    fillAlpha: 1,
    strokeHex: '0000FF',
    strokeAlpha: 1,
    strokeWidthEmu: 12700,
    strokeInset: true,
    ...extra,
  };
  return vectorComponentOps(doc, page, component, () => '0 0 m 1 1 l h', new Map());
}

const GRADIENT = {
  kind: 'linear',
  stops: [
    { offset: 0, hex: 'FF0000', alpha: 1 },
    { offset: 1, hex: '00FF00', alpha: 1 },
  ],
  coords: [0, 0, 1, 0],
  matrix: [1, 0, 0, 1, 0, 0],
} as const;

test('an inset outline over a solid fill keeps the nonzero rule', async () => {
  const nonzero = await ops({ fillRule: 'nonzero' });
  expect(nonzero).toMatch(/ W n\n/);
  expect(nonzero).toMatch(/\nB Q/);
  expect(nonzero).not.toContain('W*');
  expect(nonzero).not.toContain('B*');
  const evenOdd = await ops({});
  expect(evenOdd).toMatch(/ W\* n\n/);
  expect(evenOdd).toMatch(/\nB\* Q/);
});

test('an inset outline over a gradient fill keeps the nonzero rule', async () => {
  const nonzero = await ops({ fillRule: 'nonzero', fillGradient: GRADIENT });
  expect(nonzero).not.toContain('W*');
  expect(await ops({ fillGradient: GRADIENT })).toContain('W*');
});
