// Task 8 fix round 5 — a:srcRect crops image pixels only; preset clip/hit/wrap unchanged.

import { describe, expect, test } from 'bun:test';
import type { DrawingTransform } from '../../store/package/drawing-projection.ts';
import {
  computeDrawingGeometry,
  pointInDrawingClip,
  type DrawingGeometryInput,
} from '../drawing-geometry.ts';
import {
  excludedIntervalsOnScanline,
  normalizeWrapPolygonToPage,
  wrapExclusionFromProjection,
} from '../drawing-wrap.ts';
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

const NON_EMPTY_CROP = { left: 0.15, top: 0.1, right: 0.2, bottom: 0.25 };

function geometryInput(overrides: Partial<DrawingGeometryInput> = {}): DrawingGeometryInput {
  return {
    extentWidth: 100,
    extentHeight: 50,
    anchorX: 0,
    anchorY: 0,
    effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    transform: identityTransform({ cx: 100 * EMU_PER_POINT, cy: 50 * EMU_PER_POINT }),
    presetGeometry: 'ellipse',
    ...overrides,
  };
}

function clipExtents(polygon: readonly { x: number; y: number }[]) {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

describe('fix round 5 — srcRect does not shrink preset clip', () => {
  test('ellipse clip polygon matches uncropped geometry when crop is non-empty', () => {
    const uncropped = computeDrawingGeometry(geometryInput());
    const cropped = computeDrawingGeometry(geometryInput({ crop: NON_EMPTY_CROP }));
    expect(cropped.clipFallback).toBe('none');
    expect(clipExtents(cropped.clipPolygon!)).toEqual(clipExtents(uncropped.clipPolygon!));
  });

  test('roundRect clip polygon matches uncropped geometry when crop is non-empty', () => {
    const uncropped = computeDrawingGeometry(geometryInput({ presetGeometry: 'roundRect' }));
    const cropped = computeDrawingGeometry(
      geometryInput({ presetGeometry: 'roundRect', crop: NON_EMPTY_CROP })
    );
    expect(cropped.clipFallback).toBe('none');
    expect(clipExtents(cropped.clipPolygon!)).toEqual(clipExtents(uncropped.clipPolygon!));
  });

  test('unsupported preset keeps rectangular fallback and diagnostic with crop present', () => {
    const geometry = computeDrawingGeometry(
      geometryInput({ presetGeometry: 'flowChartMagneticDisk', crop: NON_EMPTY_CROP })
    );
    expect(geometry.clipFallback).toBe('unsupported-preset');
    const xs = geometry.clipPolygon!.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 1);
    expect(Math.max(...xs)).toBeCloseTo(100, 1);
  });
});

describe('fix round 5 — crop does not change hit region for preset clip', () => {
  test('ellipse corner misses and center hits identically with and without crop', () => {
    const uncropped = computeDrawingGeometry(geometryInput());
    const cropped = computeDrawingGeometry(geometryInput({ crop: NON_EMPTY_CROP }));
    for (const geometry of [uncropped, cropped]) {
      expect(pointInDrawingClip(0, 0, geometry)).toBe(false);
      expect(pointInDrawingClip(50, 25, geometry)).toBe(true);
      expect(pointInDrawingClip(100, 0, geometry)).toBe(false);
    }
  });

  test('roundRect corner misses and center hits identically with and without crop', () => {
    const uncropped = computeDrawingGeometry(geometryInput({ presetGeometry: 'roundRect' }));
    const cropped = computeDrawingGeometry(
      geometryInput({ presetGeometry: 'roundRect', crop: NON_EMPTY_CROP })
    );
    for (const geometry of [uncropped, cropped]) {
      expect(pointInDrawingClip(0, 0, geometry)).toBe(false);
      expect(pointInDrawingClip(50, 25, geometry)).toBe(true);
      expect(pointInDrawingClip(100, 0, geometry)).toBe(false);
    }
  });
});

describe('fix round 5 — crop does not remap wrap polygon', () => {
  const wrapSquareEmu = Object.freeze([
    { x: 0, y: 0 },
    { x: 100 * EMU_PER_POINT, y: 0 },
    { x: 100 * EMU_PER_POINT, y: 50 * EMU_PER_POINT },
    { x: 0, y: 50 * EMU_PER_POINT },
  ]);

  test('normalizeWrapPolygonToPage ignores srcRect crop', () => {
    const uncropped = normalizeWrapPolygonToPage({
      polygonEmu: wrapSquareEmu,
      extentWidthPt: 100,
      extentHeightPt: 50,
      anchorX: 10,
      anchorY: 20,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: identityTransform({ cx: 100 * EMU_PER_POINT, cy: 50 * EMU_PER_POINT }),
    });
    const cropped = normalizeWrapPolygonToPage({
      polygonEmu: wrapSquareEmu,
      extentWidthPt: 100,
      extentHeightPt: 50,
      anchorX: 10,
      anchorY: 20,
      crop: NON_EMPTY_CROP,
      transform: identityTransform({ cx: 100 * EMU_PER_POINT, cy: 50 * EMU_PER_POINT }),
    });
    expect(cropped).toEqual(uncropped);
  });

  test('tight wrap exclusion scanline unchanged when crop is non-empty with ellipse clip', () => {
    const uncroppedGeometry = computeDrawingGeometry(geometryInput());
    const croppedGeometry = computeDrawingGeometry(geometryInput({ crop: NON_EMPTY_CROP }));
    const base = {
      mode: 'tight' as const,
      contentBounds: uncroppedGeometry.contentBounds,
      wrapDistancesEmu: { top: 0, right: 0, bottom: 0, left: 0 },
      polygonEmu: wrapSquareEmu,
      transform: identityTransform({ cx: 100 * EMU_PER_POINT, cy: 50 * EMU_PER_POINT }),
      extentWidthPt: 100,
      extentHeightPt: 50,
      textSide: 'bothSides' as const,
      contentLeft: 0,
      contentRight: 200,
    };
    const uncroppedInput = wrapExclusionFromProjection({
      ...base,
      geometry: uncroppedGeometry,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
    });
    const croppedInput = wrapExclusionFromProjection({
      ...base,
      geometry: croppedGeometry,
      crop: NON_EMPTY_CROP,
    });
    const scanY = 25;
    expect(excludedIntervalsOnScanline(scanY, uncroppedInput)).toEqual(
      excludedIntervalsOnScanline(scanY, croppedInput)
    );
    expect(uncroppedInput.clipPolygon).toEqual(croppedInput.clipPolygon);
  });
});
