// Which selected drawings are DrawingML shapes, lines or groups: they paint their own geometry,
// with no picture to replace, crop or transform, and their size also lives in that geometry.

import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import { holdsDiagramGraphic } from '../store/package/diagram-frame.ts';
import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { partOfNodeId } from './surface-scope.ts';

/**
 * Whether a laid-out drawing is a shape, line or group: not a picture, text box, chart or
 * diagram (a diagram paints from its saved drawing, as shapes).
 */
export function isShapeDrawing(
  surface: PaginatedSurface,
  record: InlineDrawingRecord | AnchoredDrawingRecord | null
): boolean {
  if (!record?.vectorShape || record.textboxStory || record.chart) return false;
  // A picture (its outline projects as a shape) and a legacy VML drawing name no graphic kind.
  if (record.placeholderGraphicKind === null || record.groupPicture) return false;
  if (record.resource.kind === 'ready' || record.placeholderGraphicKind === 'chart') return false;
  const part = partOfNodeId(surface.session, record.drawingNodeId) ?? surface.session.part();
  const node = findNode(part, record.drawingNodeId);
  return !node || node.kind === 'textValue' || !holdsDiagramGraphic(node);
}

/**
 * Whether a drawing keeps its size in its own geometry too (`SHAPE_FRAME_EDITS`), so a resize
 * of its frame alone is refused. A legacy VML shape keeps its size in `style` alone.
 */
export function shapeKeepsGeometrySize(projection: DrawingProjection, chartless: boolean): boolean {
  const legacy = !!(projection.legacyGraphic || projection.textArt || projection.horizontalRule);
  return chartless && projection.picture === null && !projection.textboxStory && !legacy;
}
