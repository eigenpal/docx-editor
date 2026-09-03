/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Server-first DOCX to PDF conversion over the shared semantic layout engine.
 *
 * @packageDocumentation
 * @public
 */

export { ExportResourceError } from '@docx-editor.dev/core/export';
export { createFontSource, defineFontResolver } from '@docx-editor.dev/core/editor';
export {
  HARD_MAX_AGGREGATE_FONT_BYTES,
  HARD_MAX_FONT_BYTES,
  HARD_MAX_FONT_SOURCES,
} from '@docx-editor.dev/core/layout';

export type {
  ExportFontFaceResolution,
  ExportFontFamilyResolution,
  ExportFontResolutionReport,
  FontOrigin,
  FontOriginFailure,
  PreservedImageConverter,
} from '@docx-editor.dev/core/export';
export type { RevisionDisplayMode } from '@docx-editor.dev/core/layout';
export type { HeadlessDocumentRejection, ImageDecodePort } from '@docx-editor.dev/core/store';

export { exportPdf } from './pdf-export.ts';
export {
  PdfDocumentOpenError,
  PdfFidelityError,
  type PdfExportOptions,
  type PdfExportResult,
  type PdfFidelityPolicy,
  type PdfFontOrigin,
  type PdfFontsSource,
} from './pdf-export-types.ts';
export {
  HARD_MAX_FIDELITY_DIAGNOSTICS,
  HARD_MAX_OUTPUT_BYTES,
  HARD_MAX_PAINT_COMMANDS,
  HARD_MAX_PDF_PAGES,
  PdfPaintValidationError,
} from './pdf-paint-bounds.ts';
export type { PdfFidelityDiagnostic, PdfFidelityStoryKind } from './pdf-fidelity-diagnostics.ts';
