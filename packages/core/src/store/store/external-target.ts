// JSON-safe external targets (document-engine tasks 4.8, 4.9 / design D4). An
// external caller addresses content by paragraph identity plus an optional unique
// phrase or explicit offset discriminator — never a live handle or backend bytes.
// Resolution is read-only (it never mutates), records the revision it resolved
// against, and is deterministic: the same serialized target against the same
// authored state resolves identically or returns the same typed failure in any
// process. Missing/ambiguous/out-of-bounds/stale/kind-mismatch all fail closed.

import type { DocumentStore } from './document-store.ts';
import { paragraphText, type ParagraphRecord } from '../model/index.ts';

export interface ExternalTarget {
  readonly paragraphId: string;
  /** Optional phrase discriminator (NFC, case-sensitive, zero-based occurrence). */
  readonly phrase?: { readonly text: string; readonly occurrence?: number };
  /** Optional explicit character offset discriminator. */
  readonly offset?: number;
  /** Optional stale precondition: the revision the caller addressed. */
  readonly baseRevision?: number;
  /** Optional expected kind (only 'paragraph' exists today). */
  readonly kind?: 'paragraph';
}

export type ResolveFailure =
  | 'missing'
  | 'ambiguous'
  | 'not-found'
  | 'out-of-bounds'
  | 'stale'
  | 'kind-mismatch';

export type ResolvedTarget =
  | {
      readonly ok: true;
      readonly paragraphId: string;
      readonly offset: number;
      readonly resolvedRevision: number;
    }
  | { readonly ok: false; readonly reason: ResolveFailure; readonly resolvedRevision: number };

function findParagraph(store: DocumentStore, paragraphId: string): ParagraphRecord | undefined {
  for (const story of store.currentModel.stories.values()) {
    const p = story.blocks.find((b) => b.kind === 'paragraph' && b.id === paragraphId);
    if (p) return p as ParagraphRecord;
  }
  return undefined;
}

/** Resolve an external target to an internal (paragraphId, offset) without mutating. */
export function resolveExternalTarget(
  store: DocumentStore,
  target: ExternalTarget
): ResolvedTarget {
  const resolvedRevision = store.currentRevision;
  const fail = (reason: ResolveFailure): ResolvedTarget => ({
    ok: false,
    reason,
    resolvedRevision,
  });

  if (target.baseRevision !== undefined && target.baseRevision !== resolvedRevision)
    return fail('stale');
  if (target.kind !== undefined && target.kind !== 'paragraph') return fail('kind-mismatch');

  const para = findParagraph(store, target.paragraphId);
  if (!para) return fail('missing');

  const text = paragraphText(store.currentModel, target.paragraphId) ?? '';

  if (target.phrase) {
    const needle = target.phrase.text.normalize('NFC');
    const haystack = text.normalize('NFC');
    const positions: number[] = [];
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      positions.push(at);
      from = at + Math.max(1, needle.length);
    }
    if (positions.length === 0) return fail('not-found');
    if (target.phrase.occurrence === undefined) {
      if (positions.length > 1) return fail('ambiguous');
      return { ok: true, paragraphId: target.paragraphId, offset: positions[0], resolvedRevision };
    }
    const occ = target.phrase.occurrence;
    if (occ < 0 || occ >= positions.length) return fail('out-of-bounds');
    return { ok: true, paragraphId: target.paragraphId, offset: positions[occ], resolvedRevision };
  }

  if (target.offset !== undefined) {
    if (target.offset < 0 || target.offset > text.length) return fail('out-of-bounds');
    return { ok: true, paragraphId: target.paragraphId, offset: target.offset, resolvedRevision };
  }

  return { ok: true, paragraphId: target.paragraphId, offset: 0, resolvedRevision };
}
