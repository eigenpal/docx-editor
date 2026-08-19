import { describe, expect, test } from 'bun:test';
import {
  REVIEW_GUTTER_PAGE_CLEARANCE,
  REVIEW_MARKERS_GUTTER,
  REVIEW_PANE_GUTTER,
  reviewGutter,
} from '../src/editor/review-gutter';
import { navigationShift } from '../src/editor/navigation/navigation-geometry';

const PAGE = 816;
const CLEARANCE = 2 * REVIEW_GUTTER_PAGE_CLEARANCE;
const FULL = { inlineStart: 0, inlineEnd: REVIEW_PANE_GUTTER };
const STRIP = { inlineStart: REVIEW_MARKERS_GUTTER, inlineEnd: REVIEW_MARKERS_GUTTER };

describe('reviewGutter (Vue)', () => {
  test('a closed pane reserves the mirrored strip', () => {
    expect(reviewGutter({ open: false, viewportWidth: 1728, pageWidthPx: PAGE })).toEqual(STRIP);
    expect(reviewGutter({ open: false, viewportWidth: 500, pageWidthPx: PAGE })).toEqual(STRIP);
  });

  test('the full column stands when the viewport affords it', () => {
    expect(reviewGutter({ open: true, viewportWidth: 1728, pageWidthPx: PAGE })).toEqual(FULL);
    expect(
      reviewGutter({
        open: true,
        viewportWidth: PAGE + REVIEW_PANE_GUTTER + CLEARANCE,
        pageWidthPx: PAGE,
      })
    ).toEqual(FULL);
  });

  test('the strip mirrors below the full-column threshold', () => {
    expect(
      reviewGutter({
        open: true,
        viewportWidth: PAGE + REVIEW_PANE_GUTTER + CLEARANCE - 1,
        pageWidthPx: PAGE,
      })
    ).toEqual(STRIP);
    expect(reviewGutter({ open: true, viewportWidth: 390, pageWidthPx: PAGE })).toEqual(STRIP);
  });

  test('an uncapped fit keeps the full column', () => {
    expect(reviewGutter({ open: true, viewportWidth: 900, pageWidthPx: 0, docked: true })).toEqual(
      FULL
    );
  });

  test('an open navigation pane counts against the column', () => {
    const navigation = 328;
    expect(
      reviewGutter({
        open: true,
        viewportWidth: 1500,
        pageWidthPx: PAGE,
        inlineStartReservation: navigation,
      })
    ).toEqual(STRIP);
    expect(
      reviewGutter({
        open: true,
        viewportWidth: PAGE + REVIEW_PANE_GUTTER + CLEARANCE + navigation,
        pageWidthPx: PAGE,
        inlineStartReservation: navigation,
      })
    ).toEqual(FULL);
  });

  test('unmeasured geometry keeps the stylesheet fallback', () => {
    expect(reviewGutter({ open: true, viewportWidth: 0, pageWidthPx: PAGE })).toEqual(FULL);
    expect(reviewGutter({ open: true, viewportWidth: 1200, pageWidthPx: 0 })).toEqual(FULL);
    expect(reviewGutter({ open: true, viewportWidth: Number.NaN, pageWidthPx: PAGE })).toEqual(
      FULL
    );
  });

  test('no width produces a partial one-sided column', () => {
    for (let viewportWidth = 500; viewportWidth <= 2400; viewportWidth += 17) {
      const gutter = reviewGutter({ open: true, viewportWidth, pageWidthPx: PAGE });
      if (gutter.inlineEnd === REVIEW_PANE_GUTTER) {
        expect(gutter.inlineStart).toBe(0);
        expect(viewportWidth - gutter.inlineEnd).toBeGreaterThanOrEqual(PAGE + CLEARANCE);
      } else {
        expect(gutter).toEqual(STRIP);
      }
    }
  });

  test('the mirrored strip reduces the navigation shift', () => {
    const reservation = 328;
    const strip = REVIEW_MARKERS_GUTTER;
    const shift = navigationShift({
      viewportWidth: 1200,
      pageWidthPx: PAGE,
      reservation,
      inlineStartReservation: strip,
    });
    expect(shift).toBe(272 - strip);
    expect((shift + strip) / 2 + (1200 - PAGE) / 2).toBe(reservation);
    expect(
      navigationShift({
        viewportWidth: 900,
        pageWidthPx: PAGE,
        reservation,
        inlineStartReservation: strip,
        docked: true,
      })
    ).toBe(reservation - strip);
  });
});
