// PM-free composition anchor, overlay derivation, and remote-invalidation helpers (interactive-paginated 4.4).

import type { CompositionObservation } from '@docx-editor.dev/core-contract/interaction';
import type { SelectionAnchor } from './selection.ts';

export type CompositionCancelCode = 'remoteInvalidation' | 'capabilityBoundary' | 'cancelled';

export interface CompositionCancelOutcome {
  readonly code: CompositionCancelCode;
  readonly reason: string;
}

export interface CompositionSnapshot {
  readonly anchor: SelectionAnchor;
  readonly paragraphId: string;
  /** Canonical paragraph text at composition start (UTF-16 code units). */
  readonly paragraphText: string;
  /** Inclusive UTF-16 start offset of the replaced/inserted range in `paragraphText`. */
  readonly selectionStart: number;
  /** Exclusive UTF-16 end offset of the replaced/inserted range in `paragraphText`. */
  readonly selectionEnd: number;
  readonly startRevision: number;
}

/**
 * Conservative remote invariant: while composing, canonical text may change only by
 * inserting a prefix immediately before the entire pre-change paragraph (`inserted + snapshot.paragraphText`).
 * Any suffix edit, in-range replacement, or non-prefix mutation invalidates the composition anchor.
 */
export function remoteChangePreservesCompositionAnchor(
  snapshot: CompositionSnapshot,
  currentParagraphText: string,
  currentRevision: number
): boolean {
  if (currentRevision <= snapshot.startRevision) return true;
  if (currentParagraphText === snapshot.paragraphText) return true;
  if (
    currentParagraphText.length > snapshot.paragraphText.length &&
    currentParagraphText.slice(currentParagraphText.length - snapshot.paragraphText.length) ===
      snapshot.paragraphText
  ) {
    return true;
  }
  return false;
}

/** Map the composition UTF-16 range after a prefix-only remote canonical change. */
export function mapCompositionRangeAfterRemote(
  snapshot: CompositionSnapshot,
  currentParagraphText: string
): { readonly selectionStart: number; readonly selectionEnd: number } | null {
  if (currentParagraphText === snapshot.paragraphText) {
    return { selectionStart: snapshot.selectionStart, selectionEnd: snapshot.selectionEnd };
  }
  if (
    currentParagraphText.length > snapshot.paragraphText.length &&
    currentParagraphText.slice(currentParagraphText.length - snapshot.paragraphText.length) ===
      snapshot.paragraphText
  ) {
    const inserted = currentParagraphText.length - snapshot.paragraphText.length;
    return {
      selectionStart: snapshot.selectionStart + inserted,
      selectionEnd: snapshot.selectionEnd + inserted,
    };
  }
  return null;
}

/**
 * Deterministic overlay diff against the composition snapshot anchor.
 * Supports collapsed caret insertion and replacement of an initially selected UTF-16 range.
 */
export function deriveCompositionOverlay(
  snapshot: CompositionSnapshot,
  currentParagraphText: string
): string {
  const prefix = snapshot.paragraphText.slice(0, snapshot.selectionStart);
  const suffix = snapshot.paragraphText.slice(snapshot.selectionEnd);
  if (!currentParagraphText.startsWith(prefix) || !currentParagraphText.endsWith(suffix)) return '';
  return currentParagraphText.slice(prefix.length, currentParagraphText.length - suffix.length);
}

/** Apply a composed overlay onto canonical paragraph text at the mapped selection range. */
export function applyCompositionOverlay(
  canonicalParagraphText: string,
  selectionStart: number,
  selectionEnd: number,
  overlay: string
): string {
  return (
    canonicalParagraphText.slice(0, selectionStart) +
    overlay +
    canonicalParagraphText.slice(selectionEnd)
  );
}

export function observeComposition(
  active: boolean,
  lastCancel: CompositionCancelOutcome | null = null
): CompositionObservation {
  return {
    active,
    scope: active ? { kind: 'body' } : null,
    lastCancel,
  };
}
