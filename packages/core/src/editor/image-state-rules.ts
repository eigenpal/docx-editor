// Selected-image rules shared by the image commands and the snapshot: value equality of the
// selected image, and the refusal for a chart.
//
// A chart is no picture, whether the page draws it, shows the fallback saved beside it in
// `mc:AlternateContent`, or shows a placeholder. Resizing, cropping, moving, wrapping,
// replacing or describing it as a picture would edit one branch alone, so those commands
// refuse; delete removes the whole chart (`store/store/tree-op-chart-drawing.ts`). A chart
// selects as an object in every state, with no resize, move or crop handles.

import type { EditorCommand, ExecResult, SelectedImageState } from '../contracts/editor.ts';
import type { DrawingLocks, DrawingProjection } from '../store/package/drawing-projection.ts';
import { chartDrawingOf } from '../store/store/tree-op-chart-drawing.ts';
import { chartDrawingLocks } from '../store/store/tree-op-drawings.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { partOfNodeId } from './surface-scope.ts';

/**
 * The engine's reason for a refused picture command on a chart. Adapters translate it through
 * `DISABLED_REASON_KEYS` in `@docx-editor.dev/i18n`, so the two sentences must stay the same.
 */
export const CHART_DRAWING_REASON =
  'this drawing is a chart; only delete applies, and it removes the whole chart';

/** Whether `drawingNodeId` names a chart: drawn, shown by its saved fallback, or a placeholder. */
export function isChartDrawing(surface: PaginatedSurface, drawingNodeId: string): boolean {
  // A pure read: `partOfNodeId`, never `partFor`, which would retain a story store.
  const part = partOfNodeId(surface.session, drawingNodeId) ?? surface.session.part();
  return chartDrawingOf(part, drawingNodeId) !== null;
}

/**
 * Whether `drawingNodeId` names a chart, and the locks that gate it. A chart's locks come
 * from its chart drawing in every state, as the store reads them for its delete, so `can()`
 * answers what the command does; any other drawing reads its own.
 */
export function drawingGate(
  surface: PaginatedSurface,
  drawingNodeId: string,
  projection: DrawingProjection
): { readonly chart: boolean; readonly locks: DrawingLocks } {
  const part = partOfNodeId(surface.session, drawingNodeId) ?? surface.session.part();
  const target = chartDrawingOf(part, drawingNodeId);
  if (!target) return { chart: false, locks: projection.locks };
  return { chart: true, locks: chartDrawingLocks(target.chartDrawing) ?? projection.locks };
}

/** The refusal for every image command but delete on a chart, or null. */
export function chartDrawingRefusal(
  surface: PaginatedSurface,
  command: EditorCommand,
  drawingNodeId: string
): ExecResult | null {
  if (command.type === 'deleteImage' || !isChartDrawing(surface, drawingNodeId)) return null;
  return { ok: false, code: 'unsupported', reason: CHART_DRAWING_REASON };
}

export function imageContextEqual(
  a: SelectedImageState | null,
  b: SelectedImageState | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.widthEmu === b.widthEmu &&
    a.heightEmu === b.heightEmu &&
    a.crop.left === b.crop.left &&
    a.crop.top === b.crop.top &&
    a.crop.right === b.crop.right &&
    a.crop.bottom === b.crop.bottom &&
    a.rotationDegrees === b.rotationDegrees &&
    a.wrap === b.wrap &&
    a.name === b.name &&
    a.title === b.title &&
    a.description === b.description &&
    a.hyperlink === b.hyperlink &&
    a.hidden === b.hidden &&
    a.resourceStatus === b.resourceStatus &&
    a.canResize === b.canResize &&
    a.canMove === b.canMove &&
    a.canChangeWrap === b.canChangeWrap &&
    a.canCrop === b.canCrop &&
    a.locks.select === b.locks.select &&
    a.locks.move === b.locks.move &&
    a.locks.resize === b.locks.resize &&
    a.locks.changeAspect === b.locks.changeAspect &&
    (a.position?.mode ?? 'frame') === (b.position?.mode ?? 'frame') &&
    (a.position?.horizontalEmu ?? null) === (b.position?.horizontalEmu ?? null) &&
    (a.position?.verticalEmu ?? null) === (b.position?.verticalEmu ?? null) &&
    (a.position?.relativeToH ?? null) === (b.position?.relativeToH ?? null) &&
    (a.position?.relativeToV ?? null) === (b.position?.relativeToV ?? null) &&
    (a.intrinsic?.pixelWidth ?? null) === (b.intrinsic?.pixelWidth ?? null) &&
    (a.intrinsic?.pixelHeight ?? null) === (b.intrinsic?.pixelHeight ?? null) &&
    (a.intrinsic?.dpiX ?? null) === (b.intrinsic?.dpiX ?? null) &&
    (a.intrinsic?.dpiY ?? null) === (b.intrinsic?.dpiY ?? null)
  );
}
