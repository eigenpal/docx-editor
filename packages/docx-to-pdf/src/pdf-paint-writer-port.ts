/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { PdfFidelityDiagnostic } from './pdf-fidelity-diagnostics.ts';
import type { PdfPaintPlan } from './pdf-paint-types.ts';

/**
 * One exact face admitted by the Core export session.
 *
 * The writer receives the same bytes that layout measured. It does not own the
 * buffer, so the enclosing export must keep its session alive through encoding.
 * @internal
 */
export interface PdfAdmittedFont {
  readonly id: string;
  readonly identity: string;
  readonly family: string;
  readonly request: Readonly<{
    readonly family: string;
    readonly weight: number;
    readonly style: 'normal' | 'italic';
  }>;
  readonly byteLength: number;
  readonly hash: string;
  readonly faceIndex: number;
  readonly bytes: Uint8Array;
}

/** Optional limits forwarded into one paint-plan write. @internal */
export interface PdfPaintWriteOptions {
  readonly signal?: AbortSignal;
  readonly maxOutputBytes?: number;
  /** Exact Core-admitted face bytes, held by the caller's live export session. */
  readonly admittedFonts?: readonly PdfAdmittedFont[];
  /** Core's resolved default family for spans that omit `w:rFonts`. */
  readonly defaultFontFamily?: string;
}

/** Result of encoding one paint plan to PDF bytes. @internal */
export interface PdfPaintWriterResult {
  readonly bytes: Uint8Array;
  readonly pageCount: number;
  readonly diagnostics: readonly PdfFidelityDiagnostic[];
}

/** Narrow port that turns a validated paint plan into PDF bytes. @internal */
export interface PdfPaintWriterPort {
  write(plan: PdfPaintPlan, options?: PdfPaintWriteOptions): Promise<PdfPaintWriterResult>;
}
