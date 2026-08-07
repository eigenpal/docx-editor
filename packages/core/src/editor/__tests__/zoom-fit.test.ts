// The fit arithmetic, on its own.
//
// Every rule here has a failure mode behind it that is invisible in a screenshot: a fit that
// rounds up paints a page wider than the box it was fitted to; a fit that guesses on an
// unmeasured viewport makes every mount flinch; a fit that does not quantize re-lays out the
// whole document because a scrollbar moved a fractional pixel.

import { describe, expect, test } from 'bun:test';
import {
  AUTO_ZOOM_MODE,
  FIT_GUTTER_PX,
  FIXED_ZOOM_MODE,
  ZOOM_MAX,
  ZOOM_MIN,
  fitZoom,
  isFitMode,
  resolveZoomMode,
} from '../zoom-fit.ts';

/** A US Letter page in content pixels at 96dpi: 8.5in wide. */
const LETTER_PX = 816;

describe('fitZoom', () => {
  test('fills the room it has, less a gutter on each side', () => {
    const zoom = fitZoom({
      availableWidthPx: LETTER_PX + 2 * FIT_GUTTER_PX,
      pageWidthPx: LETTER_PX,
    });
    expect(zoom).toBe(1);
  });

  test('shrinks a page that does not fit', () => {
    // 700px viewport, 24px gutters: 652 usable / 816 = 0.799…
    expect(fitZoom({ availableWidthPx: 700, pageWidthPx: LETTER_PX })).toBe(0.79);
  });

  test('grows a page with room to spare when nothing caps it', () => {
    expect(fitZoom({ availableWidthPx: 1600, pageWidthPx: LETTER_PX })).toBe(1.9);
  });

  // The whole point of `auto`: a wide window renders exactly as it does today.
  test('maxZoom 1 leaves a wide window at 100% and still shrinks a narrow one', () => {
    expect(fitZoom({ availableWidthPx: 1600, pageWidthPx: LETTER_PX, maxZoom: 1 })).toBe(1);
    expect(fitZoom({ availableWidthPx: 700, pageWidthPx: LETTER_PX, maxZoom: 1 })).toBe(0.79);
  });

  // Rounding UP would paint a page wider than the box it was fitted to, which is the one
  // outcome fitting exists to prevent.
  test('quantizes DOWN to whole percent', () => {
    const zoom = fitZoom({ availableWidthPx: 860, pageWidthPx: LETTER_PX, gutterPx: 0 })!;
    expect(zoom).toBe(1.05);
    expect(zoom * LETTER_PX).toBeLessThanOrEqual(860);
  });

  test('a sub-percent change in the viewport does not move the answer', () => {
    // Both land inside the 82% band: 672/816 = 0.8235, 674/816 = 0.8259.
    const a = fitZoom({ availableWidthPx: 720, pageWidthPx: LETTER_PX });
    const b = fitZoom({ availableWidthPx: 722, pageWidthPx: LETTER_PX });
    expect(a).toBe(0.82);
    expect(b).toBe(a);
  });

  test('clamps to the contract range rather than refusing — it has no caller to tell', () => {
    expect(fitZoom({ availableWidthPx: 40, pageWidthPx: LETTER_PX })).toBe(ZOOM_MIN);
    expect(fitZoom({ availableWidthPx: 100_000, pageWidthPx: LETTER_PX })).toBe(ZOOM_MAX);
  });

  test('honours a mode that asks for a floor', () => {
    expect(fitZoom({ availableWidthPx: 300, pageWidthPx: LETTER_PX, minZoom: 0.5 })).toBe(0.5);
  });

  test('contradictory bounds resolve to the floor, not to an unreadable page', () => {
    expect(
      fitZoom({ availableWidthPx: 300, pageWidthPx: LETTER_PX, minZoom: 0.8, maxZoom: 0.5 })
    ).toBe(0.8);
  });

  // A viewport this narrow is a phone in a split view. Subtracting the gutters outright would
  // leave nothing to fit into.
  test('gives up the gutters before it gives up the page', () => {
    expect(fitZoom({ availableWidthPx: 30, pageWidthPx: LETTER_PX, gutterPx: 40 })).not.toBeNull();
  });

  // NULL, not 1. Guessing here paints 100% on the first frame and the fitted scale on the
  // second, which is a visible jump on every mount.
  test('answers null when there is nothing to measure', () => {
    expect(fitZoom({ availableWidthPx: 0, pageWidthPx: LETTER_PX })).toBeNull();
    expect(fitZoom({ availableWidthPx: 800, pageWidthPx: 0 })).toBeNull();
    expect(fitZoom({ availableWidthPx: Number.NaN, pageWidthPx: LETTER_PX })).toBeNull();
    expect(fitZoom({ availableWidthPx: 800, pageWidthPx: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe('resolveZoomMode', () => {
  test("'auto' is the capped page-width fit", () => {
    expect(resolveZoomMode('auto')).toBe(AUTO_ZOOM_MODE);
    expect(AUTO_ZOOM_MODE).toEqual({ type: 'fit', fit: 'pageWidth', maxZoom: 1 });
  });

  test('a fixed mode normalizes to the shared constant, so snapshots stay reference-equal', () => {
    expect(resolveZoomMode({ type: 'fixed' })).toBe(FIXED_ZOOM_MODE);
  });

  test('a custom fit is passed through with its bounds intact', () => {
    const mode = { type: 'fit', fit: 'pageWidth', minZoom: 0.4 } as const;
    expect(resolveZoomMode(mode)).toBe(mode);
  });

  test('refuses what it does not know instead of substituting a default', () => {
    expect(resolveZoomMode('page-width' as never)).toBeNull();
    expect(resolveZoomMode({ type: 'fit', fit: 'fullPage' } as never)).toBeNull();
    expect(resolveZoomMode(null as never)).toBeNull();
  });
});

describe('isFitMode', () => {
  test('separates the two', () => {
    expect(isFitMode(AUTO_ZOOM_MODE)).toBe(true);
    expect(isFitMode(FIXED_ZOOM_MODE)).toBe(false);
  });
});
