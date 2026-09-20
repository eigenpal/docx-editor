/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { SemanticSpanVisit } from '@docx-editor.dev/core/layout';

/** Device grid the reference paints on: 1/300 inch. */
const PDF_PAINT_GRID_PT = 0.24;

/**
 * Horizontal shift that puts a line's text origin on the device grid.
 *
 * The reference rounds a text origin to the same 0.24pt grid it puts baselines on, then
 * advances every glyph from there by exact widths. Returning one offset per line, rather
 * than rounding each span, keeps the spacing inside a line exact.
 *
 * WHICH origin it rounds depends on alignment. For a left-aligned or justified line it is
 * where the text actually starts, `contentX`, which already carries the indent and any float
 * exclusion and is measured from the story origin. On page 5 of
 * `float-wrap-comprehensive-test.docx` those lines start at exact half units — 381.00, 177.00
 * and 171.00 — and the reference paints 381.12, 177.12 and 171.12. One at 103.50 rounds the
 * other way to 103.44, and the reference agrees.
 *
 * For a centered or right-aligned line the reference rounds only the paragraph EDGE and
 * measures the alignment from there without rounding again. The title of
 * `issue-483-firstline-marker.docx` starts at 190.733, off the grid, while the body text of
 * the same document starts at 63.84, on it.
 *
 * `contentX` is relative to the story origin, so the paragraph and line boxes are NOT added:
 * inside a table cell all three carry the same cell offset, and adding them counts it twice.
 */
export function paragraphGridOffsetX(visit: SemanticSpanVisit): number {
  const alignment = visit.paragraph.alignment;
  const origin =
    alignment === 'left' || alignment === 'both'
      ? visit.storyOrigin.x + visit.line.contentX
      : visit.storyOrigin.x + visit.paragraph.box.x;
  return Math.round(origin / PDF_PAINT_GRID_PT) * PDF_PAINT_GRID_PT - origin;
}
