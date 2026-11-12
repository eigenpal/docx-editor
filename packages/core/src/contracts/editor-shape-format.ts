/**
 * Fill and outline commands for the selected shape, split out of `editor.ts` to keep it under
 * the max-lines gate. Re-exported from `editor.ts`.
 */

export type {
  ShapeFillState,
  ShapeFormatState,
  ShapeOutlineState,
} from '../store/package/shape-format.ts';

/**
 * Set the fill of the selected shape, text box, line or group: `exec({ type: 'setShapeFill',
 * color: '4472C4' })`. A group fills every shape it holds. One undo step.
 *
 * `visible: false` removes the fill and keeps it, so a later `visible: true` brings it back.
 * `color` is `RRGGBB` or `#RRGGBB`. `transparency` runs from 0 (opaque) to 1 (clear); a new
 * colour without one keeps the shape's transparency. Pictures, charts and diagrams refuse.
 *
 * @public
 */
export interface SetShapeFillCommand {
  /** Expected drawing node id, from `snapshot().image.id`; a different selection refuses. */
  drawingNodeId?: string;
  visible?: boolean;
  color?: string;
  transparency?: number;
}

/**
 * Set the outline of the selected shape, text box, line or group:
 * `exec({ type: 'setShapeOutline', color: '1F3864', widthPt: 2 })`. One undo step.
 *
 * `visible: false` hides the outline and keeps its colour for a later `visible: true`.
 * `widthPt` runs from 0.25 to 1584 points. Fields left out keep their value.
 *
 * @public
 */
export interface SetShapeOutlineCommand {
  /** Expected drawing node id, from `snapshot().image.id`; a different selection refuses. */
  drawingNodeId?: string;
  visible?: boolean;
  color?: string;
  widthPt?: number;
}
