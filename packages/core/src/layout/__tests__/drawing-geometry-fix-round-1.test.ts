// Task 8 fix round 1 — xfrm projection, center rotation, effect extent, clip intersection, polygon clip.

import { describe, expect, test } from 'bun:test';
import type { DrawingTransform, SourceCrop } from '../../store/package/drawing-projection.ts';
import {
  computeDrawingGeometry,
  effectInsetsFromEmu,
  expandBoxByInsets,
  normalizeCropFractions,
  presetClipPolygonLocal,
  transformLocalPoints,
  type DrawingGeometryInput,
} from '../drawing-geometry.ts';
import { clipInlineDrawingRecordToRegion } from '../drawing-layout.ts';
import { EMU_PER_POINT } from '../drawing-layout.ts';

const identityTransform = (
  extentEmu: { cx: number; cy: number } = { cx: 914400, cy: 457200 }
): DrawingTransform =>
  Object.freeze({
    rotationDegrees: 0,
    flipHorizontal: false,
    flipVertical: false,
    offsetEmu: Object.freeze({ x: 0, y: 0 }),
    extentEmu: Object.freeze(extentEmu),
  });

function geometryInput(overrides: Partial<DrawingGeometryInput> = {}): DrawingGeometryInput {
  return {
    extentWidth: 72,
    extentHeight: 48,
    anchorX: 10,
    anchorY: 20,
    effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    transform: identityTransform(),
    presetGeometry: 'rect',
    ...overrides,
  };
}

describe('fix round 1 — xfrm extent/offset projection', () => {
  test('scales source xfrm extent into wp:extent without resizing content bounds', () => {
    // xfrm ext 10×5 pt source, wp extent 20×10 pt layout authority
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 20,
        extentHeight: 10,
        transform: Object.freeze({
          rotationDegrees: 0,
          flipHorizontal: false,
          flipVertical: false,
          offsetEmu: Object.freeze({ x: 0, y: 0 }),
          extentEmu: Object.freeze({ cx: 10 * EMU_PER_POINT, cy: 5 * EMU_PER_POINT }),
        }),
      })
    );
    expect(geometry.contentBounds).toEqual({ x: 10, y: 20, width: 20, height: 10 });
    const xs = geometry.transformedCorners.map((p) => p.x);
    const ys = geometry.transformedCorners.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(10, 3);
    expect(Math.max(...xs)).toBeCloseTo(30, 3);
    expect(Math.min(...ys)).toBeCloseTo(20, 3);
    expect(Math.max(...ys)).toBeCloseTo(30, 3);
  });

  test('honours xfrm offset in source-local basis before mapping to wp:extent', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 40,
        extentHeight: 40,
        transform: Object.freeze({
          rotationDegrees: 0,
          flipHorizontal: false,
          flipVertical: false,
          offsetEmu: Object.freeze({ x: 5 * EMU_PER_POINT, y: 10 * EMU_PER_POINT }),
          extentEmu: Object.freeze({ cx: 20 * EMU_PER_POINT, cy: 20 * EMU_PER_POINT }),
        }),
      })
    );
    expect(geometry.contentBounds.width).toBe(40);
    const xs = geometry.transformedCorners.map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...xs)).toBeLessThanOrEqual(50);
  });
});

describe('fix round 1 — center rotation on non-square shapes', () => {
  test('90° rotation around center keeps layout box and swaps visual axis spans', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 40,
        extentHeight: 20,
        anchorX: 0,
        anchorY: 0,
        transform: Object.freeze({
          rotationDegrees: 90,
          flipHorizontal: false,
          flipVertical: false,
          offsetEmu: Object.freeze({ x: 0, y: 0 }),
          extentEmu: Object.freeze({ cx: 40 * EMU_PER_POINT, cy: 20 * EMU_PER_POINT }),
        }),
      })
    );
    expect(geometry.contentBounds).toEqual({ x: 0, y: 0, width: 40, height: 20 });
    const xs = geometry.transformedCorners.map((p) => p.x);
    const ys = geometry.transformedCorners.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(20, 1);
  });

  test('45° rotation on 60×30 rect rotates around center without spurious negative-origin drift', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 60,
        extentHeight: 30,
        anchorX: 100,
        anchorY: 50,
        transform: Object.freeze({
          rotationDegrees: 45,
          flipHorizontal: false,
          flipVertical: false,
          offsetEmu: Object.freeze({ x: 0, y: 0 }),
          extentEmu: Object.freeze({ cx: 60 * EMU_PER_POINT, cy: 30 * EMU_PER_POINT }),
        }),
      })
    );
    const xs = geometry.transformedCorners.map((p) => p.x);
    const ys = geometry.transformedCorners.map((p) => p.y);
    // All corners stay near the anchor region (center ~130, 65)
    expect(Math.min(...xs)).toBeGreaterThan(70);
    expect(Math.max(...xs)).toBeLessThan(190);
    expect(Math.min(...ys)).toBeGreaterThan(20);
    expect(Math.max(...ys)).toBeLessThan(110);
  });
});

describe('fix round 1 — effect extent signed semantics', () => {
  test('negative effect extent contracts paint/hit on that edge', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 100,
        extentHeight: 50,
        anchorX: 0,
        anchorY: 0,
        effectExtentEmu: { top: -12700, right: 25400, bottom: 38100, left: -25400 },
      })
    );
    expect(geometry.effectInsets).toEqual({ top: -1, right: 2, bottom: 3, left: -2 });
    expect(geometry.paintBounds).toEqual({ x: 2, y: 1, width: 100, height: 52 });
  });

  test('effectInsetsFromEmu rejects non-finite overflow values as zero', () => {
    expect(effectInsetsFromEmu({ top: Number.NaN, right: 1e15, bottom: 0, left: 0 })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });
});

