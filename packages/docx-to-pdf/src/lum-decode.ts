/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Picture brightness and contrast on an embedded image, as its `Decode` array.
//
// The transfer is `out = slope * in + intercept` per sRGB channel. A `Decode` range of
// `[intercept, slope + intercept]` maps each sample the same way, and the colour space clamps
// the result, so the image keeps its encoded samples. Shared by raster pictures and the
// images inside metafile pictures, so both take the adjustment the same way.

import { PDFName, PDFStream, type PDFDocument, type PDFRef } from 'pdf-lib';
import type { LumTransfer } from '@docx-editor.dev/core/output';

/**
 * Set the transfer as the embedded image's `Decode` array. False, with the image unchanged,
 * when its samples are not `DeviceRGB` or `DeviceGray` channels or it already has a `Decode`.
 */
export function decodeThroughTransfer(
  doc: PDFDocument,
  ref: PDFRef,
  transfer: LumTransfer
): boolean {
  const stream = doc.context.lookup(ref);
  const dict = stream instanceof PDFStream ? stream.dict : null;
  const space = dict?.get(PDFName.of('ColorSpace'));
  const components =
    space === PDFName.of('DeviceRGB') ? 3 : space === PDFName.of('DeviceGray') ? 1 : 0;
  if (!dict || !components || dict.get(PDFName.of('Decode'))) return false;
  const low = transfer.intercept;
  const high = transfer.slope + transfer.intercept;
  dict.set(
    PDFName.of('Decode'),
    doc.context.obj(Array.from({ length: components }, () => [low, high]).flat())
  );
  return true;
}
