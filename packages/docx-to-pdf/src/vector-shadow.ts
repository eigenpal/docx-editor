/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDFName, type PDFDocument, type PDFPage } from 'pdf-lib';
import type { VectorShapeComponent } from '@docx-editor.dev/core/layout';
import { color, number as n } from './context.ts';

/** Translucent copies that approximate the blur; more add file size, not visible quality. */
const SHADOW_LAYERS = 4;

/**
 * An outer shadow under one component: its silhouette offset, in the shadow colour. PDF has
 * no blur here, so the edge softens with stacked translucent copies, each grown by a wider
 * round stroke, reaching half the blur radius past the silhouette.
 */
export function shadowOps(
  doc: PDFDocument,
  page: PDFPage,
  component: VectorShapeComponent,
  geometry: string,
  unit: number
): string {
  const shadow = component.shadow;
  if (!shadow || (component.fillHex === null && component.strokeHex === null)) return '';
  const layers = shadow.blurEmu > 0 ? SHADOW_LAYERS : 1;
  const alpha = Math.max(0, Math.min(1, shadow.alpha)) / layers;
  const state = doc.context.register(doc.context.obj({ Type: 'ExtGState', ca: alpha, CA: alpha }));
  const stateName = `ShapeShadow${state.objectNumber}`;
  page.node.setExtGState(PDFName.of(stateName), state);
  const paint = `${color(shadow.hex)} rg ${color(shadow.hex)} RG`;
  const out = [`q /${stateName} gs 1 J 1 j ${paint}`];
  out.push(`1 0 0 1 ${n(shadow.dxEmu / unit)} ${n(shadow.dyEmu / unit)} cm`);
  const baseWidth = component.strokeHex !== null ? Math.max(1, component.strokeWidthEmu) : 0;
  for (let layer = 0; layer < layers; layer += 1) {
    const reach = layers > 1 ? (shadow.blurEmu * layer) / (2 * (layers - 1)) : 0;
    const width = baseWidth + 2 * reach;
    if (width > 0) out.push(`${n(width / unit)} w`);
    const op = component.fillHex !== null ? (width > 0 ? 'B*' : 'f*') : 'S';
    out.push(geometry, op);
  }
  out.push('Q');
  return out.join('\n');
}
