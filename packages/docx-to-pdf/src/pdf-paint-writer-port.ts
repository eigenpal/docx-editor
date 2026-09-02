import type { PdfFidelityDiagnostic } from './pdf-fidelity-diagnostics.ts';
import type { PdfPaintPlan } from './pdf-paint-types.ts';

/** Optional limits forwarded into one paint-plan write. @internal */
export interface PdfPaintWriteOptions {
  readonly signal?: AbortSignal;
  readonly maxOutputBytes?: number;
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
