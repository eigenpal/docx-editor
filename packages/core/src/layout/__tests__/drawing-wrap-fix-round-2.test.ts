// Task 8 fix round 2 — exact Minkowski scanline exclusion, content clamping, preset interval intersection.

import { describe, expect, test } from 'bun:test';
import type { DrawingTransform } from '../../store/package/drawing-projection.ts';
import {
  availableTextIntervalsOnScanline,
  excludedIntervalsOnScanline,
  intersectScanlineIntervals,
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

describe('fix round 2 — exact anisotropic Minkowski scanline exclusion', () => {
  test('reversed winding concave L expands asymmetrically without fake offset ring', () => {
    const reversed: readonly DrawingPoint[] = Object.freeze([
      { x: 0, y: 40 },
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 40 },
    ]);
    const insets: DrawingInsets = { top: 2, right: 4, bottom: 6, left: 8 };
    const excluded = minkowskiExcludedIntervalsAtY(reversed, 25, insets, 'nonzero');
    expect(excluded.length).toBeGreaterThan(0);
    expect(excluded[0]!.start).toBeLessThan(0);
    expect(excluded[excluded.length - 1]!.end).toBeGreaterThanOrEqual(44);
  });

  test('U-channel through wrap closes channel at band boundaries (even-odd)', () => {
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
    const excluded = minkowskiExcludedIntervalsAtY(
      frame,
      50,
      { top: 0, right: 0, bottom: 0, left: 0 },
      'evenodd'
    );
    expect(excluded).toEqual([
      { start: 50, end: 80 },
      { start: 120, end: 150 },
    ]);
  });

  test('self-intersecting bowtie uses even-odd vs nonzero divergence', () => {
    const bowtie: readonly DrawingPoint[] = Object.freeze([
      { x: 0, y: 0 },
      { x: 40, y: 40 },
      { x: 40, y: 0 },
      { x: 0, y: 40 },
    ]);
    const insets: DrawingInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    const tight = minkowskiExcludedIntervalsAtY(bowtie, 20, insets, 'nonzero');
    const through = minkowskiExcludedIntervalsAtY(bowtie, 20, insets, 'evenodd');
    expect(tight.length).toBeGreaterThan(0);
    expect(through.length).toBeLessThanOrEqual(tight.length);
  });

  test('asymmetric distances expand left and right independently on scanline', () => {
    const segment: readonly DrawingPoint[] = Object.freeze([
      { x: 100, y: 40 },
      { x: 140, y: 40 },
      { x: 140, y: 60 },
      { x: 100, y: 60 },
    ]);
    const excluded = minkowskiExcludedIntervalsAtY(
      segment,
      50,
      { top: 0, right: 10, bottom: 0, left: 5 },
      'nonzero'
    );
    expect(excluded).toEqual([{ start: 95, end: 150 }]);
  });

  test('tight mode uses Minkowski scanline not expanded polygon ring', () => {
    const triangle: readonly DrawingPoint[] = Object.freeze([
      { x: 100, y: 30 },
      { x: 140, y: 70 },
      { x: 60, y: 70 },
    ]);
    const input: WrapExclusionInput = {
      mode: 'tight',
      contentBounds: { x: 60, y: 30, width: 80, height: 40 },
      polygon: triangle,
      wrapDistances: { top: 0, right: 5, bottom: 0, left: 5 },
      effectInsets: { top: 0, right: 2, bottom: 0, left: 2 },
      textSide: 'bothSides',
      contentLeft: 0,
      contentRight: 200,
    };
    const excluded = excludedIntervalsOnScanline(50, input);
    expect(excluded[0]!.start).toBeLessThan(80);
    expect(excluded[0]!.end).toBeGreaterThan(120);
  });
});

describe('fix round 2 — clamp exclusions to content band before inversion', () => {
  const baseInput: WrapExclusionInput = {
    mode: 'square',
    contentBounds: { x: 80, y: 40, width: 40, height: 20 },
    polygon: null,
    wrapDistances: { top: 0, right: 0, bottom: 0, left: 0 },
    effectInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    textSide: 'bothSides',
    contentLeft: 0,
    contentRight: 200,
  };

  test('exclusion entirely outside content yields empty clamped intervals', () => {
    const excluded = excludedIntervalsOnScanline(50, {
      ...baseInput,
      contentBounds: { x: 300, y: 40, width: 40, height: 20 },
    });
    expect(excluded).toEqual([]);
  });

  test('partial overlap clamps to content left/right', () => {
    const excluded = excludedIntervalsOnScanline(50, {
      ...baseInput,
      contentBounds: { x: 0, y: 40, width: 60, height: 20 },
      wrapDistances: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    expect(excluded).toEqual([{ start: 0, end: 60 }]);
  });

  test('multiple passages clamp individually before available inversion', () => {
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
      contentLeft: 60,
      contentRight: 140,
    };
    const available = availableTextIntervalsOnScanline(50, throughInput);
    expect(available).toEqual([{ start: 80, end: 120 }]);
  });
});

describe('fix round 2 — wrap polygon single xfrm pass (no double scale)', () => {
  test('wrap polygon maps exactly to wp:extent outer bounds once', () => {
    const page = normalizeWrapPolygonToPage({
      polygonEmu: Object.freeze([
        { x: 0, y: 0 },
        { x: 40 * EMU_PER_POINT, y: 0 },
        { x: 40 * EMU_PER_POINT, y: 20 * EMU_PER_POINT },
        { x: 0, y: 20 * EMU_PER_POINT },
      ]),
      extentWidthPt: 80,
      extentHeightPt: 40,
      anchorX: 10,
      anchorY: 20,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: Object.freeze({
        rotationDegrees: 0,
        flipHorizontal: false,
        flipVertical: false,
        offsetEmu: Object.freeze({ x: 0, y: 0 }),
        extentEmu: Object.freeze({ cx: 40 * EMU_PER_POINT, cy: 20 * EMU_PER_POINT }),
      }),
    });
    const xs = page!.map((p) => p.x);
    const ys = page!.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(10, 2);
    expect(Math.max(...xs)).toBeCloseTo(90, 2);
    expect(Math.min(...ys)).toBeCloseTo(20, 2);
    expect(Math.max(...ys)).toBeCloseTo(60, 2);
  });
});

describe('fix round 2 — preset clip interval intersection for wrap', () => {
  test('intersectScanlineIntervals returns exact overlap', () => {
    expect(
      intersectScanlineIntervals(
        [
          { start: 10, end: 50 },
          { start: 60, end: 90 },
        ],
        [{ start: 30, end: 70 }]
      )
    ).toEqual([
      { start: 30, end: 50 },
      { start: 60, end: 70 },
    ]);
  });

  test('tight exclusion intersects wrap shape with preset clip intervals', () => {
    const triangle: readonly DrawingPoint[] = Object.freeze([
      { x: 100, y: 30 },
      { x: 140, y: 70 },
      { x: 60, y: 70 },
    ]);
    const clipIntervals = [{ start: 90, end: 130 }];
    const wrapIntervals = minkowskiExcludedIntervalsAtY(
      triangle,
      50,
      { top: 0, right: 0, bottom: 0, left: 0 },
      'nonzero'
    );
    const intersected = intersectScanlineIntervals(wrapIntervals, clipIntervals);
    expect(intersected[0]!.start).toBeGreaterThanOrEqual(90);
    expect(intersected[0]!.end).toBeLessThanOrEqual(130);
  });
});
