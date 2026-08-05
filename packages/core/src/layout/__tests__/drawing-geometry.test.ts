// Drawing geometry normalization (typed-drawings-and-images task 8).

import { describe, expect, test } from 'bun:test';
import type { SourceCrop, DrawingTransform } from '../../store/package/drawing-projection.ts';
import {
  CROP_PERCENT_MAX,
  MAX_IMAGE_POLYGON_POINTS,
  ROTATION_UNITS_PER_DEGREE,
  computeDrawingGeometry,
  expandBoxByInsets,
  normalizeCropFractions,
  normalizeCropFromRaw,
  normalizeRotationDegrees,
  normalizeRotationFromRaw,
  presetClipPolygonLocal,
} from '../drawing-geometry.ts';
import { EMU_PER_POINT } from '../drawing-layout.ts';

describe('normalizeRotationFromRaw', () => {
  test('0/90/180/270 canonical degrees', () => {
    expect(normalizeRotationFromRaw(0)).toBe(0);
    expect(normalizeRotationFromRaw(90 * ROTATION_UNITS_PER_DEGREE)).toBe(90);
    expect(normalizeRotationFromRaw(180 * ROTATION_UNITS_PER_DEGREE)).toBe(180);
    expect(normalizeRotationFromRaw(270 * ROTATION_UNITS_PER_DEGREE)).toBe(270);
  });

  test('5400000 raw units is 90 degrees', () => {
    expect(normalizeRotationFromRaw(5_400_000)).toBe(90);
    expect(normalizeRotationDegrees(5_400_000)).toBe(90);
  });

  test('negative and over-turn values normalize modulo 360', () => {
    expect(normalizeRotationFromRaw(-90 * ROTATION_UNITS_PER_DEGREE)).toBe(270);
    expect(normalizeRotationFromRaw(390 * ROTATION_UNITS_PER_DEGREE)).toBe(30);
    expect(normalizeRotationFromRaw(360 * ROTATION_UNITS_PER_DEGREE)).toBe(0);
    expect(normalizeRotationFromRaw(720 * ROTATION_UNITS_PER_DEGREE)).toBe(0);
  });

  test('non-finite input yields zero', () => {
    expect(normalizeRotationFromRaw(Number.NaN)).toBe(0);
    expect(normalizeRotationFromRaw(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('normalizeCropFromRaw', () => {
  test('clamps each edge independently to [0, 100000]', () => {
    expect(normalizeCropFromRaw({ left: -1000, top: 0, right: 0, bottom: 0 })).toEqual({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    });
    expect(normalizeCropFromRaw({ left: 150_000, top: 0, right: 0, bottom: 0 })).toEqual({
      left: CROP_PERCENT_MAX,
      top: 0,
      right: 0,
      bottom: 0,
    });
  });

  test('normalizes opposing sums below 100000 without exceeding', () => {
    const crop = normalizeCropFromRaw({ left: 60_000, top: 0, right: 60_000, bottom: 0 });
    expect(crop.left + crop.right).toBeLessThan(CROP_PERCENT_MAX);
    expect(crop.left).toBeCloseTo(49_999.5, 1);
    expect(crop.right).toBeCloseTo(49_999.5, 1);
  });

  test('degenerate all-crop yields opposing sums below one', () => {
    const crop = normalizeCropFractions({ left: 1, top: 1, right: 1, bottom: 1 });
    expect(crop.left + crop.right).toBeLessThan(1);
    expect(crop.top + crop.bottom).toBeLessThan(1);
  });
});

describe('expandBoxByInsets', () => {
  test('effect extent expands bounds on authored edges', () => {
    const box = { x: 10, y: 20, width: 100, height: 50 };
    const expanded = expandBoxByInsets(box, { top: 2, right: 3, bottom: 4, left: 5 });
    expect(expanded).toEqual({ x: 5, y: 18, width: 108, height: 56 });
  });
});

describe('presetClipPolygonLocal', () => {
  test('rect preset fills the unit box', () => {
    const poly = presetClipPolygonLocal('rect', 100, 50);
    expect(poly).not.toBeNull();
    expect(poly!.length).toBe(4);
    expect(poly![0]).toEqual({ x: 0, y: 0 });
    expect(poly![2]).toEqual({ x: 100, y: 50 });
  });

  test('ellipse preset is a bounded approximation', () => {
    const poly = presetClipPolygonLocal('ellipse', 100, 50);
    expect(poly).not.toBeNull();
    expect(poly!.length).toBeGreaterThanOrEqual(8);
    expect(poly!.length).toBeLessThanOrEqual(MAX_IMAGE_POLYGON_POINTS);
    for (const point of poly!) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(100);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(50);
    }
  });

  test('unsupported preset returns null for rectangular fallback', () => {
    expect(presetClipPolygonLocal('flowChartMagneticDisk', 10, 10)).toBeNull();
    expect(presetClipPolygonLocal(null, 10, 10)).toBeNull();
  });
});

describe('computeDrawingGeometry', () => {
  const identityTransform: DrawingTransform = Object.freeze({
    rotationDegrees: 0,
    flipHorizontal: false,
    flipVertical: false,
    offsetEmu: Object.freeze({ x: 0, y: 0 }),
    extentEmu: Object.freeze({ cx: 0, cy: 0 }),
  });

  test('wp:extent remains authoritative layout size; xfrm does not resize content bounds', () => {
    const geometry = computeDrawingGeometry({
      extentWidth: 72,
      extentHeight: 48,
      anchorX: 10,
      anchorY: 20,
      effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: Object.freeze({
        rotationDegrees: 90,
        flipHorizontal: true,
        flipVertical: false,
        offsetEmu: Object.freeze({ x: 0, y: 0 }),
        extentEmu: Object.freeze({ cx: 0, cy: 0 }),
      }),
      presetGeometry: 'rect',
    });
    expect(geometry.contentBounds).toEqual({ x: 10, y: 20, width: 72, height: 48 });
    expect(geometry.contentBounds.width).toBe(72);
    expect(geometry.contentBounds.height).toBe(48);
  });

  test('effect extent expands paint and hit bounds before wrap distances', () => {
    const geometry = computeDrawingGeometry({
      extentWidth: 100,
      extentHeight: 50,
      anchorX: 0,
      anchorY: 0,
      effectExtentEmu: { top: 12_700, right: 25_400, bottom: 38_100, left: 50_800 },
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: identityTransform,
      presetGeometry: 'rect',
    });
    expect(geometry.effectInsets).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(geometry.paintBounds).toEqual({ x: -4, y: -1, width: 106, height: 54 });
    expect(geometry.hitBounds).toEqual(geometry.paintBounds);
  });

  test('90-degree rotation moves transformed corners without changing content bounds', () => {
    const geometry = computeDrawingGeometry({
      extentWidth: 40,
      extentHeight: 20,
      anchorX: 0,
      anchorY: 0,
      effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: Object.freeze({
        rotationDegrees: 90,
        flipHorizontal: false,
        flipVertical: false,
        offsetEmu: Object.freeze({ x: 0, y: 0 }),
        extentEmu: Object.freeze({ cx: 40 * EMU_PER_POINT, cy: 20 * EMU_PER_POINT }),
      }),
      presetGeometry: 'rect',
    });
    expect(geometry.transformedCorners).toHaveLength(4);
    const xs = geometry.transformedCorners.map((point) => point.x);
    const ys = geometry.transformedCorners.map((point) => point.y);
    // Bbox maps into authoritative wp:extent — corners fill the layout box.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(20, 1);
  });

  test('flip horizontal mirrors local geometry', () => {
    const geometry = computeDrawingGeometry({
      extentWidth: 100,
      extentHeight: 50,
      anchorX: 5,
      anchorY: 5,
      effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: Object.freeze({
        rotationDegrees: 0,
        flipHorizontal: true,
        flipVertical: false,
        offsetEmu: Object.freeze({ x: 0, y: 0 }),
        extentEmu: Object.freeze({ cx: 100 * EMU_PER_POINT, cy: 50 * EMU_PER_POINT }),
      }),
      presetGeometry: 'rect',
    });
    expect(geometry.transformedCorners[0]!.x).toBeCloseTo(105, 4);
    expect(geometry.transformedCorners[1]!.x).toBeCloseTo(5, 4);
  });

  test('crop does not shrink preset clip; full shape frame maps into wp:extent', () => {
    const uncropped = computeDrawingGeometry({
      extentWidth: 100,
      extentHeight: 100,
      anchorX: 0,
      anchorY: 0,
      effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: identityTransform,
      presetGeometry: 'rect',
    });
    const cropped = computeDrawingGeometry({
      extentWidth: 100,
      extentHeight: 100,
      anchorX: 0,
      anchorY: 0,
      effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
      crop: { left: 0.1, top: 0.2, right: 0.1, bottom: 0.2 },
      transform: identityTransform,
      presetGeometry: 'rect',
    });
    expect(cropped.contentBounds.width).toBe(100);
    const uncroppedXs = uncropped.clipPolygon!.map((point) => point.x);
    const uncroppedYs = uncropped.clipPolygon!.map((point) => point.y);
    const croppedXs = cropped.clipPolygon!.map((point) => point.x);
    const croppedYs = cropped.clipPolygon!.map((point) => point.y);
    expect(Math.min(...croppedXs)).toBeCloseTo(Math.min(...uncroppedXs), 1);
    expect(Math.max(...croppedXs)).toBeCloseTo(Math.max(...uncroppedXs), 1);
    expect(Math.min(...croppedYs)).toBeCloseTo(Math.min(...uncroppedYs), 1);
    expect(Math.max(...croppedYs)).toBeCloseTo(Math.max(...uncroppedYs), 1);
  });

  test('zero extent yields degenerate finite geometry', () => {
    const geometry = computeDrawingGeometry({
      extentWidth: 0,
      extentHeight: 50,
      anchorX: 0,
      anchorY: 0,
      effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: identityTransform,
      presetGeometry: 'rect',
    });
    expect(geometry.contentBounds.width).toBe(0);
    expect(Number.isFinite(geometry.paintBounds.x)).toBe(true);
    expect(geometry.transformedCorners).toHaveLength(4);
  });
});
