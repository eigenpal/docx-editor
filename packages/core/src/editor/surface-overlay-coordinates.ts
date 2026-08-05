// Shared overlay coordinate mapping — same transform the painter and selection overlay use.
//
// Layout records are in points; paint multiplies by `zoom * 96/72`. Image overlay chrome must
// use this scale in both directions so pointer deltas invert exactly.

import type {
  DrawingPositionInput,
  DrawingTransform,
} from '../store/package/drawing-projection.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';
import type { ImageInteractionSession, ImageResizeHandle } from './docx-editor-images.ts';
import { EMU_PER_POINT, pointsToEmu, computeMovedImagePosition } from './docx-editor-images.ts';

/** Points → CSS pixels at the given zoom (matches `mountPaginatedSurface` / semantic paint). */
export function surfacePaintScale(zoom: number): number {
  return zoom * (96 / 72);
}

export function layoutPointsToCssPixels(points: number, paintScale: number): number {
  return points * paintScale;
}

export function cssPixelsToLayoutPoints(pixels: number, paintScale: number): number {
  return pixels / paintScale;
}

export interface SurfaceOverlayCoordinates {
  readonly paintScale: number;
  readonly pageOffsetX: ReadonlyMap<number, number>;
}

export interface OverlayFrameRect {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Page-content frame → sheet-space CSS pixels (matches `paintSelectionOverlay`). */
export function overlayFrameToSheetCssPixels(
  layout: SemanticLayout,
  frame: OverlayFrameRect,
  coordinates: SurfaceOverlayCoordinates
): {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
} {
  const page = layout.pages[frame.pageIndex];
  if (!page) return { left: 0, top: 0, width: 0, height: 0 };
  const offsetX = coordinates.pageOffsetX.get(page.index) ?? 0;
  const scale = coordinates.paintScale;
  return Object.freeze({
    left: (page.contentBox.x + frame.x + offsetX) * scale,
    top: (page.contentBox.y + frame.y) * scale,
    width: frame.width * scale,
    height: frame.height * scale,
  });
}

/** Whether this handle drag should preserve aspect ratio. */
export function resizePreservesAspect(
  handle: ImageResizeHandle,
  aspectLocked: boolean,
  shiftKey: boolean
): boolean {
  if (aspectLocked) return true;
  if (handle.length === 1) return false;
  return !shiftKey;
}

const HANDLE_ORDER: readonly ImageResizeHandle[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];

export interface AnchorFrameOrigin {
  readonly x: number;
  readonly y: number;
}

/** Map a screen-space handle on the AABB to the local extent axes after rotation and flips. */
function localHandle(handle: ImageResizeHandle, transform: DrawingTransform): ImageResizeHandle {
  let index = HANDLE_ORDER.indexOf(handle);
  if (transform.flipHorizontal) index = (4 - index + 8) % 8;
  if (transform.flipVertical) index = (8 - index) % 8;
  const steps = Math.round(transform.rotationDegrees / 45) % 8;
  return HANDLE_ORDER[(index - steps + 8) % 8]!;
}

function inverseTransformDelta(
  deltaX: number,
  deltaY: number,
  transform: DrawingTransform
): { readonly x: number; readonly y: number } {
  let x = deltaX;
  let y = deltaY;
  const radians = (-transform.rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotatedX = x * cos - y * sin;
  const rotatedY = x * sin + y * cos;
  x = rotatedX;
  y = rotatedY;
  if (transform.flipHorizontal) x = -x;
  if (transform.flipVertical) y = -y;
  return Object.freeze({ x, y });
}

function emuToPoints(emu: number): number {
  return emu / EMU_PER_POINT;
}

export interface ImageResizeResult {
  readonly widthEmu: number;
  readonly heightEmu: number;
  readonly previewBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly position: DrawingPositionInput | null;
}

export function computeImageResizeResult(options: {
  readonly handle: ImageResizeHandle;
  readonly startWidthEmu: number;
  readonly startHeightEmu: number;
  readonly startBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly startPosition: DrawingPositionInput | null;
  readonly anchorFrameOrigin?: AnchorFrameOrigin | null;
  readonly deltaXPt: number;
  readonly deltaYPt: number;
  readonly transform: DrawingTransform;
  readonly preserveAspect: boolean;
  readonly kind: 'inline' | 'anchored';
}): ImageResizeResult {
  const local = inverseTransformDelta(options.deltaXPt, options.deltaYPt, options.transform);
  let widthPt = emuToPoints(options.startWidthEmu);
  let heightPt = emuToPoints(options.startHeightEmu);
  const aspect = widthPt / heightPt;
  const handle = localHandle(options.handle, options.transform);

  const horizontal = handle.includes('e') ? local.x : handle.includes('w') ? -local.x : 0;
  const vertical = handle.includes('s') ? local.y : handle.includes('n') ? -local.y : 0;

  widthPt = Math.max(1, widthPt + horizontal);
  heightPt = Math.max(1, heightPt + vertical);

  if (options.preserveAspect) {
    const corner = handle.length === 2;
    if (corner) {
      const scaleFactor = Math.max(
        widthPt / emuToPoints(options.startWidthEmu),
        heightPt / emuToPoints(options.startHeightEmu)
      );
      widthPt = Math.max(1, emuToPoints(options.startWidthEmu) * scaleFactor);
      heightPt = Math.max(1, widthPt / aspect);
    } else if (handle === 'e' || handle === 'w') {
      heightPt = Math.max(1, widthPt / aspect);
    } else {
      widthPt = Math.max(1, heightPt * aspect);
    }
  }

  const startWidthPt = emuToPoints(options.startWidthEmu);
  const startHeightPt = emuToPoints(options.startHeightEmu);
  const widthScale = widthPt / startWidthPt;
  const heightScale = heightPt / startHeightPt;

  let previewWidth = Math.max(1, options.startBounds.width * widthScale);
  let previewHeight = Math.max(1, options.startBounds.height * heightScale);
  let previewX = options.startBounds.x;
  let previewY = options.startBounds.y;
  const screenHandle = options.handle;
  if (screenHandle.includes('w'))
    previewX = options.startBounds.x + options.startBounds.width - previewWidth;
  if (screenHandle.includes('n'))
    previewY = options.startBounds.y + options.startBounds.height - previewHeight;

  let position: DrawingPositionInput | null = null;
  if (
    options.kind === 'anchored' &&
    options.startPosition &&
    (screenHandle.includes('w') || screenHandle.includes('n'))
  ) {
    if (options.startPosition.mode === 'simple') {
      const deltaXEmu = screenHandle.includes('w')
        ? pointsToEmu(previewX - options.startBounds.x)
        : 0;
      const deltaYEmu = screenHandle.includes('n')
        ? pointsToEmu(previewY - options.startBounds.y)
        : 0;
      position = Object.freeze({
        mode: 'simple' as const,
        horizontalEmu: (options.startPosition.horizontalEmu ?? 0) + deltaXEmu,
        verticalEmu: (options.startPosition.verticalEmu ?? 0) + deltaYEmu,
      });
    } else if (options.anchorFrameOrigin) {
      position = Object.freeze({
        mode: 'frame' as const,
        ...(options.startPosition.relativeToH !== undefined
          ? { relativeToH: options.startPosition.relativeToH }
          : {}),
        ...(options.startPosition.relativeToV !== undefined
          ? { relativeToV: options.startPosition.relativeToV }
          : {}),
        ...(screenHandle.includes('w')
          ? { horizontalEmu: pointsToEmu(previewX - options.anchorFrameOrigin.x) }
          : options.startPosition.horizontalEmu !== undefined
            ? { horizontalEmu: options.startPosition.horizontalEmu }
            : {}),
        ...(screenHandle.includes('n')
          ? { verticalEmu: pointsToEmu(previewY - options.anchorFrameOrigin.y) }
          : options.startPosition.verticalEmu !== undefined
            ? { verticalEmu: options.startPosition.verticalEmu }
            : {}),
      });
    } else {
      const deltaXEmu = screenHandle.includes('w')
        ? pointsToEmu(previewX - options.startBounds.x)
        : 0;
      const deltaYEmu = screenHandle.includes('n')
        ? pointsToEmu(previewY - options.startBounds.y)
        : 0;
      position = Object.freeze({
        mode: 'frame' as const,
        ...(options.startPosition.horizontalEmu !== undefined
          ? { horizontalEmu: options.startPosition.horizontalEmu + deltaXEmu }
          : {}),
        ...(options.startPosition.verticalEmu !== undefined
          ? { verticalEmu: options.startPosition.verticalEmu + deltaYEmu }
          : {}),
        ...(options.startPosition.relativeToH !== undefined
          ? { relativeToH: options.startPosition.relativeToH }
          : {}),
        ...(options.startPosition.relativeToV !== undefined
          ? { relativeToV: options.startPosition.relativeToV }
          : {}),
      });
    }
  }

  return Object.freeze({
    widthEmu: pointsToEmu(widthPt),
    heightEmu: pointsToEmu(heightPt),
    previewBounds: Object.freeze({
      x: previewX,
      y: previewY,
      width: previewWidth,
      height: previewHeight,
    }),
    position,
  });
}

export function createImageOverlayScrollPort(
  scroller: HTMLElement,
  paintScale: number
): { scrollBy(deltaYPoints: number): number } {
  return Object.freeze({
    scrollBy(deltaYPoints: number): number {
      if (!Number.isFinite(deltaYPoints) || deltaYPoints === 0) return 0;
      const before = scroller.scrollTop;
      scroller.scrollTop += deltaYPoints * paintScale;
      return (scroller.scrollTop - before) / paintScale;
    },
  });
}

export interface FinalizedImageOverlayInteraction extends ImageResizeResult {
  readonly position: DrawingPositionInput | null;
}

/** Recompute the committed overlay result from release pointer coordinates. */
export function finalizeImageOverlayInteraction(options: {
  readonly session: ImageInteractionSession;
  readonly deltaXPt: number;
  readonly deltaYPt: number;
  readonly accumulatedScrollPt: number;
  readonly aspectLocked: boolean;
  readonly shiftKey: boolean;
  readonly anchorFrameOrigin: AnchorFrameOrigin | null;
}): FinalizedImageOverlayInteraction {
  if (options.session.mode === 'move') {
    const x = options.session.startBounds.x + options.deltaXPt;
    const y = options.session.startBounds.y + options.deltaYPt + options.accumulatedScrollPt;
    const position =
      options.session.startPosition &&
      computeMovedImagePosition(
        options.session.startPosition,
        options.deltaXPt,
        options.deltaYPt + options.accumulatedScrollPt
      );
    return Object.freeze({
      widthEmu: options.session.startWidthEmu,
      heightEmu: options.session.startHeightEmu,
      previewBounds: Object.freeze({
        x,
        y,
        width: options.session.startBounds.width,
        height: options.session.startBounds.height,
      }),
      position: position ?? null,
    });
  }
  if (!options.session.handle) {
    return Object.freeze({
      widthEmu: options.session.startWidthEmu,
      heightEmu: options.session.startHeightEmu,
      previewBounds: options.session.startBounds,
      position: null,
    });
  }
  return computeImageResizeResult({
    handle: options.session.handle,
    startWidthEmu: options.session.startWidthEmu,
    startHeightEmu: options.session.startHeightEmu,
    startBounds: options.session.startBounds,
    startPosition: options.session.startPosition,
    anchorFrameOrigin: options.anchorFrameOrigin,
    deltaXPt: options.deltaXPt,
    deltaYPt: options.deltaYPt,
    transform: options.session.transform,
    preserveAspect: resizePreservesAspect(
      options.session.handle,
      options.aspectLocked,
      options.shiftKey
    ),
    kind: options.session.kind,
  });
}
