/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { SemanticSpanVisit } from '@docx-editor.dev/core/layout';

/** Device grid the reference paints on: 1/300 inch. */
const PDF_PAINT_GRID_PT = 0.24;

/**
 * Where a justified line's text starts. A right-to-left line can place its trailing
 * whitespace before the text. Use the leftmost text span before that logical tail,
 * keeping a leading inline picture out of the text origin.
 */
function justifiedTextStartX(line: SemanticSpanVisit['line']): number {
  const spans = line.spans;
  if (!spans.some((span) => span.style.shaping?.baseLevel === 1)) return textStartX(line);
  let end = spans.length;
  while (end > 0 && spans[end - 1]!.text.trim() === '') end -= 1;
  if (end === 0 || end === spans.length) return textStartX(line);
  let start = Infinity;
  for (let index = 0; index < end; index += 1) start = Math.min(start, spans[index]!.box.x);
  return start;
}

/**
 * Horizontal shift that puts a line's text origin on the device grid.
 *
 * The reference rounds a text origin to the same 0.24pt grid it puts baselines on, then
 * advances every glyph from there by exact widths. Returning one offset per line, rather
 * than rounding each span, keeps the spacing inside a line exact.
 *
 * WHICH origin it rounds depends on alignment. For a left-aligned or justified line it is
 * where the text actually starts, the leftmost span, which already carries the indent and any
 * float exclusion and is measured from the story origin. On page 5 of
 * `float-wrap-comprehensive-test.docx` those lines start at exact half units — 381.00, 177.00
 * and 171.00 — and the reference paints 381.12, 177.12 and 171.12. One at 103.50 rounds the
 * other way to 103.44, and the reference agrees.
 *
 * For a centered or right-aligned line the reference rounds only the paragraph EDGE and
 * measures the alignment from there without rounding again. The title of
 * `issue-483-firstline-marker.docx` starts at 190.733, off the grid, while the body text of
 * the same document starts at 63.84, on it.
 *
 * Span boxes are relative to the story origin, so the paragraph and line boxes are NOT added:
 * inside a table cell all three carry the same cell offset, and adding them counts it twice.
 */
export function paragraphGridOffsetX(visit: SemanticSpanVisit): number {
  const alignment = visit.paragraph.alignment;
  const origin =
    alignment === 'both'
      ? visit.storyOrigin.x + justifiedTextStartX(visit.line)
      : alignment === 'left'
        ? visit.storyOrigin.x + textStartX(visit.line)
        : visit.storyOrigin.x + visit.paragraph.box.x;
  return Math.round(origin / PDF_PAINT_GRID_PT) * PDF_PAINT_GRID_PT - origin;
}

/**
 * Where a line's text starts: its leftmost span.
 *
 * `contentX` is the line's content origin, which is a leading inline picture's edge when a
 * picture comes first. A line with no text has only that origin.
 */
function textStartX(line: SemanticSpanVisit['line']): number {
  const known = textStarts.get(line);
  if (known !== undefined) return known;
  let x = Infinity;
  for (const span of line.spans) x = Math.min(x, span.box.x);
  const start = Number.isFinite(x) ? x : line.contentX;
  textStarts.set(line, start);
  return start;
}

const textStarts = new WeakMap<SemanticSpanVisit['line'], number>();
