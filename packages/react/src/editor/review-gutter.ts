// The gutter the review rail reserves beside the page, and no more.
//
// THE RULE: the reservation is BINARY and, when the column cannot be afforded, SYMMETRIC.
// The page stack centres itself in the scroller's padding box, so padding one edge by P
// shifts the sheet left by P/2 — pleasant on a wide window, where the sheet and its card
// column read as one centred pair, and wrong on a narrow one, where any one-sided
// reservation (the fixed 316px, or a proportional slice of the leftover) parks the sheet
// visibly off-centre beside a mostly-empty band. There is no width at which a partial
// column looks right: it is too narrow for a card and still wide enough to unbalance the
// page. So the column is either fully affordable or it is not:
//
//   - Affordable (the viewport holds the page at its entitled width, the full column,
//     and a little clearance): the column stands and the pair centres, as it always has.
//   - Not affordable: the SAME marker strip is reserved on BOTH edges, so the sheet sits
//     dead-centre and the strip still guarantees room for the markers and the
//     add-comment affordance beside the page. Cards then overlay the right gap and the
//     ordinary horizontal scroll reaches whatever sticks out.
//
// THE PAGE'S WIDTH IN THAT ARITHMETIC IS ITS ENTITLEMENT, NOT ITS PAINT. Under a fit the
// painted width follows the padded box, so a threshold computed from it chases itself:
// collapsing the column widens the box, which widens the page, which asks the column
// back. The width the page is ENTITLED to — the authored width at the fit's own cap, or
// at the fixed zoom in force — is independent of the padding, so the mode settles in one
// pass. A fit with NO cap has no entitlement to measure against — it fills whatever box
// it is given — so the full column stands and the page absorbs it, exactly as it always
// has.
//
// ONE value, three consumers. The scroll container pads by it, the horizontal ruler
// mirrors it to stay over the page, and the vertical ruler subtracts it to decide
// "cramped". Two components deciding independently is how a ruler ends up an inch off
// the page it is measuring, so they all read `useReviewGutter`.

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { EditorSnapshot, PageSetup } from '@docx-editor.dev/core/contracts/editor';
import { ZOOM_MAX } from '@docx-editor.dev/core/editor';
import { twipsToPixels } from '../lib/units';
import { ReviewRailContext } from './context';
import { useEditorState } from './useEditorState';
import {
  useNavigationReservation,
  useNavigationViewportElement,
} from './navigation/navigation-layout';

/** Full reservation: the 300px card column plus its 16px gutter off the page edge. */
export const REVIEW_PANE_GUTTER = 316;

/** The marker strip: anchors and the add-comment button, no cards. */
export const REVIEW_MARKERS_GUTTER = 44;

/**
 * Breathing room the page keeps on EACH side for the full column to count as affordable.
 *
 * Without it the column flips in at the exact break-even width and the sheet lands flush
 * against the viewport's left edge — technically the centred pair, visually a page shoved
 * into the corner. 24px is the vertical breathing the viewport already gives the page
 * (`padding: 24px 0`) and the `--doc-page-gap` between sheets, so the horizontal minimum
 * matches what the layout already calls "clear of the edge".
 */
export const REVIEW_GUTTER_PAGE_CLEARANCE = 24;

/** What the scroll container reserves on each edge, in px. */
export interface ReviewGutter {
  readonly inlineStart: number;
  readonly inlineEnd: number;
}

/** The affordable pair: nothing at the start, the full column at the end. */
const FULL_COLUMN: ReviewGutter = { inlineStart: 0, inlineEnd: REVIEW_PANE_GUTTER };

/** The symmetric pair: the marker strip mirrored, so the sheet centres exactly. */
const BALANCED_STRIP: ReviewGutter = {
  inlineStart: REVIEW_MARKERS_GUTTER,
  inlineEnd: REVIEW_MARKERS_GUTTER,
};

/** No rail mounted: nothing reserved anywhere. */
const NO_GUTTER: ReviewGutter = { inlineStart: 0, inlineEnd: 0 };

export interface ReviewGutterInput {
  /** Whether the pane is showing its cards (`snapshot.reviewPaneOpen`). */
  readonly open: boolean;
  /** Client width of the scroll container. */
  readonly viewportWidth: number;
  /** The width the page is entitled to paint at — authored width times the entitled zoom. */
  readonly pageWidthPx: number;
  /**
   * Start-edge room OTHER chrome is asking for — an open navigation pane's reservation.
   * Without it the column judged only page-against-viewport, stood in the two-pane case,
   * and the pane's displacement then squeezed the fit below the page's entitlement — the
   * very symptom the measurement exists to remove. The STATIC ask (open pane × width),
   * never the pane's computed shift: the shift depends on this gutter, and reading it
   * back would close a cycle the two reservations then chase around.
   */
  readonly inlineStartReservation?: number;
  /**
   * An uncapped fit is in force: the page fills whatever box it is given, so there is no
   * entitlement to measure the leftover against. The full column stands.
   */
  readonly docked?: boolean;
}

/**
 * The paddings, in px, the scroll container reserves for the review rail.
 *
 * Returns the FULL column for a degenerate measurement (a viewport that has not been
 * laid out yet, a document with no page setup) rather than guessing: that is the value
 * the stylesheet fell back to before this measurement existed, so an unmeasured first
 * frame paints exactly as it always did and collapses only once there is a real width
 * to decide by.
 */
