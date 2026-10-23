/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Picture effects that need a soft mask: soft edges, and the fade of a reflection. Each mask
// is a luminosity group in page space, so the graphics state that selects it must be set
// before any transform.
import { PDFName, type PDFDocument, type PDFPage, type PDFRef } from 'pdf-lib';
import { flateStream, number as n, pageHeight } from './context.ts';

type Point = Readonly<{ x: number; y: number }>;

/** Bands of a soft edge, as shares of its radius from the edge, and their opacity. */
const SOFT_EDGE_BANDS = 8;
const SOFT_EDGE_REACH = 1.8;

/** The standard normal distribution function (Abramowitz and Stegun 7.1.26). */
function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

function maskState(doc: PDFDocument, page: PDFPage, content: string, shading?: PDFRef): string {
  const width = page.getWidth();
  const height = pageHeight(page);
  const group = doc.context.register(
    flateStream(doc.context, content, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, width, height],
      Group: { Type: 'Group', S: 'Transparency', CS: 'DeviceGray' },
      Resources: doc.context.obj(shading ? { Shading: { Sh: shading } } : {}),
    })
  );
  const state = doc.context.register(
    doc.context.obj({
      Type: 'ExtGState',
      SMask: { Type: 'Mask', S: 'Luminosity', G: group },
    })
  );
  const name = `PictureMask${state.objectNumber}`;
  page.node.setExtGState(PDFName.of(name), state);
  return `/${name} gs `;
}

/**
 * A soft mask that fades the picture out over `radius` points inside the outline `clip`, in
 * page space: clear at the edge, half at nine tenths of the radius, whole beyond it, drawn as
 * nested bands of the outline stroked in grey.
 */
export function softEdgeMask(
  doc: PDFDocument,
  page: PDFPage,
  clip: readonly Point[],
  radius: number
): string {
  if (!(radius > 0) || clip.length < 3) return '';
  const path = clip.map((v, i) => `${n(v.x)} ${n(v.y)} ${i === 0 ? 'm' : 'l'}`).join(' ') + ' h';
  const out = [`${path} W n 1 g ${path} f 1 j`];
  const sigma = 0.32 * radius;
  for (let band = SOFT_EDGE_BANDS - 1; band >= 0; band -= 1) {
    const inner = ((band + 1) / SOFT_EDGE_BANDS) * SOFT_EDGE_REACH * radius;
    const middle = ((band + 0.5) / SOFT_EDGE_BANDS) * SOFT_EDGE_REACH * radius;
    const grey = phi((middle - 0.9 * radius) / sigma);
    out.push(`${n(grey)} G ${n(inner * 2)} w ${path} S`);
  }
  return maskState(doc, page, out.join('\n'));
}

/**
 * A soft mask for a reflection that starts at page height `top` and fades to `end`, from
 * `startAlpha` to `endAlpha`; nothing shows past `end`.
 */
export function reflectionMask(
  doc: PDFDocument,
  page: PDFPage,
  top: number,
  end: number,
  startAlpha: number,
  endAlpha: number
): string {
  const shading = doc.context.obj({
    ShadingType: 2,
    ColorSpace: 'DeviceGray',
    Coords: [0, top, 0, end],
    Function: { FunctionType: 2, Domain: [0, 1], C0: [startAlpha], C1: [endAlpha], N: 1 },
    Extend: [false, false],
  });
  return maskState(doc, page, '/Sh sh', doc.context.register(shading));
}
