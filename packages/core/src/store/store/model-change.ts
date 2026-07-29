// ModelChange construction (document-engine task 4.7). Aggregates the structural
// effects of a committed transaction into the before/after reverse-reconciliation
// evidence the binding and layout consume: dirty/deleted/created identities,
// moves, split/join maps, and changed dependency keys.

import type { ModelChange, OpEffect } from './contracts.ts';

export function buildModelChange(
  fromRevision: number,
  toRevision: number,
  commitId: string,
  origin: string,
  effects: readonly OpEffect[],
  normalized: boolean
): ModelChange {
  const dirty = new Set<string>();
  const deleted = new Set<string>();
  const created = new Set<string>();
  const moves: { id: string; from: number; to: number }[] = [];
  const splitJoin: (
    | { split: { from: string; tail: string } }
    | { join: { kept: string; removed: string } }
  )[] = [];
  const dependencyKeys = new Set<string>();

  for (const e of effects) {
    e.dirty.forEach((d) => dirty.add(d));
    e.deleted.forEach((d) => deleted.add(d));
    e.created.forEach((d) => created.add(d));
    e.moves?.forEach((m) => moves.push(m));
    if (e.split) splitJoin.push({ split: e.split });
    if (e.join) splitJoin.push({ join: e.join });
    e.dependencyKeys?.forEach((k) => dependencyKeys.add(k));
  }
  // A created id that was also deleted in the same commit is a net no-op identity.
  for (const id of created) deleted.delete(id);

  return {
    change: 'model-change',
    fromRevision,
    toRevision,
    commitId,
    origin,
    dirty: [...dirty],
    deleted: [...deleted],
    created: [...created],
    moves,
    splitJoin,
    dependencyKeys: [...dependencyKeys],
    normalized,
  };
}
