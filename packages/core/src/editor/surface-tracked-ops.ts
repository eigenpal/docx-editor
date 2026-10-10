// Shared classification for tracked editing and explicit automation proposals.
import type { TreeDocOp } from '../store/store/tree-ops.ts';

type RevisionCapableOp = Extract<
  TreeDocOp,
  {
    op:
      | 'insertText'
      | 'deleteText'
      | 'insertTab'
      | 'insertHardBreak'
      | 'insertPageBreak'
      | 'insertPageField'
      | 'insertNote'
      | 'insertTable'
      | 'insertTableRow'
      | 'deleteTableRow'
      | 'setRunProperties'
      | 'setParagraphProperties'
      | 'setParagraphMarkProperties';
  }
>;
const REVISION_CAPABLE_OPS: ReadonlySet<TreeDocOp['op']> = new Set<RevisionCapableOp['op']>([
  'insertText',
  'deleteText',
  'insertTab',
  'insertHardBreak',
  'insertPageBreak',
  'insertPageField',
  'insertNote',
  'insertTable',
  'insertTableRow',
  'deleteTableRow',
  'setRunProperties',
  'setParagraphProperties',
  'setParagraphMarkProperties',
]);

export function isRevisionCapable(op: TreeDocOp): op is RevisionCapableOp {
  return REVISION_CAPABLE_OPS.has(op.op);
}

export function isTrackedEdit(op: TreeDocOp): boolean {
  if (isRevisionCapable(op)) return op.revision !== undefined;
  switch (op.op) {
    case 'setParagraphMarkRevision':
    case 'proposeParagraphMerge':
      return true;
    // Paste proposes its breaks through the op itself, so a paste of newlines alone is a
    // tracked edit with no `insertText` beside it to report for it.
    case 'insertContentControl':
    case 'authorTable':
    case 'setListNumbering':
    case 'setListLevel':
    case 'splitParagraphMany':
      return op.revision !== undefined;
    default:
      return false;
  }
}
