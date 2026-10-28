import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { TreeDocOp } from '../store/store/tree-op-types.ts';
import { partOfNodeId } from './surface-scope.ts';
import { SUGGESTING_CELL_STRUCTURE_REFUSAL } from './table-cell-structure-plan.ts';

export const SUGGESTING_TABLE_MOVE_REFUSAL =
  'suggesting cannot move a table; stop suggesting to move it';

export const SUGGESTING_TABLE_DELETE_REFUSAL =
  'suggesting cannot delete a whole table; stop suggesting to delete it, or delete its rows one at a time';

/** Whether a block id names a `w:tbl`, in whichever part of the package holds it. */
export function tableLookupIn(
  session: Pick<TreeDocxSessionView, 'currentPackage' | 'part'>
): (blockId: string) => boolean {
  return (blockId) => {
    const part = partOfNodeId(session, blockId);
    return part !== null && findNode(part, blockId)?.kind === 'table';
  };
}

/** Refuse structural writes that cannot create tracked changes. */
export function suggestingStructureRefusal(
  ops: readonly TreeDocOp[],
  isTable: (blockId: string) => boolean
): string | null {
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
  // A tracked table deletion would mark every row deleted, but the store refuses a tracked
  // deletion of the last live row, so a whole-table deletion has no tracked form.
  if (ops.some((op) => op.op === 'deleteBlock' && isTable(op.blockId))) {
    return SUGGESTING_TABLE_DELETE_REFUSAL;
  }
  if (ops.some((op) => op.op === 'moveTable')) return SUGGESTING_TABLE_MOVE_REFUSAL;
  return null;
}
