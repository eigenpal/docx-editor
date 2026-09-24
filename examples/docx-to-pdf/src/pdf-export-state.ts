/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { ConversionTimings } from './conversion-response';

export type PdfStatus =
  | 'idle'
  | 'preparing'
  | 'starting'
  | 'converting'
  | 'ready'
  | 'stale'
  | 'error';

export function isPdfBusy(status: PdfStatus): boolean {
  return status === 'preparing' || status === 'starting' || status === 'converting';
}

export interface PdfDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly pageIndex?: number;
}

export interface PdfConversion {
  readonly timings?: ConversionTimings;
  readonly url: string;
  readonly bytes: number;
  readonly pageCount: number;
  readonly diagnostics: readonly PdfDiagnostic[];
  /** Converted when the demo was built, not on this request. */
  readonly cached?: boolean;
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
  if (status === 'preparing') return 'Preparing document…';
  if (status === 'starting') return 'Starting worker…';
  if (status === 'converting') return 'Generating PDF…';
  return '';
}

/** Label for the generate control, which doubles as the stale-preview affordance. */
export function generateLabel(status: PdfStatus, hasResult: boolean): string {
  if (status === 'preparing') return 'Preparing…';
  if (status === 'starting') return 'Starting worker…';
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

/**
 * One line per distinct diagnostic, with the pages it applies to.
 *
 * The writer reports a diagnostic once per page and message, so a font missing from a
 * 40-page document arrives as 40 entries. The reader wants the one sentence and the pages.
 */
export function diagnosticSummary(diagnostics: readonly PdfDiagnostic[]): string[] {
  const pages = new Map<string, Set<number>>();
  for (const diagnostic of diagnostics) {
    const set = pages.get(diagnostic.message) ?? new Set<number>();
    if (diagnostic.pageIndex !== undefined) set.add(diagnostic.pageIndex + 1);
    pages.set(diagnostic.message, set);
  }
  return [...pages].map(([message, set]) => {
    const list = [...set].sort((a, b) => a - b);
    if (list.length === 0) return message;
    const shown = list.slice(0, 6).join(', ') + (list.length > 6 ? ', …' : '');
    return `${message} (page${list.length === 1 ? '' : 's'} ${shown})`;
  });
}
