// Selected-image rules shared by the image commands and the snapshot: value equality of the
// selected image, and the refusal for a chart's saved fallback.
//
// A chart in `mc:AlternateContent` that cannot render shows the fallback saved beside it. The
// fallback is not the chart: resizing, cropping, moving, wrapping, replacing or describing it
// alone would leave the chart branch unchanged. Those commands refuse; delete removes the chart.

import type { EditorCommand, ExecResult, SelectedImageState } from '../contracts/editor.ts';
import { chartWrapperOfFallback } from '../store/store/tree-op-chart-fallback.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/** The engine's reason for a refused picture command on a chart's fallback. */
export const CHART_FALLBACK_REASON =
  "this picture is a chart's saved fallback; only delete applies, and it removes the chart";

/** Whether `drawingNodeId` names a chart's saved fallback in the active story. */
export function isChartFallbackDrawing(surface: PaginatedSurface, drawingNodeId: string): boolean {
  const part = surface.session.partFor(surface.storyScope()) ?? surface.session.part();
  return chartWrapperOfFallback(part, drawingNodeId) !== null;
}

/** The refusal for every image command but delete on a chart's fallback, or null. */
export function chartFallbackRefusal(
  surface: PaginatedSurface,
  command: EditorCommand,
  drawingNodeId: string
): ExecResult | null {
  if (command.type === 'deleteImage' || !isChartFallbackDrawing(surface, drawingNodeId)) {
    return null;
  }
  return { ok: false, code: 'unsupported', reason: CHART_FALLBACK_REASON };
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
