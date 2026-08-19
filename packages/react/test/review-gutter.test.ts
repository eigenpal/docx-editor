// The review gutter — the paddings the scroll container reserves for the rail.
//
// The load-bearing claim: the reservation is BINARY and, when the full column cannot be
// afforded, SYMMETRIC. On a wide host the 316px column stands and the sheet and its cards
// read as one centred pair; on a narrow one the marker strip is mirrored onto both edges,
// so the sheet sits dead-centre while the anchors and the add-comment affordance keep
// their room. There is no width at which a partial, one-sided column looks right — it is
// too narrow for a card and still wide enough to park the page off-centre — so no width
// gets one. `reviewGutter` is that rule as a pure function.

import { describe, expect, test } from 'bun:test';
import {
  REVIEW_GUTTER_PAGE_CLEARANCE,
  REVIEW_MARKERS_GUTTER,
  REVIEW_PANE_GUTTER,
  reviewGutter,
} from '../src/editor/review-gutter.ts';

// Letter at 100%: 8.5in x 96dpi.
const PAGE = 816;
const CLEARANCE = 2 * REVIEW_GUTTER_PAGE_CLEARANCE;
const FULL = { inlineStart: 0, inlineEnd: REVIEW_PANE_GUTTER };
const STRIP = { inlineStart: REVIEW_MARKERS_GUTTER, inlineEnd: REVIEW_MARKERS_GUTTER };

describe('reviewGutter', () => {
  test('a closed pane reserves the mirrored strip, at any width', () => {
    // Symmetric on purpose: the one-sided 44px strip used to nudge the sheet 22px off
    // centre for as long as the pane stayed closed.
    expect(reviewGutter({ open: false, viewportWidth: 1728, pageWidthPx: PAGE })).toEqual(STRIP);
    expect(reviewGutter({ open: false, viewportWidth: 500, pageWidthPx: PAGE })).toEqual(STRIP);
  });

  test('the full column stands while the viewport holds page, column, and clearance', () => {
    // 1728px viewport, 816px page: 912px to spare against the 364 the column and the
    // sheet's clearance need. This is the wide case the reservation was designed for.
    expect(reviewGutter({ open: true, viewportWidth: 1728, pageWidthPx: PAGE })).toEqual(FULL);
    // Break-even: exactly page + column + clearance. Still the full column, and the
    // sheet's left gap is exactly the clearance.
    expect(
      reviewGutter({
        open: true,
        viewportWidth: PAGE + REVIEW_PANE_GUTTER + CLEARANCE,
        pageWidthPx: PAGE,
      })
    ).toEqual(FULL);
  });

  test('below the threshold the strip mirrors onto both edges and the sheet centres', () => {
    // One pixel under break-even. A partial column here would be too narrow for a card
    // and would still park the sheet off-centre beside a mostly-empty band — the bug
    // this measurement exists to fix. The mirrored strip keeps the sheet dead-centre.
    const gutter = reviewGutter({
      open: true,
      viewportWidth: PAGE + REVIEW_PANE_GUTTER + CLEARANCE - 1,
      pageWidthPx: PAGE,
    });
    expect(gutter).toEqual(STRIP);
    expect(gutter.inlineStart).toBe(gutter.inlineEnd);
  });

  test('the strip holds even when the page itself overflows', () => {
    // A phone-width host: the page already scrolls horizontally, and the strip keeps the
    // markers and the add-comment button placeable without reserving a dead column.
    expect(reviewGutter({ open: true, viewportWidth: 390, pageWidthPx: PAGE })).toEqual(STRIP);
  });

  test('an uncapped fit keeps the full column', () => {
    // An uncapped fit fills whatever box it is given, so there is no page entitlement to
    // measure the leftover against. The full column stands and the page absorbs it,
    // exactly as it always has.
    expect(reviewGutter({ open: true, viewportWidth: 900, pageWidthPx: 0, docked: true })).toEqual(
      FULL
    );
  });

  test('a capped fit yields the column before the fit shrinks the page', () => {
    // The default `'auto'` fit caps at 100%, so the page's entitlement is its authored
    // width. On a 1150px viewport the old fixed column left the fit a 786px box and the
    // page painted at 96% beside a mostly-empty band; with the strip mirrored, the fit's
    // box holds the page at 100% and the sheet centres.
    const gutter = reviewGutter({ open: true, viewportWidth: 1150, pageWidthPx: PAGE });
    expect(gutter).toEqual(STRIP);
    expect(1150 - gutter.inlineStart - gutter.inlineEnd).toBeGreaterThanOrEqual(PAGE + CLEARANCE);
  });

  test('answers the stylesheet fallback for a measurement it does not have yet', () => {
    // A viewport that has not been laid out, or a document with no page setup. The full
    // column is what the stylesheet painted before this measurement existed, so an
    // unmeasured first frame looks exactly as it always did instead of jumping.
    expect(reviewGutter({ open: true, viewportWidth: 0, pageWidthPx: PAGE })).toEqual(FULL);
    expect(reviewGutter({ open: true, viewportWidth: 1200, pageWidthPx: 0 })).toEqual(FULL);
    expect(reviewGutter({ open: true, viewportWidth: Number.NaN, pageWidthPx: PAGE })).toEqual(
      FULL
    );
  });

  test('the sheet is never parked off-centre by a partial column, at any width', () => {
    for (let viewportWidth = 500; viewportWidth <= 2400; viewportWidth += 17) {
      const gutter = reviewGutter({ open: true, viewportWidth, pageWidthPx: PAGE });
      if (gutter.inlineEnd === REVIEW_PANE_GUTTER) {
        // Full column: the padded box still holds the page with its clearance intact.
        expect(gutter.inlineStart).toBe(0);
        expect(viewportWidth - gutter.inlineEnd).toBeGreaterThanOrEqual(PAGE + CLEARANCE);
      } else {
        // Otherwise the reservation is exactly the mirrored strip — symmetric, so the
        // auto margins centre the sheet in what remains.
        expect(gutter).toEqual(STRIP);
      }
    }
  });
});
