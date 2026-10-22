// What a drawing op is and how far it reaches: the op family, its layout impact, and the
// effect a committed drawing edit reports.

import type { OoxmlPart } from '../package/ooxml-tree.ts';
import { paragraphContainingNode, TEXT_DEPS } from './tree-op-nodes.ts';
import type { DrawingTreeDocOp, ImpactClass, TreeDocOp, TreeOpEffect } from './tree-op-types.ts';

export function drawingOpImpact(op: DrawingTreeDocOp): ImpactClass {
  switch (op.op) {
    case 'setDrawingMetadata':
    case 'setDrawingLocks':
    case 'replaceDrawingResource':
      return 'text-local';
    case 'insertDrawing':
    case 'deleteDrawing':
    case 'resizeDrawing':
    case 'cropDrawing':
    case 'positionDrawing':
    case 'setDrawingWrap':
    case 'transformDrawing':
      return 'flow-structural';
    default: {
      const _exhaustive: never = op;
      void _exhaustive;
      return 'flow-structural';
    }
  }
}

/** The effect of an edit to one drawing: its paragraph and the drawing are dirty. */
export function drawingEffect(
  part: OoxmlPart,
  drawingId: string,
  op: DrawingTreeDocOp
): TreeOpEffect {
  const paragraph = paragraphContainingNode(part, drawingId);
  const dirty = paragraph ? [paragraph.id, drawingId] : [drawingId];
  return {
    dirty,
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: drawingOpImpact(op),
  };
}

/** Whether an op is one of the drawing ops. Narrows the type. */
export function isDrawingTreeDocOp(op: TreeDocOp): op is DrawingTreeDocOp {
  return (
    op.op === 'insertDrawing' ||
    op.op === 'replaceDrawingResource' ||
    op.op === 'deleteDrawing' ||
    op.op === 'resizeDrawing' ||
    op.op === 'cropDrawing' ||
    op.op === 'positionDrawing' ||
    op.op === 'setDrawingWrap' ||
    op.op === 'setDrawingMetadata' ||
    op.op === 'setDrawingLocks' ||
    op.op === 'transformDrawing'
  );
}
