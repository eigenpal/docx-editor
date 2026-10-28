/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { SemanticSpanVisit } from '@docx-editor.dev/core/layout';
import { followingGapPaint } from '@docx-editor.dev/core/output';

/**
 * The gap after a span that the span owns, in points: the stretch after an inter-word space,
 * or the gap alignment opens between two characters split from one run (distributed and
 * East Asian justified lines). Screen paint draws such a gap inside the span, so the span's
 * underline, strike, highlight, shading, and revision marks run on across it; the PDF writer
 * extends the same marks by this width. Core keeps every glyph position; only the marks grow.
 *
 * Zero when the span owns no gap: the next span starts a new anchor or sits past a float
 * advance, a drawing is laid in the line, or the line is right to left.
 */
export function ownedGapAfter(visit: Pick<SemanticSpanVisit, 'line' | 'span'>): number {
  const { line, span } = visit;
  const index = line.spans.indexOf(span);
  if (index < 0 || (line.drawings?.length ?? 0) > 0) return 0;
  const next = line.spans[index + 1];
  if (!next || span.style.shaping?.baseLevel === 1 || next.style.shaping?.baseLevel === 1) return 0;
  if (followingGapPaint(span, next) === null) return 0;
  const gap = next.box.x - (span.box.x + span.box.width);
  return gap > 0.001 ? gap : 0;
}
