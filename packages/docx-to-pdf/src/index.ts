/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Node-first DOCX-to-PDF conversion and reusable font-backed sessions. @packageDocumentation */
export { exportPdf, exportPdfFrom } from './export-pdf.ts';
export { openDocumentForExport } from './pdf-session.ts';
export {
  PdfDocumentOpenError,
  PdfEncodingError,
  PdfFidelityError,
  PdfOutputLimitError,
  PdfPageLimitError,
} from './types.ts';
export { PdfWorkLimitError } from './context.ts';
export type {
  PdfDiagnostic,
  PdfExportOptions,
  PdfExportResult,
  PdfExportTimings,
  PdfFontOrigin,
  PdfFontsSource,
  PdfProjectionOptions,
  PdfExportSession,
  OpenPdfDocumentForExportOptions,
  OpenPdfDocumentForExportResult,
} from './types.ts';
export { createFontSource, defineFontResolver } from '@docx-editor.dev/core/editor';
export type {
  ExportFontResolutionReport,
  ExportFontFaceResolution,
  ExportFontFamilyResolution,
  FontOriginFailure,
  ExportDroppedEmbeddedFont,
} from '@docx-editor.dev/core/export';
export type {
  FontRequest,
  FontSubstitution,
  RevisionDisplayMode,
} from '@docx-editor.dev/core/layout';
export type { HeadlessDocumentRejection } from '@docx-editor.dev/core/store';
export { ExportResourceError } from '@docx-editor.dev/core/export';
