/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type {
  ExportFontResolutionReport,
  OpenFontBackedDocumentForExportOptions,
} from '@docx-editor.dev/core/export';
import type { RevisionDisplayMode } from '@docx-editor.dev/core/layout';

/** A bounded explanation of content the PDF cannot reproduce. @public */
export interface PdfDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly pageIndex?: number;
  readonly severity: 'unsupported' | 'approximation' | 'information';
}
/** Node conversion controls. Font substitution follows Core's independent fontPolicy. @public */
export interface PdfExportOptions extends Omit<
  OpenFontBackedDocumentForExportOptions,
  'fonts' | 'measurer' | 'producer' | 'reuseAcrossRevisions'
> {
  /** Use installed Word fonts before packaged substitutes. Defaults to true. */
  readonly useSystemFonts?: boolean;
  readonly fonts?: OpenFontBackedDocumentForExportOptions['fonts'];
  readonly fallbackFonts?: OpenFontBackedDocumentForExportOptions['fonts'];
  readonly fidelityPolicy?: 'strict' | 'best-effort';
  readonly comments?: boolean;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}
/** Result owns its bytes; mutating them does not affect a session or subsequent export. @public */
export interface PdfExportResult {
  readonly bytes: Uint8Array;
  readonly pageCount: number;
  readonly layoutRevision: number;
  readonly displayMode: RevisionDisplayMode;
  readonly fontResolution: ExportFontResolutionReport;
  readonly diagnostics: readonly PdfDiagnostic[];
  /** Wall-clock milliseconds spent opening and resolving fonts, laying out, painting, and saving. */
  readonly timings: {
    readonly openMs: number;
    readonly layoutMs: number;
    readonly paintMs: number;
    readonly saveMs: number;
  };
}
/** Requested content could not be represented faithfully. @public */
export class PdfFidelityError extends Error {
  constructor(readonly diagnostics: readonly PdfDiagnostic[]) {
    super('PDF export cannot faithfully represent all requested content');
    this.name = 'PdfFidelityError';
  }
}
/** Core refused the input package. @public */
export class PdfDocumentOpenError extends Error {
  constructor(
    readonly reason: string,
    readonly detail?: string
  ) {
    super(`Cannot open DOCX: ${reason}${detail ? `: ${detail}` : ''}`);
    this.name = 'PdfDocumentOpenError';
  }
}
/** PDF encoding failed after a document was opened. @public */
export class PdfEncodingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PdfEncodingError';
  }
}