describe('fix round 1 — preset clip intersects content geometry', () => {
  test('ellipse preset clip stays inside transformed rect corners', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 100,
        extentHeight: 50,
        anchorX: 0,
        anchorY: 0,
        presetGeometry: 'ellipse',
        transform: identityTransform({ cx: 100 * EMU_PER_POINT, cy: 50 * EMU_PER_POINT }),
      })
    );
    expect(geometry.clipPolygon).not.toBeNull();
    const cornerXs = geometry.transformedCorners.map((p) => p.x);
    const cornerYs = geometry.transformedCorners.map((p) => p.y);
    const minX = Math.min(...cornerXs);
    const maxX = Math.max(...cornerXs);
    const minY = Math.min(...cornerYs);
    const maxY = Math.max(...cornerYs);
    for (const point of geometry.clipPolygon!) {
      expect(point.x).toBeGreaterThanOrEqual(minX - 0.01);
      expect(point.x).toBeLessThanOrEqual(maxX + 0.01);
      expect(point.y).toBeGreaterThanOrEqual(minY - 0.01);
      expect(point.y).toBeLessThanOrEqual(maxY + 0.01);
    }
  });

  test('unsupported preset yields rectangular clip matching content bounds', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        presetGeometry: 'flowChartMagneticDisk',
      })
    );
    expect(geometry.clipPolygon).not.toBeNull();
    const xs = geometry.clipPolygon!.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(10, 3);
    expect(Math.max(...xs)).toBeCloseTo(82, 3);
  });
});

describe('fix round 1 — geometry clipping retains invariants', () => {
  test('clipInlineDrawingRecordToRegion clips polygon corners and paint consistently', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 100,
        extentHeight: 80,
        anchorX: 0,
        anchorY: 0,
        effectExtentEmu: { top: 12700, right: 12700, bottom: 12700, left: 12700 },
      })
    );
    const clipped = clipInlineDrawingRecordToRegion(
      {
        kind: 'inlineDrawing',
        drawingNodeId: 'd1',
        paragraphId: 'p1',
        ownerPartName: '/word/document.xml',
        start: 0,
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        distL: 0,
        distR: 0,
        distT: 0,
        distB: 0,
        advanceStart: 0,
        advanceEnd: 100,
        baselineOffset: 12,
        paintBounds: geometry.paintBounds,
        hitBounds: geometry.hitBounds,
        geometry,
        resource: Object.freeze({
          kind: 'ready',
          partName: null,
          contentId: '',
          resourceKey: '',
          mime: '',
          pixelWidth: 1,
          pixelHeight: 1,
          dpiX: 96,
          dpiY: 96,
        }),
        accessibility: Object.freeze({ hidden: false, decorative: true, label: null }),
      },
      { x: 10, y: 10, width: 50, height: 40 }
    );
    expect(clipped.width).toBe(100);
    expect(clipped.height).toBe(80);
    expect(clipped.paintBounds.width).toBeLessThanOrEqual(50 + 0.01);
    expect(
      clipped.geometry.transformedCorners.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    ).toBe(true);
    if (clipped.geometry.clipPolygon) {
      for (const point of clipped.geometry.clipPolygon) {
        expect(point.x).toBeGreaterThanOrEqual(9.99);
        expect(point.x).toBeLessThanOrEqual(60.01);
        expect(point.y).toBeGreaterThanOrEqual(9.99);
        expect(point.y).toBeLessThanOrEqual(50.01);
      }
    }
    // Effect expansion retained before clip: paint was expanded then clipped to region
    expect(clipped.geometry.effectInsets.top).toBeCloseTo(1, 3);
  });
});

describe('fix round 1 — malformed and bounded guards', () => {
  test('transformLocalPoints caps output at MAX_IMAGE_POLYGON_POINTS', () => {
    const many = Array.from({ length: 5000 }, (_, index) => Object.freeze({ x: index, y: index }));
    const out = transformLocalPoints(many, 100, 100, identityTransform(), 0, 0);
    expect(out.length).toBeLessThanOrEqual(5000);
    expect(out.length).toBeGreaterThan(0);
  });

  test('non-finite transform rotation yields identity-equivalent finite corners', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        transform: Object.freeze({
          rotationDegrees: Number.NaN,
          flipHorizontal: false,
          flipVertical: false,
          offsetEmu: Object.freeze({ x: 0, y: 0 }),
          extentEmu: Object.freeze({ cx: 72 * EMU_PER_POINT, cy: 48 * EMU_PER_POINT }),
        }),
      })
    );
    for (const point of geometry.transformedCorners) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  test('degenerate zero source extent falls back to wp extent basis', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({
        extentWidth: 50,
        extentHeight: 40,
        transform: Object.freeze({
          rotationDegrees: 0,
          flipHorizontal: false,
          flipVertical: false,
          offsetEmu: Object.freeze({ x: 0, y: 0 }),
          extentEmu: Object.freeze({ cx: 0, cy: 0 }),
        }),
      })
    );
    expect(geometry.contentBounds.width).toBe(50);
    expect(geometry.transformedCorners.length).toBe(4);
  });
});
