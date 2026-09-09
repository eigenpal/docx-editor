/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { StyleSpanRecord } from '@docx-editor.dev/core/layout';

/** Visible hyphen painted at a discretionary break — never stored in span.text. */
const DISCRETIONARY_HYPHEN_GLYPH = '-';
import type { PdfRect, PdfTextSpanCommand } from './pdf-paint-types.ts';
import { pdfTextSpan } from './pdf-paint-types.ts';
import type { PdfTextStyle } from './pdf-text-style.ts';

/** Width reserved for span.text, excluding a trailing discretionary hyphen. */
export function spanTextWidthPt(span: StyleSpanRecord, fullWidthPt: number): number {
  const hyphenWidth = span.discretionaryHyphen?.widthPt ?? 0;
  if (!(hyphenWidth > 0)) return fullWidthPt;
  return Math.max(0, fullWidthPt - hyphenWidth);
}

/** Page-relative rect for the layout-only hyphen at the end of one span box. */
export function discretionaryHyphenRect(fullRect: PdfRect, span: StyleSpanRecord): PdfRect | null {
  const hyphenWidth = span.discretionaryHyphen?.widthPt ?? 0;
  if (!(hyphenWidth > 0)) return null;
  return Object.freeze({
    x: fullRect.x + fullRect.width - hyphenWidth,
    y: fullRect.y,
    width: hyphenWidth,
    height: fullRect.height,
  });
}

/** Build the text-span command for a discretionary hyphen, or null when absent. */
export function plannedDiscretionaryHyphenCommand(
  fullRect: PdfRect,
  baseline: number,
  span: StyleSpanRecord,
  textStyle: PdfTextStyle
): PdfTextSpanCommand | null {
  const rect = discretionaryHyphenRect(fullRect, span);
  if (!rect) return null;
  return pdfTextSpan(rect, baseline, DISCRETIONARY_HYPHEN_GLYPH, textStyle);
}
