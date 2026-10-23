/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDFName, type PDFDocument, type PDFPage } from 'pdf-lib';
import type { VectorShapeComponent } from '@docx-editor.dev/core/layout';
import { color, number as n } from './context.ts';

/** Rings grown around the silhouette, at these multiples of the blur's standard deviation. */
const RING_REACH = [0.25, 0.5, 0.75, 1, 1.25, 1.5];

/**
 * An outer shadow under one component: its silhouette offset, in the shadow colour. PDF has no
 * blur here, so the edge is a stepped Gaussian: the silhouette at half the shadow's opacity,
 * then six rings that each add a twelfth, so the edge carries half the opacity and fades out
 * over one and a half standard deviations.
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
  const opacity = Math.max(0, Math.min(1, shadow.alpha));
  const blurred = shadow.blurEmu > 0;
  const state = (alpha: number) => {
    const ref = doc.context.register(doc.context.obj({ Type: 'ExtGState', ca: alpha, CA: alpha }));
    const name = `ShapeShadow${ref.objectNumber}`;
    page.node.setExtGState(PDFName.of(name), ref);
    return name;
  };
  const out = [`q 1 J 1 j ${color(shadow.hex)} rg ${color(shadow.hex)} RG`];
  out.push(`1 0 0 1 ${n(shadow.dxEmu / unit)} ${n(shadow.dyEmu / unit)} cm`);
  const baseWidth = component.strokeHex !== null ? Math.max(1, component.strokeWidthEmu) : 0;
  const filled = component.fillHex !== null;
  const layer = (alpha: number, reach: number) => {
    const width = baseWidth + 2 * reach;
    out.push(`/${state(alpha)} gs`);
    if (width > 0) out.push(`${n(width / unit)} w`);
    out.push(geometry, filled ? (width > 0 ? 'B*' : 'f*') : 'S');
  };
  if (!blurred) {
    layer(opacity, 0);
  } else {
    const sigma = shadow.blurEmu / 4;
    layer(opacity / 2, 0);
    for (const reach of RING_REACH) layer(opacity / (2 * RING_REACH.length), sigma * reach);
  }
  out.push('Q');
  return out.join('\n');
}
