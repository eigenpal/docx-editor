/** @spike-features origin-metadata, insert-delete-split-join-operations */
/**
 * Falsification record — store-level positional inverse DocOp stacks (task 2.4):
 *
 * **Rejected** for runtime integration. An incomplete implementation existed but
 * was quarantined after review; actor/session/group undo MUST NOT route through
 * positional inverse DocOps.
 *
 * Falsification summary:
 * - Positional inverses (`computeInverseOps`) are derived from pre-mutation draft
 *   snapshots and break under remote interleaving, split/join identity restoration,
 *   and overlapping mark ownership without CRDT-native undo scope.
 * - Maintaining parallel inverse stacks outside Yjs duplicates CRDT history and
 *   cannot durably reopen via public Yjs APIs without serializing StackItem internals.
 * - The isolated `Y.UndoManager` experiment reached final verdict
 *   `REJECT_CURRENT_MODEL_SHAPE`; it is not a production mechanism.
 *
 * The inverse module remains for falsification tests only (`history-inverse-docop-falsification.test.ts`).
 */
export const UNDO_MECHANISM = 'store-level-inverse-doc-op-quarantined' as const;
export const UNDO_MECHANISM_REJECTED = 'store-level-inverse-doc-op' as const;
export const UNDO_MECHANISM_EXPERIMENT_VERDICT = 'REJECT_CURRENT_MODEL_SHAPE' as const;
