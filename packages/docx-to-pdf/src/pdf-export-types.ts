/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type {
  ExportFontResolutionReport,
  FontOrigin,
  PreservedImageConverter,
} from '@docx-editor.dev/core/export';
import type { RevisionDisplayMode } from '@docx-editor.dev/core/layout';
import type { HeadlessDocumentRejection, ImageDecodePort } from '@docx-editor.dev/core/store';
import type { PdfFidelityDiagnostic } from './pdf-fidelity-diagnostics.ts';

/** Strict refuses visible approximations; best-effort records them on the result. @public */
export type PdfFidelityPolicy = 'strict' | 'best-effort';

/** One caller-controlled font origin used for headless pagination. @public */
export type PdfFontOrigin = FontOrigin;

/** One font origin, or an ordered first-wins list of origins. @public */
export type PdfFontsSource = PdfFontOrigin | readonly PdfFontOrigin[];

/** Layout, resource, and fidelity controls for one-shot PDF export. @public */
export interface PdfExportOptions {
  /**
   * Revision projection applied before records reach the PDF planner. Default: `all-markup`.
   *
   * The safe reader default keeps every pending insertion and deletion visible. Choose
   * `proposed` or `original` explicitly only when a resolved view is intended.
   */
  readonly displayMode?: RevisionDisplayMode;
  /** Cancels font provisioning, layout, and PDF encoding. */
  readonly signal?: AbortSignal;
  /** Maximum time spent waiting for image resources in one layout call. Default: 60 seconds. */
  readonly resourceTimeoutMs?: number;
  /** Font provisioning deadline; defaults to `resourceTimeoutMs`, then 60 seconds. */
  readonly fontResolutionTimeoutMs?: number;
  /** `strict` refuses incomplete face coverage or any failed origin. Default: `best-effort`. */
  readonly fontPolicy?: 'best-effort' | 'strict';
  /**
   * Caller-supplied font bytes or resolvers, in first-wins order. These take precedence over the
   * package's bundled metric-compatible Word substitutes.
   */
  readonly fonts?: PdfFontsSource;
  /**
   * Opt-in origins consulted only after caller fonts and bundled substitutes. Put network-backed
   * catalogs here so they cannot crowd local faces out of the bounded family list.
   */
  readonly fallbackFonts?: PdfFontsSource;
  /**
   * Fire-and-forget evidence for the exact direct/substituted faces behind page breaks. Returned
   * promises are observed for rejection but do not delay export.
   */
  readonly onFontResolution?: (report: ExportFontResolutionReport) => void;
  /** Host image metadata decoder; omit for the bounded DOM-free Node decoder. */
  readonly imageDecodePort?: ImageDecodePort;
  /** Optional converter for preserved image formats the default decoder cannot inspect. */
  readonly convertPreservedImage?: PreservedImageConverter;
  /**
   * `strict` throws {@link PdfFidelityError} when any visible approximation or unsupported
   * diagnostic exists. Default: `best-effort`.
   */
  readonly fidelityPolicy?: PdfFidelityPolicy;
  /**
   * Maximum encoded PDF size in bytes. Default: {@link HARD_MAX_OUTPUT_BYTES}.
   * Values above that hard cap are refused before encoding starts.
   */
  readonly maxOutputBytes?: number;
}

/** Immutable one-shot PDF export metadata and bytes. @public */
export interface PdfExportResult {
  /** Encoded PDF document. */
  readonly bytes: Uint8Array;
  /** Physical page count from Core's layout snapshot. */
  readonly pageCount: number;
  /** Core store revision from which this layout snapshot was produced. */
  readonly layoutRevision: number;
  /** Tracked-change display mode used to paginate this snapshot. */
  readonly displayMode: RevisionDisplayMode;
  /** Structured font-resolution evidence captured while the Core session opened. */
  readonly fontResolution: ExportFontResolutionReport;
  /** Unsupported and approximated content that still produced these bytes. */
  readonly diagnostics: readonly PdfFidelityDiagnostic[];
}

/** Typed one-shot failure for bytes that cannot be opened as a supported DOCX. @public */
export class PdfDocumentOpenError extends Error {
  constructor(
    readonly reason: HeadlessDocumentRejection | 'aborted',
    readonly detail?: string
  ) {
    super(`Unable to open DOCX for PDF export: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'PdfDocumentOpenError';
  }
}

/** Strict-policy refusal when visible PDF output is approximated or unsupported. @public */
export class PdfFidelityError extends Error {
  constructor(readonly diagnostics: readonly PdfFidelityDiagnostic[]) {
    const first = diagnostics[0];
    super(
      first
        ? `Strict PDF export refused ${first.kind} of ${first.feature}: ${first.reason}`
        : 'Strict PDF export refused visible approximations or unsupported content'
    );
    this.name = 'PdfFidelityError';
  }
}
