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
