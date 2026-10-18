import type { TreeDocOp } from '../store/store/tree-op-types.ts';
import { SUGGESTING_CELL_STRUCTURE_REFUSAL } from './table-cell-structure-plan.ts';

/** Refuse structural writes that cannot create tracked changes. */
export function suggestingStructureRefusal(ops: readonly TreeDocOp[]): string | null {
  // Outright note removal deletes both its reference and body without a tracked change.
  // Strike the reference instead; accepting that strike removes the body.
  // Note conversion and property edits remain direct because they remove no content.
  if (ops.some((op) => op.op === 'deleteNote')) {
    return 'suggesting cannot delete a note outright; strike its reference to propose the deletion';
  }
  // Removing a control with its content has no tracked form either; refuse it the same way.
  const removesControl = (op: TreeDocOp) =>
    op.op === 'removeContentControl' && op.keepContent === false;
  if (ops.some(removesControl)) {
    return 'suggesting cannot remove a content control outright';
  }
  // Cell merge and split have no tracked form either, so applying them would be untracked.
  const restructuresCells = (op: TreeDocOp) =>
    op.op === 'mergeTableCells' || op.op === 'splitTableCell';
  if (ops.some(restructuresCells)) return SUGGESTING_CELL_STRUCTURE_REFUSAL;
  return null;
}
