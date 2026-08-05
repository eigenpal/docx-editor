import { describe, expect, test } from 'bun:test';
import type { DrawingTransform } from '../../store/package/drawing-projection.ts';
import {
  computeImageResizeResult,
  finalizeImageOverlayInteraction,
} from '../surface-overlay-coordinates.ts';
import { EMU_PER_POINT, pointsToEmu } from '../docx-editor-images.ts';
import type { ImageInteractionSession } from '../docx-editor-images.ts';

const IDENTITY: DrawingTransform = Object.freeze({
  rotationDegrees: 0,
  flipHorizontal: false,
  flipVertical: false,
  offsetEmu: Object.freeze({ x: 0, y: 0 }),
  extentEmu: Object.freeze({ cx: 914_400, cy: 914_400 }),
});

describe('task 16 fix round 2 — flip-aware resize handles', () => {
  test('flipH maps visual east drag to local west extent growth', () => {
    const flipped: DrawingTransform = Object.freeze({
      ...IDENTITY,
      flipHorizontal: true,
    });
    const result = computeImageResizeResult({
      handle: 'e',
      startWidthEmu: pointsToEmu(72),
      startHeightEmu: pointsToEmu(48),
      startBounds: { x: 10, y: 20, width: 72, height: 48 },
      startPosition: null,
      deltaXPt: 12,
      deltaYPt: 0,
      transform: flipped,
      preserveAspect: false,
      kind: 'inline',
    });
    expect(result.widthEmu).toBe(pointsToEmu(84));
    expect(result.heightEmu).toBe(pointsToEmu(48));
  });

  test('flipV maps visual south drag to local north extent growth', () => {
    const flipped: DrawingTransform = Object.freeze({
      ...IDENTITY,
      flipVertical: true,
    });
    const result = computeImageResizeResult({
      handle: 's',
      startWidthEmu: pointsToEmu(72),
      startHeightEmu: pointsToEmu(48),
      startBounds: { x: 10, y: 20, width: 72, height: 48 },
      startPosition: null,
      deltaXPt: 0,
      deltaYPt: 10,
      transform: flipped,
      preserveAspect: false,
      kind: 'inline',
    });
    expect(result.widthEmu).toBe(pointsToEmu(72));
    expect(result.heightEmu).toBe(pointsToEmu(58));
  });

  test('flipH and flipV with rotation keep visual east edge movement', () => {
    const transform: DrawingTransform = Object.freeze({
      ...IDENTITY,
      rotationDegrees: 90,
      flipHorizontal: true,
      flipVertical: true,
    });
    const result = computeImageResizeResult({
      handle: 'e',
      startWidthEmu: pointsToEmu(72),
      startHeightEmu: pointsToEmu(48),
      startBounds: { x: 0, y: 0, width: 48, height: 72 },
      startPosition: null,
      deltaXPt: 8,
      deltaYPt: 0,
      transform,
      preserveAspect: false,
      kind: 'inline',
    });
    expect(result.widthEmu).toBe(pointsToEmu(72));
    expect(result.heightEmu).toBe(pointsToEmu(56));
    expect(result.previewBounds.height).toBeCloseTo(84, 4);
  });

  test('flipH west resize shifts preview x while growing width', () => {
    const flipped: DrawingTransform = Object.freeze({
      ...IDENTITY,
      flipHorizontal: true,
    });
    const result = computeImageResizeResult({
      handle: 'w',
      startWidthEmu: pointsToEmu(72),
      startHeightEmu: pointsToEmu(72),
      startBounds: { x: 20, y: 30, width: 72, height: 72 },
      startPosition: { mode: 'simple', horizontalEmu: 100_000, verticalEmu: 50_000 },
      deltaXPt: -12,
      deltaYPt: 0,
      transform: flipped,
      preserveAspect: false,
      kind: 'anchored',
    });
    expect(result.widthEmu).toBe(pointsToEmu(84));
    expect(result.previewBounds.x).toBeCloseTo(8, 4);
  });
});

