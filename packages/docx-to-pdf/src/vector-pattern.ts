/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDFName, type PDFDocument, type PDFPage } from 'pdf-lib';
import type { VectorPattern } from '@docx-editor.dev/core/layout';
import { color, flateStream } from './context.ts';

/**
 * Select a preset pattern as the fill colour: a coloured tiling pattern of 8 × 8 one-point
 * cells. Its space is the page's default space, so the tiles line up on an 8 pt grid from the
 * page origin wherever the shape stands. A transparent colour leaves its cells unpainted.
 */
export function patternFillOperator(
  doc: PDFDocument,
  page: PDFPage,
  pattern: VectorPattern
): string {
  const content: string[] = [];
  if (pattern.background.alpha > 0) {
    content.push(`${color(pattern.background.hex)} rg 0 0 8 8 re f`);
  }
  if (pattern.foreground.alpha > 0) {
    const cells: string[] = [];
    pattern.rows.slice(0, 8).forEach((row, y) => {
      for (let x = 0; x < 8; x += 1) {
        // Row 0 is the top of the tile, and pattern space has y up.
        if ((row >> (7 - x)) & 1) cells.push(`${x} ${7 - y} 1 1 re`);
      }
    });
    if (cells.length) content.push(`${color(pattern.foreground.hex)} rg`, ...cells, 'f');
  }
  const stream = flateStream(doc.context, content.join('\n'), {
    Type: 'Pattern',
    PatternType: 1,
    PaintType: 1,
    TilingType: 1,
    BBox: [0, 0, 8, 8],
    XStep: 8,
    YStep: 8,
    Resources: doc.context.obj({}),
  });
  const ref = doc.context.register(stream);
  const name = `ShapePattern${ref.objectNumber}`;
  const resources = page.node.Resources()!;
  let patterns = resources.lookup(PDFName.of('Pattern'));
  if (!patterns) {
    patterns = doc.context.obj({});
    resources.set(PDFName.of('Pattern'), patterns);
  }
  (patterns as import('pdf-lib').PDFDict).set(PDFName.of(name), ref);
  return `/Pattern cs /${name} scn`;
}
