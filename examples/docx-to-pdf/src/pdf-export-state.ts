/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
export type PdfStatus = 'idle' | 'converting' | 'ready' | 'stale' | 'error';

export interface PdfDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly pageIndex?: number;
}

export interface PdfConversion {
  readonly url: string;
  readonly bytes: number;
  readonly pageCount: number;
  readonly diagnostics: readonly PdfDiagnostic[];
}

/** The block-id deltas an authored commit carries; a plain mount carries none. */
export interface DocumentChangeProvenance {
  readonly created?: readonly string[];
  readonly deleted?: readonly string[];
  readonly dirty?: readonly string[];
}

/**
 * Whether an editor change should mark the preview stale.
 *
 * Core emits one provenance-free change when a new document mounts so subscribed hosts
 * re-read it. That is the load this demo just asked for, not an edit, and treating it as one
 * would light Regenerate on a preview that is already current.
 */
export function shouldMarkStale(change: DocumentChangeProvenance): boolean {
  return change.created !== undefined || change.deleted !== undefined || change.dirty !== undefined;
}

/** What the preview pane says while it has nothing to show. */
export function emptyStateMessage(status: PdfStatus, error: string | null): string {
  if (status === 'error') return error ?? 'The document could not be converted.';
  if (status === 'converting') return 'Generating PDF…';
  return 'Select Generate PDF to convert the document on the left.';
}

/** Label for the generate control, which doubles as the stale-preview affordance. */
export function generateLabel(status: PdfStatus, hasResult: boolean): string {
  if (status === 'converting') return 'Generating…';
  return hasResult ? 'Regenerate PDF' : 'Generate PDF';
}

const UNITS = ['B', 'kB', 'MB'] as const;

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit]}`;
}