export function reviewGutter({
  open,
  viewportWidth,
  pageWidthPx,
  inlineStartReservation = 0,
  docked = false,
}: ReviewGutterInput): ReviewGutter {
  if (!open) return BALANCED_STRIP;
  if (docked) return FULL_COLUMN;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return FULL_COLUMN;
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return FULL_COLUMN;
  const start =
    Number.isFinite(inlineStartReservation) && inlineStartReservation > 0
      ? inlineStartReservation
      : 0;
  const leftover = viewportWidth - start - pageWidthPx - 2 * REVIEW_GUTTER_PAGE_CLEARANCE;
  return leftover >= REVIEW_PANE_GUTTER ? FULL_COLUMN : BALANCED_STRIP;
}

interface GutterGeometry {
  readonly pageSetup: PageSetup | null;
  readonly reviewPaneOpen: boolean;
  /**
   * The zoom the page is entitled to, whatever it paints at right now: a fit's own cap
   * (`'auto'` caps at 1), or the fixed scale in force. Reading the LIVE zoom instead
   * re-creates the feedback loop the module comment describes — under a fit the live
   * zoom already includes whatever this gutter reserved last frame. `null` marks an
   * uncapped fit, which has no entitlement to measure against.
   */
  readonly entitledZoom: number | null;
}

const selectGutterGeometry = (snapshot: EditorSnapshot): GutterGeometry => {
  const mode = snapshot.zoomMode;
  return {
    pageSetup: snapshot.pageSetup ?? null,
    reviewPaneOpen: snapshot.reviewPaneOpen ?? true,
    entitledZoom:
      mode?.type === 'fit'
        ? mode.maxZoom !== undefined && mode.maxZoom < ZOOM_MAX
          ? mode.maxZoom
          : null
        : snapshot.zoom,
  };
};

const sameGutterGeometry = (a: GutterGeometry, b: GutterGeometry) =>
  a.reviewPaneOpen === b.reviewPaneOpen &&
  a.entitledZoom === b.entitledZoom &&
  a.pageSetup?.pageWidthTwips === b.pageSetup?.pageWidthTwips;

/**
 * The scroll container's client width, kept live by a ResizeObserver.
 *
 * `null` while no viewport is registered — a bare composition without
 * `DocxEditor.Viewport` gets no measurement and must not act on one.
 */
export function useViewportClientWidth(): number | null {
  const viewport = useNavigationViewportElement();
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    if (!viewport) {
      setWidth(null);
      return undefined;
    }
    const sync = () => setWidth(viewport.clientWidth);
    sync();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport]);

  return width;
}

/**
 * The gutter the review rail reserves right now: nothing with no rail mounted, and the
 * measured `reviewGutter` pair otherwise. The one source for the scroll container's
 * paddings and both rulers.
 *
 * The result is reference-stable — the pure function answers with one of three shared
 * constants — and the hook stores THAT, never the raw width: a resize sweeps through
 * hundreds of widths that all resolve to the same constant, and holding the width as
 * state re-rendered every consumer (the review rail among them) once per pixel. Storing
 * the derived constant lets the state setter bail on identity, so consumers re-render
 * only when the reservation actually flips.
 */
export function useReviewGutter(): ReviewGutter {
  // The SNAPSHOT, not the review hook — this needs a boolean and the page's width, not
  // the queue. And no gutter at all unless a rail is mounted to occupy it.
  const rail = useContext(ReviewRailContext);
  const { pageSetup, reviewPaneOpen, entitledZoom } = useEditorState(
    selectGutterGeometry,
    sameGutterGeometry
  );
  const viewport = useNavigationViewportElement();
  // An open navigation pane's STATIC ask, from the shared layout store — see the input's
  // own doc for why it is never the pane's computed shift.
  const navigationReservation = useNavigationReservation();
  // The snapshot reports `pageSetup` as null on some ticks even with a document loaded,
  // and a gutter derived from one of those would snap to the full column and back inside
  // one frame. The last width a document actually had is the honest answer for a tick
  // that reports none — same rule as the navigation pane's shift.
  const lastPageWidthTwips = useRef<number | null>(null);
  if (pageSetup) lastPageWidthTwips.current = pageSetup.pageWidthTwips;
  const pageWidthTwips = pageSetup?.pageWidthTwips ?? lastPageWidthTwips.current;

  const mounted = (rail?.mounted ?? 0) > 0;
  const compute = useCallback(
    (width: number | null): ReviewGutter => {
      if (!mounted) return NO_GUTTER;
      return reviewGutter({
        open: reviewPaneOpen,
        viewportWidth: width ?? 0,
        pageWidthPx:
          pageWidthTwips === null || entitledZoom === null
            ? 0
            : twipsToPixels(pageWidthTwips) * entitledZoom,
        inlineStartReservation: navigationReservation,
        docked: entitledZoom === null,
      });
    },
    [mounted, reviewPaneOpen, pageWidthTwips, entitledZoom, navigationReservation]
  );

  const [gutter, setGutter] = useState<ReviewGutter>(() =>
    compute(viewport ? viewport.clientWidth : null)
  );
  useEffect(() => {
    const sync = () => setGutter(compute(viewport ? viewport.clientWidth : null));
    sync();
    if (!viewport || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport, compute]);
  return gutter;
}
