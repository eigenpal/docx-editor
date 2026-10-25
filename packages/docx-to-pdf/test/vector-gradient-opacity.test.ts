/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Gradient stops of different opacity paint through a luminosity soft mask that carries the
// stop opacities, so a fade from opaque to clear does not become one uniform alpha.
import { expect, test } from 'bun:test';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import type { VectorGradient } from '@docx-editor.dev/core/layout';
import { gradientShading } from '../src/vector-gradient.ts';

const gradient = (alphas: readonly number[]): VectorGradient => ({
  kind: 'linear',
  stops: alphas.map((alpha, index) => ({
    offset: index / (alphas.length - 1),
    hex: 'FF0000',
    alpha,
  })),
  coords: [0, 0, 12700, 0],
  matrix: [1, 0, 0, 1, 0, 0],
});

async function paint(alphas: readonly number[]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const ops = gradientShading(doc, page, gradient(alphas), 12700);
  const resources = page.node.normalizedEntries().Resources;
  return { doc, ops, states: resources.lookupMaybe(PDFName.of('ExtGState'), PDFDict) };
}

test('stops of one opacity need no mask', async () => {
  const { ops, states } = await paint([0.5, 0.5]);
  expect(ops).not.toContain(' gs ');
  expect(states?.keys() ?? []).toEqual([]);
});

test('stops from opaque to clear paint through a soft mask of their opacities', async () => {
  const { doc, ops, states } = await paint([1, 0]);
  const name = /^\/(\S+) gs /.exec(ops)?.[1];
  expect(name).toBeTruthy();
  const state = states!.lookup(PDFName.of(name!), PDFDict);
  // The mask carries the opacity, so the fill itself paints fully opaque.
  expect(state.get(PDFName.of('ca'))?.toString()).toBe('1');
  const mask = state.lookup(PDFName.of('SMask'), PDFDict);
  expect(mask.get(PDFName.of('S'))).toBe(PDFName.of('Luminosity'));
  const form = mask.lookup(PDFName.of('G')) as PDFRawStream;
  expect(new TextDecoder().decode(decodePDFRawStream(form).decode())).toContain('/Mask sh');
  const shading = form.dict
    .lookup(PDFName.of('Resources'), PDFDict)
    .lookup(PDFName.of('Shading'), PDFDict)
    .lookup(PDFName.of('Mask'), PDFDict);
  expect(shading.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceGray'));
  const fn = shading.lookup(PDFName.of('Function'), PDFDict);
  expect(fn.get(PDFName.of('C0'))?.toString()).toBe('[ 1 ]');
  expect(fn.get(PDFName.of('C1'))?.toString()).toBe('[ 0 ]');
  // The document still saves with the mask in place.
  expect((await doc.save()).byteLength).toBeGreaterThan(0);
});
