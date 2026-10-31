/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The one font profile that evaluation exports, traces and page summaries open with, so the
 * three commands lay out the same text in the same faces.
 *
 * `Segoe UI Symbol` comes first, as in the renderer's default list. Without it, a symbol the
 * text faces lack (a ☐ check box, for example) draws in Noto Sans Symbols 2 with that face's
 * own 1.7 em line instead of the 1.33 em line of the face it stands in for, and every such
 * line pushes the text below it down.
 */
export const EVALUATION_FONT_PROFILE = {
  displayMode: 'proposed' as const,
  useSystemFonts: false,
  glyphFallbacks: [
    'Segoe UI Symbol',
    'Noto Sans Symbols 2',
    'Noto Sans Math',
    'Noto Sans Arabic',
    'Times New Roman',
    'Noto Sans CJK JP',
    'Twemoji Mozilla',
    'Noto Emoji',
  ].map((family) => ({ family, weight: 400, style: 'normal' as const })),
};