describe('task 16 fix round 2 — aligned anchor west/north resize', () => {
  test('center/page west resize converts align to posOffset from frame origin', () => {
    const frameOrigin = Object.freeze({ x: 0, y: 72 });
    const startBounds = Object.freeze({ x: 234, y: 120, width: 72, height: 72 });
    const result = computeImageResizeResult({
      handle: 'w',
      startWidthEmu: pointsToEmu(72),
      startHeightEmu: pointsToEmu(72),
      startBounds,
      startPosition: Object.freeze({
        mode: 'frame' as const,
        relativeToH: 'page',
        relativeToV: 'margin',
      }),
      anchorFrameOrigin: frameOrigin,
      deltaXPt: 12,
      deltaYPt: 0,
      transform: IDENTITY,
      preserveAspect: false,
      kind: 'anchored',
    });
    expect(result.previewBounds.x).toBeCloseTo(246, 4);
    expect(result.previewBounds.width).toBeCloseTo(60, 4);
    expect(result.position).toEqual({
      mode: 'frame',
      relativeToH: 'page',
      relativeToV: 'margin',
      horizontalEmu: pointsToEmu(246 - frameOrigin.x),
    });
  });

  test('right/margin north resize converts align to posOffset from frame origin', () => {
    const frameOrigin = Object.freeze({ x: 0, y: 100 });
    const startBounds = Object.freeze({ x: 468, y: 150, width: 72, height: 72 });
    const result = computeImageResizeResult({
      handle: 'n',
      startWidthEmu: pointsToEmu(72),
      startHeightEmu: pointsToEmu(72),
      startBounds,
      startPosition: Object.freeze({
        mode: 'frame' as const,
        relativeToH: 'margin',
        relativeToV: 'margin',
      }),
      anchorFrameOrigin: frameOrigin,
      deltaXPt: 0,
      deltaYPt: -10,
      transform: IDENTITY,
      preserveAspect: false,
      kind: 'anchored',
    });
    expect(result.previewBounds.y).toBeCloseTo(140, 4);
    expect(result.previewBounds.height).toBeCloseTo(82, 4);
    expect(result.position).toEqual({
      mode: 'frame',
      relativeToH: 'margin',
      relativeToV: 'margin',
      verticalEmu: pointsToEmu(140 - frameOrigin.y),
    });
  });

  test('left/top cell frame preserves east/south edge on west+north resize', () => {
    const frameOrigin = Object.freeze({ x: 40, y: 200 });
    const startBounds = Object.freeze({ x: 40, y: 200, width: 80, height: 60 });
    const result = computeImageResizeResult({
      handle: 'nw',
      startWidthEmu: pointsToEmu(80),
      startHeightEmu: pointsToEmu(60),
      startBounds,
      startPosition: Object.freeze({
        mode: 'frame' as const,
        relativeToH: 'column',
        relativeToV: 'paragraph',
      }),
      anchorFrameOrigin: frameOrigin,
      deltaXPt: 10,
      deltaYPt: 8,
      transform: IDENTITY,
      preserveAspect: false,
      kind: 'anchored',
    });
    const east = startBounds.x + startBounds.width;
    const south = startBounds.y + startBounds.height;
    expect(result.previewBounds.x + result.previewBounds.width).toBeCloseTo(east, 4);
    expect(result.previewBounds.y + result.previewBounds.height).toBeCloseTo(south, 4);
    expect(result.position).toEqual({
      mode: 'frame',
      relativeToH: 'column',
      relativeToV: 'paragraph',
      horizontalEmu: pointsToEmu(result.previewBounds.x - frameOrigin.x),
      verticalEmu: pointsToEmu(result.previewBounds.y - frameOrigin.y),
    });
  });
});

describe('task 16 fix round 2 — pointer-up commit from release coordinates', () => {
  const baseSession: ImageInteractionSession = Object.freeze({
    drawingNodeId: 'd1',
    startBounds: Object.freeze({ x: 10, y: 20, width: 72, height: 48 }),
    startWidthEmu: pointsToEmu(72),
    startHeightEmu: pointsToEmu(48),
    startPosition: null,
    anchorFrameOrigin: null,
    transform: IDENTITY,
    mode: 'resize',
    handle: 'e',
    preconditions: Object.freeze({
      mountGeneration: 0,
      packageRevision: 0,
      drawingNodeId: 'd1',
      selectionParagraphId: 'p1',
      selectionOffset: 0,
    }),
    layoutRevision: 0,
    packageRevision: 0,
    kind: 'inline',
  });

  test('resize commit uses release delta not stale preview bounds', () => {
    const commit = finalizeImageOverlayInteraction({
      session: baseSession,
      deltaXPt: 20,
      deltaYPt: 0,
      accumulatedScrollPt: 0,
      aspectLocked: false,
      shiftKey: false,
      anchorFrameOrigin: null,
    });
    expect(commit.widthEmu).toBe(pointsToEmu(92));
    expect(commit.heightEmu).toBe(pointsToEmu(48));
    expect(commit.previewBounds.width).toBeCloseTo(92, 4);
  });

  test('move commit uses release delta plus accumulated scroll without pointermove', () => {
    const moveSession: ImageInteractionSession = Object.freeze({
      ...baseSession,
      mode: 'move',
      handle: null,
      startPosition: Object.freeze({
        mode: 'simple' as const,
        horizontalEmu: 100_000,
        verticalEmu: 50_000,
      }),
      kind: 'anchored',
    });
    const commit = finalizeImageOverlayInteraction({
      session: moveSession,
      deltaXPt: 15,
      deltaYPt: 6,
      accumulatedScrollPt: 24,
      aspectLocked: false,
      shiftKey: false,
      anchorFrameOrigin: null,
    });
    expect(commit.previewBounds.x).toBeCloseTo(25, 4);
    expect(commit.previewBounds.y).toBeCloseTo(50, 4);
    expect(commit.position).toEqual({
      mode: 'simple',
      horizontalEmu: 100_000 + pointsToEmu(15),
      verticalEmu: 50_000 + pointsToEmu(6 + 24),
    });
  });
});
