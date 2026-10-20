/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { exportFontShaping, PDF_MAX_SHAPING_FONT_BYTES } from '../src/open-session.ts';

test('PDF export shapes installed faces larger than the editor default', () => {
  // SimSun ships as an 18 MB collection, above the 16 MiB editor default.
  expect(exportFontShaping({})).toEqual({ maxFontBytes: PDF_MAX_SHAPING_FONT_BYTES });
  expect(PDF_MAX_SHAPING_FONT_BYTES).toBeGreaterThan(18_008_680);
});

test('an explicit shaping limit wins', () => {
  expect(exportFontShaping({ fontShaping: { maxFontBytes: 1024 } })).toEqual({
    maxFontBytes: 1024,
  });
});

test('an empty shaping object keeps the PDF export default', () => {
  expect(exportFontShaping({ fontShaping: {} })).toEqual({
    maxFontBytes: PDF_MAX_SHAPING_FONT_BYTES,
  });
});
