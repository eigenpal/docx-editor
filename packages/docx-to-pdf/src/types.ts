/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type {
  ExportFontResolutionReport,
  FontBackedExportCapabilities,
  OpenFontBackedDocumentForExportResult,
  OpenFontBackedDocumentForExportOptions,
} from '@docx-editor.dev/core/export';
import type { FontOrigin } from '@docx-editor.dev/core/editor';
import type { HeadlessDocumentRejection } from '@docx-editor.dev/core/store';
import type { RevisionDisplayMode } from '@docx-editor.dev/core/layout';

/** A bounded explanation of content the PDF cannot reproduce. @public */
export interface PdfDiagnostic {
  /** Machine-readable diagnostic identifier. Handle unknown codes by severity. */
  readonly code: string;
  /** Human-readable explanation. Do not use this text for program control. */
  readonly message: string;
  /** Zero-based page index. Omitted for document-wide diagnostics. */
  readonly pageIndex?: number;
  /** One-based page number for display, consistent with Markdown warnings. */
  readonly pageNumber?: number;
  /** Failed font source index, when this diagnostic describes a source failure. */
  readonly originIndex?: number;
  /** Failed font source name, when the source provided one. */
  readonly originName?: string;
  /** Strict export permits only information diagnostics. */
  readonly severity: 'unsupported' | 'approximation' | 'information';
}
/** A font configuration or document-aware resolver. @public */
export type PdfFontOrigin = FontOrigin;
/** Ordered font configurations or resolvers. Earlier sources take priority. @public */
export type PdfFontsSource = PdfFontOrigin | readonly PdfFontOrigin[];
/** Node conversion controls. Font substitution follows Core's independent fontPolicy. @public */
export interface PdfExportOptions extends Omit<
  OpenFontBackedDocumentForExportOptions,
  'fonts' | 'measurer' | 'producer' | 'reuseAcrossRevisions'
> {
  /** Revision display mode. Defaults to proposed. */
  readonly displayMode?: RevisionDisplayMode;
  /** Apply optional document ligatures during measurement and output. Defaults to true. */
  readonly documentLigatures?: boolean;
  /** Sources after embedded fonts and before the built-in generic substitutes. */
  readonly lastResortFonts?: PdfFontsSource;
  /** Use installed Word fonts before packaged substitutes. Defaults to true. */
  readonly useSystemFonts?: boolean;
  /** Font sources before installed and packaged fonts. */
  readonly fonts?: PdfFontsSource;
  /** Font sources after packaged fonts and before embedded fonts. */
  readonly fallbackFonts?: PdfFontsSource;
  /** Reject unsupported or approximate content by default. */
  readonly fidelityPolicy?: 'strict' | 'best-effort';
  /** Include native PDF comment annotations. Defaults to true. */
  readonly comments?: boolean;
  /** Cooperative conversion deadline. Defaults to 60000 milliseconds. */
  readonly timeoutMs?: number;
  /** Maximum encoded bytes, from 1 to 67108864. Defaults to 67108864. */
  readonly maxOutputBytes?: number;
  /** Maximum output pages, from 1 to 10000. Checked after layout. Defaults to 10000. */
  readonly maxPages?: number;
}
/** Elapsed milliseconds for each conversion phase. @public */
export interface PdfExportTimings {
  readonly openMs: number;
  readonly layoutMs: number;
  readonly paintMs: number;
  readonly saveMs: number;
}
/** Result owns its bytes; mutating them does not affect a session or subsequent export. @public */
export interface PdfExportResult {
  /** Owned, mutable PDF bytes. Use application/pdf when serving them. */
  readonly bytes: Uint8Array;
  /** Physical PDF page count. */
  readonly pageCount: number;
  /** Layout revision for this conversion; not a persistent document identifier. */
  readonly layoutRevision: number;
  /** Revision display mode applied to the document. */
  readonly displayMode: RevisionDisplayMode;
  /** Selected faces, substitutions, and failed font sources. */
  readonly fontResolution: ExportFontResolutionReport;
  /** Immutable output limitations and informational notices. */
  readonly diagnostics: readonly PdfDiagnostic[];
  /** Wall-clock milliseconds spent opening and resolving fonts, laying out, painting, and saving. */
  readonly timings: PdfExportTimings;
}
/** Requested content could not be represented faithfully. @public */
export class PdfFidelityError extends Error {
  readonly code = 'fidelityUnsupported';
  constructor(readonly diagnostics: readonly PdfDiagnostic[]) {
    super('PDF export cannot faithfully represent all requested content');
    this.name = 'PdfFidelityError';
  }
}
/** Core refused the input package. @public */
export class PdfDocumentOpenError extends Error {
  readonly code = 'documentOpenFailed';
  constructor(
    readonly reason: HeadlessDocumentRejection | 'aborted',
    readonly detail?: string
  ) {
    super(`Cannot open DOCX: ${reason}${detail ? `: ${detail}` : ''}`);
    this.name = 'PdfDocumentOpenError';
  }
}
/** PDF encoding failed after a document was opened. @public */
export class PdfEncodingError extends Error {
  readonly code: 'encodingFailed' | 'outputTooLarge' = 'encodingFailed';
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PdfEncodingError';
  }
}

/** Encoded output exceeds the configured byte limit. @public */
export class PdfOutputLimitError extends PdfEncodingError {
  override readonly code = 'outputTooLarge';
  constructor(
    readonly limit: number,
    readonly actual: number
  ) {
    super(`PDF exceeds maxOutputBytes (${limit}); encoded ${actual} bytes`);
    this.name = 'PdfOutputLimitError';
  }
}
/** Layout exceeds the configured page limit. @public */
export class PdfPageLimitError extends RangeError {
  readonly code = 'pageLimitExceeded';
  constructor(
    readonly limit: number,
    readonly actual: number
  ) {
    super(`PDF exceeds maxPages (${limit}); laid out ${actual} pages`);
    this.name = 'PdfPageLimitError';
  }
}

/** Output controls for a caller-owned PDF session. @public */
export type PdfProjectionOptions = Pick<
  PdfExportOptions,
  | 'comments'
  | 'fidelityPolicy'
  | 'timeoutMs'
  | 'maxOutputBytes'
  | 'maxPages'
  | 'signal'
  | 'displayMode'
>;
/** Font and layout controls for a reusable immutable-byte session. @public */
export type OpenPdfDocumentForExportOptions = Omit<
  PdfExportOptions,
  'comments' | 'fidelityPolicy' | 'timeoutMs' | 'maxOutputBytes' | 'maxPages'
>;
/** Session that retains the admitted fonts and glyph capabilities needed by PDF output. @public */
export type PdfExportSession = FontBackedExportCapabilities;
/** Open result with the same success/refusal shape as Markdown sessions. @public */
export type OpenPdfDocumentForExportResult = OpenFontBackedDocumentForExportResult;
