// A DrawingML diagram in a story: a `w:drawing` whose graphic data is `dgm:relIds`.
//
// A diagram takes the frame edits of a picture: size, position, wrap, alt text, and delete.
// Its graphic lives in the diagram parts, so crop, replace, rotate, and borders refuse. A
// resize also rescales the saved drawing part (`package/diagram-frame.ts`); the editor sends
// it through the package lane that writes both, as one undo unit.

import { holdsDiagramGraphic } from '../package/diagram-frame.ts';
import { findNode } from '../package/ooxml-edit.ts';
import type { OoxmlElement, OoxmlPart } from '../package/ooxml-tree.ts';

/** The drawing operations that change only a diagram's frame, never its graphic. */
export const DIAGRAM_FRAME_EDITS: ReadonlySet<string> = new Set([
  'resizeDrawing',
  'positionDrawing',
  'setDrawingWrap',
  'setDrawingMetadata',
  'deleteDrawing',
]);

/** The `w:drawing` that `nodeId` names when it holds a diagram, or null. */
export function diagramDrawingOf(part: OoxmlPart, nodeId: string): OoxmlElement | null {
  const node = findNode(part, nodeId);
  if (!node || node.kind === 'textValue') return null;
  return holdsDiagramGraphic(node) ? node : null;
}
