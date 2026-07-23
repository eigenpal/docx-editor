// Atomic snapshot compaction (document-engine task 5.8 / design D10). Compaction
// folds the update log into the base snapshot to produce a new checkpoint, while
// PRESERVING updates that arrive during compaction and RETAINING the prior
// checkpoint until the new one validates. Updates are deduplicated by id so each
// concurrent update appears exactly once after crash recovery.

export interface Checkpoint<S, U> {
  readonly snapshot: S;
  /** Updates applied on top of `snapshot` (the tail log). */
  readonly log: readonly U[];
}

export interface Compactable<S, U> {
  apply(snapshot: S, update: U): S;
  validate(snapshot: S): boolean;
  updateId(update: U): string;
}

export type CompactionResult<S, U> =
  | { readonly ok: true; readonly checkpoint: Checkpoint<S, U>; readonly prior: Checkpoint<S, U> }
  | { readonly ok: false; readonly reason: 'validation-failed'; readonly retained: Checkpoint<S, U> };

/**
 * Compact `current`, folding its log into its snapshot. `arriving` are updates
 * delivered during compaction; those already folded (by id) or duplicated are
 * dropped, so the new tail log holds each genuinely-new update exactly once. The
 * prior checkpoint is returned and retained until the caller confirms the new one.
 */
export function compact<S, U>(
  current: Checkpoint<S, U>,
  ops: Compactable<S, U>,
  arriving: readonly U[] = [],
): CompactionResult<S, U> {
  // Fold the existing log into the snapshot.
  const folded = new Set<string>();
  let next = current.snapshot;
  for (const u of current.log) {
    next = ops.apply(next, u);
    folded.add(ops.updateId(u));
  }
  if (!ops.validate(next)) return { ok: false, reason: 'validation-failed', retained: current };

  // Preserve concurrent updates not already folded; dedup within `arriving`.
  const seen = new Set(folded);
  const tail: U[] = [];
  for (const u of arriving) {
    const id = ops.updateId(u);
    if (seen.has(id)) continue; // already folded or already queued -> exactly once
    seen.add(id);
    tail.push(u);
  }

  return { ok: true, checkpoint: { snapshot: next, log: tail }, prior: current };
}

/** Materialize a checkpoint (snapshot + tail log) — the crash-recovery read path. */
export function materialize<S, U>(checkpoint: Checkpoint<S, U>, ops: Compactable<S, U>): S {
  let state = checkpoint.snapshot;
  for (const u of checkpoint.log) state = ops.apply(state, u);
  return state;
}
