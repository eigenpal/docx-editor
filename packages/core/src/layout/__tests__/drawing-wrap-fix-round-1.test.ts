// Task 8 fix round 1 — anisotropic Minkowski, winding rules, side filtering, effect expansion.

import { describe, expect, test } from 'bun:test';
import type { DrawingTransform } from '../../store/package/drawing-projection.ts';
import {
  availableTextIntervalsOnScanline,
  excludedIntervalsOnScanline,
  expandPolygonAnisotropic,
  minkowskiExcludedIntervalsAtY,
  normalizeWrapPolygonToPage,
  type WrapExclusionInput,
} from '../drawing-wrap.ts';
import type { DrawingInsets, DrawingPoint } from '../drawing-geometry.ts';
import { EMU_PER_POINT } from '../drawing-layout.ts';

const identityTransform = (): DrawingTransform =>
  Object.freeze({
    rotationDegrees: 0,
    flipHorizontal: false,
    flipVertical: false,
    offsetEmu: Object.freeze({ x: 0, y: 0 }),
    extentEmu: Object.freeze({ cx: 100 * EMU_PER_POINT, cy: 100 * EMU_PER_POINT }),
  });

describe('fix round 1 — anisotropic Minkowski polygon offset', () => {
  test('concave L-shape Minkowski scanline expands asymmetrically preserving concavity', () => {
    const lShape: readonly DrawingPoint[] = Object.freeze([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 40 },
      { x: 0, y: 40 },
    ]);
    const insets: DrawingInsets = { top: 2, right: 4, bottom: 6, left: 8 };
    const excluded = minkowskiExcludedIntervalsAtY(lShape, 25, insets, 'nonzero');
    expect(excluded.length).toBeGreaterThan(0);
    expect(excluded[0]!.start).toBeLessThan(0);
    expect(excluded[excluded.length - 1]!.end).toBeGreaterThanOrEqual(44);
  });

  test('adversarial asymmetric concave polygon stays finite and bounded', () => {
    const concave: readonly DrawingPoint[] = Object.freeze([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 30 },
      { x: 35, y: 30 },
      { x: 35, y: 70 },
      { x: 100, y: 70 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const expanded = expandPolygonAnisotropic(
      concave,
      { top: 3, right: 5, bottom: 7, left: 11 },
      {
        top: 1,
        right: 2,
        bottom: 3,
        left: 4,
      }
    );
    expect(expanded.length).toBeGreaterThanOrEqual(3);
    expect(expanded.length).toBeLessThanOrEqual(256);
    for (const point of expanded) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });
});

describe('fix round 1 — tight nonzero vs through even-odd divergence', () => {
  const frame: readonly DrawingPoint[] = Object.freeze([
    { x: 50, y: 20 },
    { x: 150, y: 20 },
    { x: 150, y: 80 },
    { x: 50, y: 80 },
    { x: 50, y: 20 },
    { x: 80, y: 40 },
    { x: 120, y: 40 },
    { x: 120, y: 60 },
    { x: 80, y: 60 },
    { x: 80, y: 40 },
  ]);

  const baseInput = {
    contentBounds: { x: 50, y: 20, width: 100, height: 60 },
    polygon: frame,
    wrapDistances: { top: 0, right: 0, bottom: 0, left: 0 },
    effectInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    textSide: 'bothSides' as const,
    contentLeft: 0,
    contentRight: 200,
  };

  test('tight fills the outer region including the hole (nonzero winding)', () => {
    const excluded = excludedIntervalsOnScanline(50, { ...baseInput, mode: 'tight' });
    expect(excluded).toEqual([{ start: 50, end: 150 }]);
  });

  test('through retains interior passage (even-odd)', () => {
    const excluded = excludedIntervalsOnScanline(50, { ...baseInput, mode: 'through' });
    expect(excluded).toEqual([
      { start: 50, end: 80 },
      { start: 120, end: 150 },
    ]);
  });

  test('nonzero and even-odd agree on simple convex polygons', () => {
    const triangle: readonly DrawingPoint[] = Object.freeze([
      { x: 100, y: 30 },
      { x: 140, y: 70 },
      { x: 60, y: 70 },
    ]);
    const input = {
      ...baseInput,
      contentBounds: { x: 60, y: 30, width: 80, height: 40 },
      polygon: triangle,
    };
    const tight = excludedIntervalsOnScanline(50, { ...input, mode: 'tight' });
    const through = excludedIntervalsOnScanline(50, { ...input, mode: 'through' });
    expect(tight).toEqual(through);
  });
});

describe('fix round 1 — side filtering with multiple through passages', () => {
  const throughInput: WrapExclusionInput = {
    mode: 'through',
    contentBounds: { x: 50, y: 20, width: 100, height: 60 },
    polygon: Object.freeze([
      { x: 50, y: 20 },
      { x: 150, y: 20 },
      { x: 150, y: 80 },
      { x: 50, y: 80 },
      { x: 50, y: 20 },
      { x: 80, y: 40 },
      { x: 120, y: 40 },
      { x: 120, y: 60 },
      { x: 80, y: 60 },
      { x: 80, y: 40 },
    ]),
    wrapDistances: { top: 0, right: 0, bottom: 0, left: 0 },
    effectInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    textSide: 'bothSides',
    contentLeft: 0,
    contentRight: 200,
  };

  test('bothSides keeps left passage, interior, and right passage', () => {
    const available = availableTextIntervalsOnScanline(50, throughInput);
    expect(available).toEqual([
      { start: 0, end: 50 },
      { start: 80, end: 120 },
      { start: 150, end: 200 },
    ]);
  });

  test('left keeps only intervals entirely left of exclusion cluster', () => {
    const available = availableTextIntervalsOnScanline(50, { ...throughInput, textSide: 'left' });
    expect(available).toEqual([{ start: 0, end: 50 }]);
  });

  test('right keeps only intervals entirely right of exclusion cluster', () => {
    const available = availableTextIntervalsOnScanline(50, { ...throughInput, textSide: 'right' });
    expect(available).toEqual([{ start: 150, end: 200 }]);
  });

  test('largest picks the wider side for multi-passage through wrap', () => {
    const available = availableTextIntervalsOnScanline(50, {
      ...throughInput,
      textSide: 'largest',
    });
    // Right side (150-200 = 50) vs left (0-50 = 50) tied → prefer right per existing convention
    expect(available).toEqual([{ start: 150, end: 200 }]);
  });
});

describe('fix round 1 — effect extent expands wrap polygon before scanline', () => {
  test('normalizeWrapPolygonToPage applies xfrm scale and center rotation', () => {
    const page = normalizeWrapPolygonToPage({
      polygonEmu: Object.freeze([
        { x: 0, y: 0 },
        { x: 40 * EMU_PER_POINT, y: 0 },
        { x: 40 * EMU_PER_POINT, y: 20 * EMU_PER_POINT },
        { x: 0, y: 20 * EMU_PER_POINT },
      ]),
      extentWidthPt: 40,
      extentHeightPt: 20,
      anchorX: 5,
      anchorY: 5,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: Object.freeze({
        rotationDegrees: 90,
        flipHorizontal: false,
        flipVertical: false,
        offsetEmu: Object.freeze({ x: 0, y: 0 }),
        extentEmu: Object.freeze({ cx: 40 * EMU_PER_POINT, cy: 20 * EMU_PER_POINT }),
      }),
    });
    expect(page).not.toBeNull();
    const xs = page!.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 1);
  });

  test('effect and wrap distances expand tight exclusion via Minkowski not bounds scale', () => {
    const triangle: readonly DrawingPoint[] = Object.freeze([
      { x: 100, y: 30 },
      { x: 140, y: 70 },
      { x: 60, y: 70 },
    ]);
    const without = excludedIntervalsOnScanline(50, {
      mode: 'tight',
      contentBounds: { x: 60, y: 30, width: 80, height: 40 },
      polygon: triangle,
      wrapDistances: { top: 0, right: 0, bottom: 0, left: 0 },
      effectInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      textSide: 'bothSides',
      contentLeft: 0,
      contentRight: 200,
    });
    const withExpansion = excludedIntervalsOnScanline(50, {
      mode: 'tight',
      contentBounds: { x: 60, y: 30, width: 80, height: 40 },
      polygon: triangle,
      wrapDistances: { top: 0, right: 5, bottom: 0, left: 5 },
      effectInsets: { top: 0, right: 2, bottom: 0, left: 2 },
      textSide: 'bothSides',
      contentLeft: 0,
      contentRight: 200,
    });
    expect(withExpansion[0]!.start).toBeLessThan(without[0]!.start);
    expect(withExpansion[0]!.end).toBeGreaterThan(without[0]!.end);
  });
});

describe('fix round 1 — malformed wrap polygon guards', () => {
  test('empty polygon list yields bounded rectangle without looping', () => {
    const page = normalizeWrapPolygonToPage({
      polygonEmu: Object.freeze([]),
      extentWidthPt: 30,
      extentHeightPt: 20,
      anchorX: 0,
      anchorY: 0,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: identityTransform(),
    });
    expect(page!.length).toBe(4);
  });

  test('non-finite polygon coordinates are sanitized to finite values', () => {
    const page = normalizeWrapPolygonToPage({
      polygonEmu: Object.freeze([
        { x: Number.NaN, y: 0 },
        { x: 30 * EMU_PER_POINT, y: Number.POSITIVE_INFINITY },
        { x: 30 * EMU_PER_POINT, y: 20 * EMU_PER_POINT },
      ]),
      extentWidthPt: 30,
      extentHeightPt: 20,
      anchorX: 0,
      anchorY: 0,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: identityTransform(),
    });
    for (const point of page ?? []) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });
});
