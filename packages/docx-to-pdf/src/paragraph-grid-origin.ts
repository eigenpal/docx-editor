/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { SemanticSpanVisit } from '@docx-editor.dev/core/layout';

/** Device grid the reference paints on: 1/300 inch. */
const PDF_PAINT_GRID_PT = 0.24;

/**
 * Horizontal shift that puts a paragraph's content origin on the device grid.
 *
 * The reference rounds a paragraph's left edge to the same 0.24pt grid it puts baselines on,
 * then advances every glyph on the line from there by exact widths. That is why a
 * left-aligned line starts on the grid while a centered line on the same page does not: the
 * centering is measured from the rounded edge, not rounded itself. Returning one offset per
 * paragraph, rather than rounding each span, keeps the spacing inside a line exact.
 *
 * Measured on `issue-483-firstline-marker.docx`, where the reference starts its body text at
 * 63.84pt and the authored margin is 63.8pt, and on `repeated-table-header.docx`, where 92 of
 * 93 reference line starts land on the grid and none of ours did.
 */
export function paragraphGridOffsetX(visit: SemanticSpanVisit): number {
  const left = visit.storyOrigin.x + visit.paragraph.box.x;
  return Math.round(left / PDF_PAINT_GRID_PT) * PDF_PAINT_GRID_PT - left;
}
