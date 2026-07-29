// Authored relationship records (document-engine task 2.6). Each record retains
// owner part, authored id, type, raw target lexical form, target mode, and
// significant order — nothing is materialized away. Internal targets resolve via
// the owner-relative profile; external targets are retained verbatim and never
// owner-resolved or fetched. Duplicate relationship ids within one owner fail
// closed.

import { resolveInternalTarget, validateExternalTarget, type NameResult } from './opc-names.ts';

export type TargetMode = 'Internal' | 'External';

export interface RelationshipRecord {
  readonly ownerPart: string; // canonical part name of the source part
  readonly id: string; // authored r:id, e.g. "rId1"
  readonly type: string; // relationship type URI
  readonly rawTarget: string; // authored lexical target, retained verbatim
  readonly targetMode: TargetMode;
  readonly order: number; // significant order within the owner's rels
}

export type RelationshipError = {
  readonly code: 'duplicate-id';
  readonly ownerPart: string;
  readonly id: string;
};

export type RelationshipSetResult =
  | { readonly ok: true; readonly byOwner: ReadonlyMap<string, readonly RelationshipRecord[]> }
  | { readonly ok: false; readonly error: RelationshipError };

/** Group relationships by owner in authored order; reject duplicate ids per owner. */
export function buildRelationshipSet(
  records: readonly RelationshipRecord[]
): RelationshipSetResult {
  const byOwner = new Map<string, RelationshipRecord[]>();
  const idsByOwner = new Map<string, Set<string>>();
  for (const rec of [...records].sort((a, b) => a.order - b.order)) {
    const ids = idsByOwner.get(rec.ownerPart) ?? new Set<string>();
    if (ids.has(rec.id)) {
      return { ok: false, error: { code: 'duplicate-id', ownerPart: rec.ownerPart, id: rec.id } };
    }
    ids.add(rec.id);
    idsByOwner.set(rec.ownerPart, ids);
    const list = byOwner.get(rec.ownerPart) ?? [];
    list.push(rec);
    byOwner.set(rec.ownerPart, list);
  }
  return { ok: true, byOwner };
}

export type ResolvedRelationship =
  | { readonly mode: 'Internal'; readonly target: NameResult; readonly raw: string }
  | { readonly mode: 'External'; readonly sinkSafe: NameResult; readonly raw: string };

/**
 * Resolve a relationship to a runtime projection while the raw target stays
 * authored. Internal -> owner-relative part name; External -> sink-safe
 * validation only (never owner-resolved, never fetched). `raw` is always the
 * verbatim authored target.
 */
export function resolveRelationship(rec: RelationshipRecord): ResolvedRelationship {
  if (rec.targetMode === 'External') {
    return {
      mode: 'External',
      sinkSafe: validateExternalTarget(rec.rawTarget),
      raw: rec.rawTarget,
    };
  }
  return {
    mode: 'Internal',
    target: resolveInternalTarget(rec.ownerPart, rec.rawTarget),
    raw: rec.rawTarget,
  };
}
