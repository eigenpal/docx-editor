/** @spike-features origin-metadata, insert-delete-split-join-operations, yjs-backend */
/**
 * Task 2.4 undo mechanism experiment decision record.
 *
 * Final verdict: **REJECT_CURRENT_MODEL_SHAPE**.
 *
 * Public Y.UndoManager durability, grouping, and staged publication can work through
 * a bounded reconstruction journal. The current nested Y.Map/Y.Text replacement
 * shape cannot preserve same-target nested remote edits or overlapping marks.
 */
export const UNDO_EXPERIMENT_MECHANISM = 'yjs-undo-manager-durability' as const;
export const UNDO_EXPERIMENT_REJECTED = 'store-level-inverse-doc-op' as const;
export const UNDO_EXPERIMENT_VERDICT = 'REJECT_CURRENT_MODEL_SHAPE' as const;

export const UNDO_EXPERIMENT_DECISION = Object.freeze({
  verdict: UNDO_EXPERIMENT_VERDICT,
  finding:
    'Public Y.UndoManager durability/grouping/staging can work via a bounded reconstruction journal, but the current model-shaped nested Y.Map/Y.Text replacement shape fails same-target nested remote edits and overlapping marks because untracked replacement consumes tracked undo items and undo of locally created nested types deletes later remote child edits.',
  consequence:
    'Task 2.4 remains unchecked; the next design must change model granularity/ownership or undo requirements before implementation.',
  task24Complete: false,
});
