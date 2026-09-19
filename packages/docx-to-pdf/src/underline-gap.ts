/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { styleForFontSlot, type SemanticSpanVisit } from '@docx-editor.dev/core/layout';

/** Adapted from PR #707's underline absorption plan (2ce89f6e7).
 * Extend a single underline over published inter-word justification, not arbitrary gaps.
 * Core retains every glyph position; only the underline fill grows.
 */
export function underlineGap(visit: Pick<SemanticSpanVisit, 'line' | 'span'>): number {
  const { line, span } = visit;
  const index = line.spans.indexOf(span);
  if (index < 0 || (line.drawings?.length ?? 0) > 0) return 0;
  const next = line.spans[index + 1];
  if (!next || next.style.hidden || next.equation || next.text.includes('\t')) return 0;
  if (!span.text.endsWith(' ') || /\s/u.test(span.text.slice(0, -1))) return 0;
  if ((next.wrapAdvanceBefore ?? 0) > 0.001 || span.link !== next.link) return 0;
  if (span.range.paragraphId !== next.range.paragraphId) return 0;
  if (span.revisions?.length || next.revisions?.length) return 0;
  const left = styleForFontSlot(span.style, span.fontSlot);
  const right = styleForFontSlot(next.style, next.fontSlot);
  if (left.underline?.variant !== 'single' || right.underline?.variant !== 'single') return 0;
  if (left.horizontalScalePercent !== 100 || right.horizontalScalePercent !== 100) return 0;
  if (left.shaping?.baseLevel === 1 || right.shaping?.baseLevel === 1) return 0;
  if (
    left.fontFamily !== right.fontFamily ||
    left.fontSizePt !== right.fontSizePt ||
    left.bold !== right.bold ||
    left.italic !== right.italic ||
    left.verticalAlign !== right.verticalAlign ||
    left.baselineShiftPt !== right.baselineShiftPt ||
    (left.underline.color ?? left.color) !== (right.underline.color ?? right.color)
  )
    return 0;
  const gap = next.box.x - (span.box.x + span.box.width);
  return gap > 0.25 ? gap : 0;
}
