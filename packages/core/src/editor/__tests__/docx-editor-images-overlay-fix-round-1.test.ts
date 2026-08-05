import { describe, expect, test } from 'bun:test';
import type { DrawingTransform } from '../../store/package/drawing-projection.ts';
import {
  computeImageResizeResult,
  createImageOverlayScrollPort,
  cssPixelsToLayoutPoints,
  layoutPointsToCssPixels,
  resizePreservesAspect,
  surfacePaintScale,
} from '../surface-overlay-coordinates.ts';
import { EMU_PER_POINT, pointsToEmu } from '../docx-editor-images.ts';

const IDENTITY: DrawingTransform = Object.freeze({
  rotationDegrees: 0,
  flipHorizontal: false,
  flipVertical: false,
  offsetEmu: Object.freeze({ x: 0, y: 0 }),
  extentEmu: Object.freeze({ cx: 914_400, cy: 914_400 }),
});

describe('task 16 fix round 1 — surface paint scale', () => {
  test('uses zoom * 96/72 for points to CSS pixels', () => {
    expect(surfacePaintScale(1)).toBeCloseTo(96 / 72, 8);
    expect(surfacePaintScale(1.5)).toBeCloseTo(1.5 * (96 / 72), 8);
  });

  test('converts CSS pixels and layout points inversely', () => {
    const scale = surfacePaintScale(1);
    expect(cssPixelsToLayoutPoints(96, scale)).toBeCloseTo(72, 8);
    expect(layoutPointsToCssPixels(72, scale)).toBeCloseTo(96, 8);
  });
});

describe('task 16 fix round 1 — aspect policy', () => {
  test('noChangeAspect hard lock ignores shift on corners', () => {
    expect(resizePreservesAspect('se', true, false)).toBe(true);
    expect(resizePreservesAspect('se', true, true)).toBe(true);
  });

  test('corner resize preserves aspect by default without hard lock', () => {
    expect(resizePreservesAspect('nw', false, false)).toBe(true);
    expect(resizePreservesAspect('se', false, false)).toBe(true);
  });

  test('shift frees aspect on corners when not hard locked', () => {
    expect(resizePreservesAspect('se', false, true)).toBe(false);
  });

  test('edge handles change one axis only', () => {
    const east = computeImageResizeResult({
      handle: 'e',
      startWidthEmu: pointsToEmu(72),
      startHeightEmu: pointsToEmu(48),
      startBounds: { x: 10, y: 20, width: 72, height: 48 },
      startPosition: null,
      deltaXPt: 12,
      deltaYPt: 0,
      transform: IDENTITY,
      preserveAspect: false,
      kind: 'inline',
    });
    expect(east.widthEmu).toBe(pointsToEmu(84));
    expect(east.heightEmu).toBe(pointsToEmu(48));

    const north = computeImageResizeResult({
      handle: 'n',
      startWidthEmu: pointsToEmu(72),
      startHeightEmu: pointsToEmu(48),
      startBounds: { x: 10, y: 20, width: 72, height: 48 },
      startPosition: null,
      deltaXPt: 0,
      deltaYPt: -6,
      transform: IDENTITY,
      preserveAspect: false,
      kind: 'inline',
    });
    expect(north.widthEmu).toBe(pointsToEmu(72));
    expect(north.heightEmu).toBe(pointsToEmu(54));
  });
});

describe('task 16 fix round 1 — resize from EMU with rotation', () => {
  test('maps pointer delta through inverse rotation before changing extent', () => {
    const rotated: DrawingTransform = Object.freeze({
      ...IDENTITY,
      rotationDegrees: 90,
    });
    const result = computeImageResizeResult({
      handle: 'e',
      startWidthEmu: pointsToEmu(72),
      startHeightEmu: pointsToEmu(48),
      startBounds: { x: 0, y: 0, width: 48, height: 72 },
      startPosition: { mode: 'simple', horizontalEmu: 0, verticalEmu: 0 },
      deltaXPt: 10,
      deltaYPt: 0,
      transform: rotated,
      preserveAspect: false,
      kind: 'anchored',
    });
    expect(result.widthEmu).toBe(pointsToEmu(72));
    expect(result.heightEmu).toBe(pointsToEmu(58));
  });

  test('west resize on anchored image commits position delta with extent', () => {
    const result = computeImageResizeResult({
      handle: 'w',
      startWidthEmu: pointsToEmu(72),
      startHeightEmu: pointsToEmu(72),
      startBounds: { x: 20, y: 30, width: 72, height: 72 },
      startPosition: { mode: 'simple', horizontalEmu: 100_000, verticalEmu: 50_000 },
      deltaXPt: 12,
      deltaYPt: 0,
      transform: IDENTITY,
      preserveAspect: false,
      kind: 'anchored',
    });
    expect(result.widthEmu).toBe(pointsToEmu(60));
    expect(result.position).toEqual({
      mode: 'simple',
      horizontalEmu: 100_000 + pointsToEmu(12),
      verticalEmu: 50_000,
    });
    expect(result.previewBounds.x).toBeCloseTo(32, 4);
    expect(result.previewBounds.width).toBeCloseTo(60, 4);
  });

  test('inline west resize keeps southeast corner fixed in preview only', () => {
    const result = computeImageResizeResult({
      handle: 'w',
      startWidthEmu: pointsToEmu(72),
      startHeightEmu: pointsToEmu(72),
      startBounds: { x: 20, y: 30, width: 72, height: 72 },
      startPosition: null,
      deltaXPt: 12,
      deltaYPt: 0,
      transform: IDENTITY,
      preserveAspect: false,
      kind: 'inline',
    });
    expect(result.position).toBeNull();
    expect(result.previewBounds.x).toBeCloseTo(32, 4);
    expect(result.previewBounds.width).toBeCloseTo(60, 4);
  });

  test('effect-sized paint bounds do not change committed EMU extent baseline', () => {
    const result = computeImageResizeResult({
      handle: 'e',
      startWidthEmu: pointsToEmu(72),
      startHeightEmu: pointsToEmu(72),
      startBounds: { x: 0, y: 0, width: 90, height: 90 },
      startPosition: null,
      deltaXPt: 6,
      deltaYPt: 0,
      transform: IDENTITY,
      preserveAspect: false,
      kind: 'inline',
    });
    expect(result.widthEmu).toBe(pointsToEmu(78));
    expect(result.heightEmu).toBe(pointsToEmu(72));
  });
});

describe('task 16 fix round 1 — scroll port', () => {
  test('returns actual applied scroll delta in layout points', () => {
    let scrollTop = 0;
    const scroller = document.createElement('div');
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    const port = createImageOverlayScrollPort(scroller, surfacePaintScale(1));
    const applied = port.scrollBy(12);
    expect(applied).toBeCloseTo(12, 4);
    expect(scrollTop).toBeCloseTo(12 * surfacePaintScale(1), 4);
  });
});

describe('task 16 fix round 1 — corner aspect from EMU', () => {
  test('corner resize preserves aspect using EMU extents', () => {
    const result = computeImageResizeResult({
      handle: 'se',
      startWidthEmu: pointsToEmu(72),
      startHeightEmu: pointsToEmu(36),
      startBounds: { x: 0, y: 0, width: 72, height: 36 },
      startPosition: null,
      deltaXPt: 18,
      deltaYPt: 4,
      transform: IDENTITY,
      preserveAspect: true,
      kind: 'inline',
    });
    const aspect = result.widthEmu / result.heightEmu;
    expect(aspect).toBeCloseTo(2, 3);
  });
});
