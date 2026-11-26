// Polygon wrap (20.4.2.19 wrapTight, contour from 20.4.2.16 wrapPolygon) keeps a line band
// clear of the contour over its whole height. A dense outline is probed at a bounded number
// of its vertices, and its outer extents stay exact.

import { describe, expect, test } from 'bun:test';
import {
  availableTextIntervalsOverBand,
  excludedIntervalsOnScanline,
  type WrapExclusionInput,
} from '../drawing-wrap.ts';

const NONE = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** A tight wrap around a 400-point circle of radius 100 centred at (200, 200). */
function circleWrap(): WrapExclusionInput {
  return tightWrap(
    Array.from({ length: 400 }, (_, index) => {
      const angle = (index / 400) * 2 * Math.PI;
      return { x: 200 + 100 * Math.cos(angle), y: 200 + 100 * Math.sin(angle) };
    })
  );
}

function tightWrap(polygon: readonly { x: number; y: number }[]): WrapExclusionInput {
  return Object.freeze({
    mode: 'tight',
    contentBounds: Object.freeze({ x: 100, y: 100, width: 200, height: 200 }),
    polygon: Object.freeze(polygon.map((point) => Object.freeze(point))),
    clipPolygon: null,
    wrapDistances: NONE,
    effectInsets: NONE,
    textSide: 'bothSides',
    contentLeft: 0,
    contentRight: 400,
  });
}

describe('availableTextIntervalsOverBand', () => {
  test('a dense outline keeps the band extents at its sharpest spikes', () => {
    // A left edge at x 100 and a right edge that zigzags every 0.25pt between x 200 and 300.
    // One spike in the band, at y 117, reaches x 320 and another, at y 111, reaches x 330.
    const right = Array.from({ length: 800 }, (_, index) => {
      const y = 100 + index * 0.25;
      const x = y === 117 ? 320 : y === 111 ? 330 : index % 2 ? 300 : 200;
      return { x, y };
    });
    const input = tightWrap([...right, { x: 100, y: 300 }, { x: 100, y: 100 }]);
    const available = availableTextIntervalsOverBand(110, 124, input);
    expect(available).toEqual([
      { start: 0, end: 100 },
      { start: 330, end: 400 },
    ]);
  });

  test('an empty band probes the scanline at its top', () => {
    const input = circleWrap();
    const excluded = excludedIntervalsOnScanline(150, input);
    expect(availableTextIntervalsOverBand(150, 150, input)).toEqual([
      { start: 0, end: excluded[0]!.start },
      { start: excluded[0]!.end, end: 400 },
    ]);
  });

  test('a repeated band returns the same result without probing again', () => {
    const input = circleWrap();
    expect(availableTextIntervalsOverBand(130, 144, input)).toBe(
      availableTextIntervalsOverBand(130, 144, input)
    );
  });
});

/** A U outline 0..200 wide and 0..100 tall whose notch, 50..150 wide, opens at the top. */
const U_OUTLINE = [
  { x: 0, y: 0 },
  { x: 0, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 0 },
  { x: 150, y: 0 },
  { x: 150, y: 60 },
  { x: 50, y: 60 },
  { x: 50, y: 0 },
];

describe('a scanline through contour vertices', () => {
  test('counts each edge below a top vertex once', () => {
    const through = Object.freeze({ ...tightWrap(U_OUTLINE), mode: 'through' as const });
    expect(excludedIntervalsOnScanline(0, through)).toEqual([
      { start: 0, end: 50 },
      { start: 150, end: 200 },
    ]);
  });

  test('closes the interval at a bottom vertex', () => {
    const v = tightWrap([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 100, y: 100 },
    ]);
    expect(excludedIntervalsOnScanline(100, v).length).toBeLessThanOrEqual(1);
    expect(excludedIntervalsOnScanline(50, v)).toEqual([{ start: 50, end: 150 }]);
  });
});

describe('tight and through wrap inside a concave outline', () => {
  test('tight wrap leaves no passage inside the notch', () => {
    expect(availableTextIntervalsOverBand(20, 34, tightWrap(U_OUTLINE))).toEqual([
      { start: 200, end: 400 },
    ]);
  });

  test('through wrap keeps the passage inside the notch', () => {
    const through = Object.freeze({ ...tightWrap(U_OUTLINE), mode: 'through' as const });
    expect(availableTextIntervalsOverBand(20, 34, through)).toEqual([
      { start: 50, end: 150 },
      { start: 200, end: 400 },
    ]);
  });
});

describe('a band that holds the tip of a spike', () => {
  // A diamond whose right tip, at (300, 120), points into the band from y 110 to 124.
  const diamond = [
    { x: 200, y: 20 },
    { x: 300, y: 120 },
    { x: 200, y: 220 },
    { x: 100, y: 120 },
  ];

  for (const mode of ['tight', 'through'] as const)
    test(`${mode} wrap keeps text clear of the tip`, () => {
      const input = Object.freeze({ ...tightWrap(diamond), mode });
      const available = availableTextIntervalsOverBand(110, 124, input);
      expect(available[available.length - 1]!.start).toBeCloseTo(300, 3);
    });
});

test('a shifted wrap keeps its contour foot with it', () => {
  // The contour meets the box bottom at 300, so a line that starts there still wraps.
  const input = Object.freeze({
    ...tightWrap([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
      { x: 100, y: 300 },
    ]),
    contourFoot: 300,
  });
  expect(availableTextIntervalsOverBand(300.001, 314.001, input)).toEqual([
    { start: 0, end: 100 },
    { start: 300, end: 400 },
  ]);
});
