/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { outlineOperators, type OutlinePlacement } from '../src/outline-placement.ts';

const at = (x: number, scale: number): OutlinePlacement => ({
  state: '0 0 0 rg ',
  a: scale,
  c: 0,
  d: scale,
  x,
  y: 700,
  form: 'F1G1',
});

test('near outlines share one matrix and move by short translations', () => {
  const ops = outlineOperators([at(72, 0.01), at(80, 0.01)]);
  expect(ops.match(/^q /gm)).toHaveLength(1);
  expect(ops).toContain('1 0 0 1 800 0 cm /F1G1 Do');
});

test('a move outside the formatter range starts a new group instead of throwing', () => {
  // 7pt at unitsPerEm 16384: a page-width move is millions of glyph units.
  const scale = 7 / 16384;
  expect(() => outlineOperators([at(72, scale), at(540, scale)])).not.toThrow();
  expect(outlineOperators([at(72, scale), at(540, scale)]).match(/^q /gm)).toHaveLength(2);
});

test('a zero scale never divides into a relative move', () => {
  expect(() => outlineOperators([at(72, 0), at(80, 0)])).not.toThrow();
});
