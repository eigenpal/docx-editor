/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDF_GLYPH_FALLBACKS } from '../../src/font-provisioning.ts';

/**
 * The one font profile that evaluation exports, traces and page summaries open with, so the
 * three commands lay out the same text in the same faces.
 *
 * The glyph fallbacks are the renderer's default list itself, so evaluation measures what an
 * export does. `Segoe UI Symbol` leads it: without that face first, a symbol the text faces
 * lack (a ☐ check box, for example) draws in Noto Sans Symbols 2 with that face's own 1.7 em
 * line instead of the 1.33 em line of the face it stands in for, and every such line pushes the
 * text below it down.
 */
export const EVALUATION_FONT_PROFILE = {
  displayMode: 'proposed' as const,
  useSystemFonts: false,
  glyphFallbacks: PDF_GLYPH_FALLBACKS,
};
