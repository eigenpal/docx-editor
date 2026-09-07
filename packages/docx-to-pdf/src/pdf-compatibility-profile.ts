/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { PdfRect } from './pdf-paint-types.ts';
import type { PdfTextStyle } from './pdf-text-style.ts';

/** Optional PDF compatibility behavior. The default leaves Core geometry unchanged. @public */
export type PdfCompatibilityProfile = 'word-macos-300dpi';

/** Word for macOS PDF layout device-grid size in points. @public */
export const WORD_MACOS_300DPI_GRID_PT = 72 / 300;

/** Neutral Core policy selected by the PDF-only public profile. */
export const WORD_MACOS_300DPI_PAGE_GEOMETRY_POLICY = Object.freeze({
  unitPt: WORD_MACOS_300DPI_GRID_PT,
  rounding: 'nearest' as const,
  contentExtent: 'source-span-nearest' as const,
});

/**
 * Snap a point value to Word for macOS's 300 dpi PDF layout grid.
 *
 * Half-grid ties round away from zero. This extends Word's positive-input formula explicitly
 * to negative drawing coordinates.
 *
 * @public
 */
export function quantizeWordMacos300Dpi(valuePt: number): number {
  if (!Number.isFinite(valuePt)) return valuePt;
  const magnitude =
    Math.floor(Math.abs(valuePt) / WORD_MACOS_300DPI_GRID_PT + 0.5) * WORD_MACOS_300DPI_GRID_PT;
  return Object.is(valuePt, -0) || valuePt < 0 ? -magnitude : magnitude;
}

/**
 * Snap a footer-story baseline toward the physical bottom page edge.
 *
 * Footer flow starts from that edge. Word therefore floors the lower-left PDF
 * baseline instead of applying nearest anchor rounding.
 */
export function quantizeWordMacos300DpiFooterBaseline(valuePt: number): number {
  if (!Number.isFinite(valuePt)) return valuePt;
  const quantized = Math.floor(valuePt / WORD_MACOS_300DPI_GRID_PT) * WORD_MACOS_300DPI_GRID_PT;
  return quantized === 0 ? 0 : quantized;
}

/** Quantize an emitted story baseline with the footer's trailing-edge phase. */
export function quantizeWordMacos300DpiStoryBaseline(valuePt: number, isFooter: boolean): number {
  return isFooter
    ? quantizeWordMacos300DpiFooterBaseline(valuePt)
    : quantizeWordMacos300Dpi(valuePt);
}

/** Quantize PDF text metric inputs while preserving non-geometric style fields. */
export function compatibleWordMacos300DpiTextStyle(
  style: PdfTextStyle,
  profile: PdfCompatibilityProfile | undefined
): PdfTextStyle {
  if (profile !== 'word-macos-300dpi') return style;
  return Object.freeze({
    ...style,
    fontSizePt: quantizeWordMacos300Dpi(style.fontSizePt),
    baselineShiftPt: quantizeWordMacos300Dpi(style.baselineShiftPt),
  });
}

/** Snap both rectangle edges so adjacent fills remain adjacent. */
export function quantizeWordMacos300DpiRect(rect: PdfRect): PdfRect {
  const right = quantizeWordMacos300Dpi(rect.x + rect.width);
  const bottom = quantizeWordMacos300Dpi(rect.y + rect.height);
  const x = quantizeWordMacos300Dpi(rect.x);
  const y = quantizeWordMacos300Dpi(rect.y);
  return Object.freeze({
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  });
}

/**
 * Snap one line anchor while preserving every run's shaped advance relative to that anchor.
 */
export function quantizeWordMacos300DpiLineRect(rect: PdfRect, lineAnchorX: number): PdfRect {
  return Object.freeze({
    x: quantizeWordMacos300Dpi(lineAnchorX) + (rect.x - lineAnchorX),
    y: quantizeWordMacos300Dpi(rect.y),
    width: rect.width,
    height: rect.height,
  });
}
