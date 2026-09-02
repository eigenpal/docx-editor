import {
  HARD_MAX_FIDELITY_DIAGNOSTICS,
  validateBoundedString,
  validatePageIndex,
} from './pdf-paint-bounds.ts';

/** Story that owns an unsupported semantic record. @public */
export type PdfFidelityStoryKind =
  | 'body'
  | 'header'
  | 'footer'
  | 'footnote'
  | 'endnote'
  | 'textbox'
  | 'note-separator';

/** Structured fidelity diagnostic for unsupported or approximated content. @public */
export interface PdfFidelityDiagnostic {
  readonly kind: 'unsupported' | 'approximation';
  readonly feature: string;
  readonly pageIndex: number;
  readonly recordKind: string;
  readonly recordId: string | null;
  readonly story: PdfFidelityStoryKind | null;
  readonly reason: string;
}

const MAX_FEATURE_LENGTH = 128;
const MAX_RECORD_KIND_LENGTH = 64;
const MAX_RECORD_ID_LENGTH = 256;
const MAX_REASON_LENGTH = 512;

function freezeDiagnostic(input: {
  readonly kind: 'unsupported' | 'approximation';
  readonly feature: string;
  readonly pageIndex: number;
  readonly recordKind: string;
  readonly recordId?: string | null;
  readonly story?: PdfFidelityStoryKind | null;
  readonly reason: string;
}): PdfFidelityDiagnostic {
  return Object.freeze({
    kind: input.kind,
    feature: validateBoundedString('feature', input.feature, MAX_FEATURE_LENGTH),
    pageIndex: validatePageIndex(input.pageIndex),
    recordKind: validateBoundedString('recordKind', input.recordKind, MAX_RECORD_KIND_LENGTH),
    recordId:
      input.recordId === undefined || input.recordId === null
        ? null
        : validateBoundedString('recordId', input.recordId, MAX_RECORD_ID_LENGTH),
    story: input.story ?? null,
    reason: validateBoundedString('reason', input.reason, MAX_REASON_LENGTH),
  });
}

/** Creates an immutable unsupported-record diagnostic. @public */
export function pdfUnsupportedDiagnostic(input: {
  readonly feature: string;
  readonly pageIndex: number;
  readonly recordKind: string;
  readonly recordId?: string | null;
  readonly story?: PdfFidelityStoryKind | null;
  readonly reason: string;
}): PdfFidelityDiagnostic {
  return freezeDiagnostic({ kind: 'unsupported', ...input });
}

/** Creates an immutable approximation diagnostic. @public */
export function pdfApproximationDiagnostic(input: {
  readonly feature: string;
  readonly pageIndex: number;
  readonly recordKind: string;
  readonly recordId?: string | null;
  readonly story?: PdfFidelityStoryKind | null;
  readonly reason: string;
}): PdfFidelityDiagnostic {
  return freezeDiagnostic({ kind: 'approximation', ...input });
}

function aggregateKey(diagnostic: PdfFidelityDiagnostic): string {
  if (diagnostic.feature === 'standard-font-substitution') {
    return [
      diagnostic.kind,
      diagnostic.feature,
      String(diagnostic.pageIndex),
      diagnostic.recordId ?? '',
    ].join('\u001f');
  }
  return [
    diagnostic.kind,
    diagnostic.feature,
    String(diagnostic.pageIndex),
    diagnostic.recordKind,
  ].join('\u001f');
}

function withOccurrenceCount(reason: string, count: number): string {
  const suffix = ` (${count} occurrences)`;
  if (reason.length + suffix.length <= MAX_REASON_LENGTH) {
    return `${reason}${suffix}`;
  }
  return `${reason.slice(0, MAX_REASON_LENGTH - suffix.length)}${suffix}`;
}

/** Bounded, aggregating collector for one PDF export's fidelity diagnostics. @internal */
export interface PdfFidelityDiagnosticCollector {
  push(diagnostic: PdfFidelityDiagnostic): void;
  snapshot(): readonly PdfFidelityDiagnostic[];
}

/**
 * Collects diagnostics with per-key aggregation and a hard unique-key cap.
 * One slot is reserved for a `diagnostic-limit` overflow entry.
 *
 * @internal
 */
export function createFidelityDiagnosticCollector(): PdfFidelityDiagnosticCollector {
  const stored = new Map<string, { diagnostic: PdfFidelityDiagnostic; count: number }>();
  const maxStored = HARD_MAX_FIDELITY_DIAGNOSTICS - 1;
  let omitted = 0;

  return {
    push(diagnostic: PdfFidelityDiagnostic): void {
      const key = aggregateKey(diagnostic);
      const existing = stored.get(key);
      if (existing) {
        existing.count += 1;
        return;
      }
      if (stored.size >= maxStored) {
        omitted += 1;
        return;
      }
      stored.set(key, { diagnostic, count: 1 });
    },
    snapshot(): readonly PdfFidelityDiagnostic[] {
      const diagnostics: PdfFidelityDiagnostic[] = [];
      for (const entry of stored.values()) {
        if (entry.count === 1) {
          diagnostics.push(entry.diagnostic);
          continue;
        }
        diagnostics.push(
          freezeDiagnostic({
            ...entry.diagnostic,
            reason: withOccurrenceCount(entry.diagnostic.reason, entry.count),
          })
        );
      }
      if (omitted > 0) {
        diagnostics.push(
          pdfUnsupportedDiagnostic({
            feature: 'diagnostic-limit',
            pageIndex: 0,
            recordKind: 'document',
            reason: `Omitted ${omitted} additional fidelity diagnostics after the ${HARD_MAX_FIDELITY_DIAGNOSTICS} entry cap`,
          })
        );
      }
      return Object.freeze(diagnostics);
    },
  };
}
