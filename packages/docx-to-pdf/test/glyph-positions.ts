/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Where a viewer puts each glyph on a page, in points from the left edge.
 *
 * Glyphs travel in `TJ` arrays, so a written position is the text matrix that opened the run
 * plus the widths and adjustments before the glyph. This walks the operator list the way a
 * viewer does — advance by the width the PDF declares, then apply the adjustment — so a test
 * can assert on placement without knowing how the run was cut into batches.
 */
export async function glyphPositions(bytes: Uint8Array): Promise<number[]> {
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  try {
    const list = await (await pdf.getPage(1)).getOperatorList();
    const positions: number[] = [];
    let size = 0;
    let scale = 1;
    let pen = 0;
    for (const [index, fn] of list.fnArray.entries()) {
      const args = list.argsArray[index] as unknown[];
      if (fn === OPS.setFont) size = Number(args[1]);
      if (fn === OPS.setTextMatrix) {
        // One argument, the six matrix entries.
        const matrix = args[0] as number[];
        scale = Number(matrix[0]);
        pen = Number(matrix[4]);
      }
      if (fn !== OPS.showText) continue;
      for (const item of args[0] as ({ width: number } | number)[]) {
        if (typeof item === 'number') {
          pen -= (item / 1000) * size * scale;
          continue;
        }
        positions.push(pen);
        pen += (item.width / 1000) * size * scale;
      }
    }
    return positions;
  } finally {
    await pdf.destroy();
  }
}

/**
 * The baseline each run opens at, in points from the page bottom.
 *
 * One entry per text matrix that is followed by a show operator, so a caller can assert that
 * every run laid out on one line agrees about where that line's baseline is.
 */
export async function baselineYPositions(bytes: Uint8Array): Promise<number[]> {
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  try {
    const list = await (await pdf.getPage(1)).getOperatorList();
    const baselines: number[] = [];
    let pending: number | undefined;
    for (const [index, fn] of list.fnArray.entries()) {
      const args = list.argsArray[index] as unknown[];
      if (fn === OPS.setTextMatrix) pending = Number((args[0] as number[])[5]);
      if (fn === OPS.showText && pending !== undefined) {
        baselines.push(pending);
        pending = undefined;
      }
    }
    return baselines;
  } finally {
    await pdf.destroy();
  }
}
