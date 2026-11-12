// Which selected drawings are DrawingML shapes, lines or groups: they paint their own geometry,
// with no picture to replace, crop or transform, and their size also lives in that geometry.

import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import { holdsDiagramGraphic } from '../store/package/diagram-frame.ts';
import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { partOfNodeId } from './surface-scope.ts';
import { selectedGroupMember } from './group-member-selection.ts';
import {
  readShapeFormat,
  narrowedTargets,
  shapeFormatTargets,
  type ShapeFormatState,
} from '../store/package/shape-format.ts';
import { createPackageShapeThemeResolvers } from '../store/package/theme-color-resolution.ts';

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

/**
 * The fill and outline of the shapes a selected drawing holds, resolved through the theme, or
 * null for a drawing with none to set: a picture, a chart, a diagram.
 */
export function selectedShapeFormat(
  surface: PaginatedSurface,
  drawingNodeId: string
): ShapeFormatState | null {
  const part = partOfNodeId(surface.session, drawingNodeId) ?? surface.session.part();
  const all = shapeFormatTargets(part, drawingNodeId);
  if (typeof all === 'string') return null;
  // A shape selected inside the group reads alone, as the commands then write it alone.
  const member = selectedGroupMember(surface, drawingNodeId);
  const targets = member ? (narrowedTargets(part, all, member) ?? all) : all;
  const theme = createPackageShapeThemeResolvers(surface.session.currentPackage());
  return Object.freeze(readShapeFormat(targets, theme));
}
