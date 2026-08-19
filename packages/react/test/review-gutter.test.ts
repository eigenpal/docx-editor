// The review gutter — the right padding the scroll container reserves for the rail.
//
// The load-bearing claim mirrors the navigation pane's: the open pane must not move the
// document further than the viewport forces it to. On a wide host the full 316px column
// stands and the sheet and its cards read as one centred pair; on a narrow one the
// reservation narrows to what is left after the sheet keeps a little clearance, and it
// never drops below the marker strip — the anchors and the add-comment affordance keep
// working at every width. `reviewGutterWidth` is that rule as a pure function.

import { describe, expect, test } from 'bun:test';
import {
  REVIEW_GUTTER_PAGE_CLEARANCE,
  REVIEW_MARKERS_GUTTER,
  REVIEW_PANE_GUTTER,
  reviewGutterWidth,
} from '../src/editor/review-gutter.ts';

// Letter at 100%: 8.5in x 96dpi.
const PAGE = 816;
const CLEARANCE = 2 * REVIEW_GUTTER_PAGE_CLEARANCE;

describe('reviewGutterWidth', () => {
  test('a closed pane reserves the marker strip, at any width', () => {
    expect(reviewGutterWidth({ open: false, viewportWidth: 1728, pageWidthPx: PAGE })).toBe(
      REVIEW_MARKERS_GUTTER
    );
    expect(reviewGutterWidth({ open: false, viewportWidth: 500, pageWidthPx: PAGE })).toBe(
      REVIEW_MARKERS_GUTTER
    );
  });

  test('the full column stands while the viewport holds page, column, and clearance', () => {
    // 1728px viewport, 816px page: 912px to spare, the column needs 316 plus the sheet's
    // clearance. This is the wide case the reservation was designed for — nothing changes.
    expect(reviewGutterWidth({ open: true, viewportWidth: 1728, pageWidthPx: PAGE })).toBe(
      REVIEW_PANE_GUTTER
    );
    // Break-even: exactly page + column + clearance. Still the full column.
    expect(
      reviewGutterWidth({
        open: true,
        viewportWidth: PAGE + REVIEW_PANE_GUTTER + CLEARANCE,
        pageWidthPx: PAGE,
      })
    ).toBe(REVIEW_PANE_GUTTER);
  });

  test('narrows to the leftover width when the viewport holds less', () => {
    // 1147px viewport, 816px page: 331px left over — just under the 364 the full column
    // and the clearance need together. Reserving 316 anyway left the sheet 7px off the
    // viewport's left edge with a mostly-empty band standing where the page should be —
    // the bug this measurement exists to fix. The column takes what remains after the
    // sheet keeps its clearance.
    expect(reviewGutterWidth({ open: true, viewportWidth: 1147, pageWidthPx: PAGE })).toBe(
      1147 - PAGE - CLEARANCE
    );
    expect(reviewGutterWidth({ open: true, viewportWidth: 1000, pageWidthPx: PAGE })).toBe(
      1000 - PAGE - CLEARANCE
    );
  });

  test('never drops below the marker strip, even when the page itself overflows', () => {
    // A phone-width host: the page already scrolls horizontally, and the strip keeps the
    // markers and the add-comment button reachable without reserving a dead column.
    expect(reviewGutterWidth({ open: true, viewportWidth: 390, pageWidthPx: PAGE })).toBe(
      REVIEW_MARKERS_GUTTER
    );
  });

  test('an uncapped fit keeps the full column', () => {
    // An uncapped fit fills whatever box it is given, so there is no page entitlement to
    // measure the leftover against. The full column stands and the page absorbs it,
    // exactly as it always has.
    expect(
      reviewGutterWidth({ open: true, viewportWidth: 900, pageWidthPx: 0, docked: true })
    ).toBe(REVIEW_PANE_GUTTER);
  });

  test('a capped fit yields the column before the fit shrinks the page', () => {
    // The default `'auto'` fit caps at 100%, so the page's entitlement is its authored
    // width. On a 1150px viewport the old fixed column left the fit a 786px box and the
    // page painted at 96% beside a mostly-empty band; measured, the column narrows to
    // 286px and the fit's box holds the page at 100% with its clearance intact.
    const gutter = reviewGutterWidth({ open: true, viewportWidth: 1150, pageWidthPx: PAGE });
    expect(gutter).toBe(1150 - PAGE - CLEARANCE);
    expect(1150 - gutter - CLEARANCE).toBeGreaterThanOrEqual(PAGE);
  });

  test('answers the stylesheet fallback for a measurement it does not have yet', () => {
    // A viewport that has not been laid out, or a document with no page setup. The full
    // column is what the stylesheet painted before this measurement existed, so an
    // unmeasured first frame looks exactly as it always did instead of jumping.
    expect(reviewGutterWidth({ open: true, viewportWidth: 0, pageWidthPx: PAGE })).toBe(
      REVIEW_PANE_GUTTER
    );
    expect(reviewGutterWidth({ open: true, viewportWidth: 1200, pageWidthPx: 0 })).toBe(
      REVIEW_PANE_GUTTER
    );
    expect(reviewGutterWidth({ open: true, viewportWidth: Number.NaN, pageWidthPx: PAGE })).toBe(
      REVIEW_PANE_GUTTER
    );
  });

  test('the sheet keeps its footing at every width', () => {
    for (let viewportWidth = 500; viewportWidth <= 2400; viewportWidth += 17) {
      const gutter = reviewGutterWidth({ open: true, viewportWidth, pageWidthPx: PAGE });
      // Bounded by the strip and the column...
      expect(gutter).toBeGreaterThanOrEqual(REVIEW_MARKERS_GUTTER);
      expect(gutter).toBeLessThanOrEqual(REVIEW_PANE_GUTTER);
      // ...and whenever the viewport holds the page, the strip, and the clearance, the
      // padded box still holds the page with its clearance intact — the sheet never sits
      // against the edge to feed the column.
      if (viewportWidth - PAGE - CLEARANCE >= REVIEW_MARKERS_GUTTER) {
        expect(viewportWidth - gutter).toBeGreaterThanOrEqual(PAGE + CLEARANCE);
      }
    }
  });
});
