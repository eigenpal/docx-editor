// The gutter the review rail reserves beside the page, and no more.
//
// THE RULE, the same one `navigation-geometry.ts` states for the left side: the open
// pane must not move the page further than the viewport forces it to. The page stack
// centres itself in the scroller's padding box, so a right padding P shifts the sheet
// left by P/2 — pleasant on a wide window, where the sheet and its card column read as
// one centred pair, and wrong on a narrow one, where a fixed 316px shoved the sheet
// against the left edge (or, under the default fit, shrank the page toward its floor)
// beside a mostly-empty band standing where the page should be.
//
// So the reservation follows the measurement: the full column while the viewport holds
// the page, the column, and a little clearance around the sheet; the leftover width less
// that clearance while it holds less; and never below the marker strip — the anchors and
// the "comment on this" affordance keep working at every width, with the cards reachable
// by the horizontal scroll the page already needs on a viewport that small.
//
// THE PAGE'S WIDTH IN THAT ARITHMETIC IS ITS ENTITLEMENT, NOT ITS PAINT. Under a fit the
// painted width follows the padded box, so a gutter computed from it chases itself:
// shrinking the gutter widens the box, which widens the page, which asks for a smaller
// gutter again. The width the page is ENTITLED to — the authored width at the fit's own
// cap, or at the fixed zoom in force — is independent of the padding, so the pair settles
// in one pass: the gutter yields first, and only when it has given everything down to the
// marker strip does the fit start shrinking the page toward its floor. A fit with NO cap
// has no entitlement to measure against — it fills whatever box it is given — so the full
// column stands and the page absorbs it, exactly as it always has.
//
// ONE value, three consumers. The scroll container pads by it, the horizontal ruler
// mirrors it to stay over the page, and the vertical ruler subtracts it to decide
// "cramped". Two components deciding independently is how a ruler ends up an inch off
// the page it is measuring, so they all read `useReviewGutter`.

import { useContext, useEffect, useRef, useState } from 'react';
import type { EditorSnapshot, PageSetup } from '@docx-editor.dev/core/contracts/editor';
import { ZOOM_MAX } from '@docx-editor.dev/core/editor';
import { twipsToPixels } from '../lib/units';
import { ReviewRailContext } from './context';
import { useEditorState } from './useEditorState';
import { useNavigationViewportElement } from './navigation/navigation-layout';

/** Full reservation: the 300px card column plus its 16px gutter off the page edge. */
export const REVIEW_PANE_GUTTER = 316;

/** The closed pane's strip: markers and the add-comment button, no cards. */
export const REVIEW_MARKERS_GUTTER = 44;

/**
 * Breathing room the page keeps on EACH side before the column may take the rest.
 *
 * Without it the sliding regime below hands the column every leftover pixel, and just
 * above the full-column threshold the sheet sits flush against the viewport's left edge —
 * technically the centred pair, visually a page shoved into the corner. 24px is the
 * vertical breathing the viewport already gives the page (`padding: 24px 0`) and the
 * `--doc-page-gap` between sheets, so the horizontal minimum matches what the layout
 * already calls "clear of the edge".
 */
export const REVIEW_GUTTER_PAGE_CLEARANCE = 24;

export interface ReviewGutterInput {
  /** Whether the pane is showing its cards (`snapshot.reviewPaneOpen`). */
  readonly open: boolean;
  /** Client width of the scroll container. */
  readonly viewportWidth: number;
  /** The width the page is entitled to paint at — authored width times the entitled zoom. */
  readonly pageWidthPx: number;
  /**
   * An uncapped fit is in force: the page fills whatever box it is given, so there is no
   * entitlement to measure the leftover against. The full column stands.
   */
  readonly docked?: boolean;
}

/**
 * The right padding, in px, the scroll container reserves for the review rail while the
 * pane is open.
 *
 * Returns the FULL column for a degenerate measurement (a viewport that has not been
 * laid out yet, a document with no page setup) rather than guessing: that is the value
 * the stylesheet fell back to before this measurement existed, so an unmeasured first
 * frame paints exactly as it always did and narrows only once there is a real width to
 * narrow to.
 */
export function reviewGutterWidth({
  open,
  viewportWidth,
  pageWidthPx,
  docked = false,
}: ReviewGutterInput): number {
  if (!open) return REVIEW_MARKERS_GUTTER;
  if (docked) return REVIEW_PANE_GUTTER;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return REVIEW_PANE_GUTTER;
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return REVIEW_PANE_GUTTER;
  const leftover = viewportWidth - pageWidthPx - 2 * REVIEW_GUTTER_PAGE_CLEARANCE;
  return Math.round(Math.min(REVIEW_PANE_GUTTER, Math.max(REVIEW_MARKERS_GUTTER, leftover)));
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
 * The gutter the review rail reserves right now, in px: `0` with no rail mounted, the
 * marker strip while the pane is closed, and the measured `reviewGutterWidth` while it
 * is open. The one source for the scroll container's padding and both rulers.
 */
export function useReviewGutter(): number {
  // The SNAPSHOT, not the review hook — this needs a boolean and the page's width, not
  // the queue. And no gutter at all unless a rail is mounted to occupy it.
  const rail = useContext(ReviewRailContext);
  const { pageSetup, reviewPaneOpen, entitledZoom } = useEditorState(
    selectGutterGeometry,
    sameGutterGeometry
  );
  const viewportWidth = useViewportClientWidth();
  // The snapshot reports `pageSetup` as null on some ticks even with a document loaded,
  // and a gutter derived from one of those would snap to the full column and back inside
  // one frame. The last width a document actually had is the honest answer for a tick
  // that reports none — same rule as the navigation pane's shift.
  const lastPageWidthTwips = useRef<number | null>(null);
  if (pageSetup) lastPageWidthTwips.current = pageSetup.pageWidthTwips;
  const pageWidthTwips = pageSetup?.pageWidthTwips ?? lastPageWidthTwips.current;

  if ((rail?.mounted ?? 0) === 0) return 0;
  return reviewGutterWidth({
    open: reviewPaneOpen,
    viewportWidth: viewportWidth ?? 0,
    pageWidthPx:
      pageWidthTwips === null || entitledZoom === null
        ? 0
        : twipsToPixels(pageWidthTwips) * entitledZoom,
    docked: entitledZoom === null,
  });
}
