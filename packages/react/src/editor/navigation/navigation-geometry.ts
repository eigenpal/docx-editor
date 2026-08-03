// How much the navigation pane is allowed to move the document, and no more.
//
// THE RULE: an open pane must not move the page while there is room for it in the left
// gutter. A fixed "push the page over by the panel's width" is what makes a wide window
// feel like the editor jumped sideways for no reason — on a 1600px window with a Letter
// page there is already 500px of empty gutter, and the pane fits in it untouched.
//
// The page stack centres itself in the viewport (`.ep-one-surface__pages` is
// `width: max-content` + `margin-inline: auto`), so a left padding P on the viewport does
// NOT move the page by P: it shrinks the centring box, and the page moves by P/2 — until
// the box gets narrower than the page, at which point the auto margins collapse to zero
// and the page sits at exactly P with the overflow scrolling. Both regimes are solved
// here, so the page lands exactly where the pane needs it and never further.

/** Panel width, in px, when the host does not choose one. */
export const NAVIGATION_PANE_WIDTH = 280;

/**
 * Gap between the viewport's left edge and the panel.
 *
 * Clears a vertical ruler: `RULER_WIDTH` is 20px pinned at the viewport's left edge, so
 * anything less puts the panel and its collapsed disc on top of the tick marks.
 */
export const NAVIGATION_PANE_INSET = 32;

/** Clearance kept between the panel's right edge and the page. */
export const NAVIGATION_PANE_GAP = 16;

/** Total left space an open pane needs before the page may start. */
export function navigationPaneReservation(paneWidth = NAVIGATION_PANE_WIDTH): number {
  return NAVIGATION_PANE_INSET + paneWidth + NAVIGATION_PANE_GAP;
}

export interface NavigationShiftInput {
  /** Client width of the scroll container. */
  readonly viewportWidth: number;
  /** Rendered width of one page, zoom applied. */
  readonly pageWidthPx: number;
  /** Space the open pane needs, from {@link navigationPaneReservation}. */
  readonly reservation: number;
}

/**
 * The viewport's left padding, in px, that puts the page's left edge exactly at
 * `reservation` — and `0` whenever the gutter is already wide enough.
 *
 * Returns 0 for a degenerate measurement (a viewport that has not been laid out yet, a
 * document with no page setup) rather than guessing: shifting on a zero measurement would
 * make the pane jump on the first frame and settle on the second.
 */
export function navigationShift({
  viewportWidth,
  pageWidthPx,
  reservation,
}: NavigationShiftInput): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0;
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return 0;
  if (!Number.isFinite(reservation) || reservation <= 0) return 0;

  const gutter = (viewportWidth - pageWidthPx) / 2;
  // Already room to the left of the page: the pane overlays empty space, the page holds
  // still. This is the common case on any reasonably wide window, and it is the whole
  // point of computing a shift instead of hard-coding one.
  if (gutter >= reservation) return 0;

  // Still centred: padding P moves the page by P/2, so twice the deficit lands it exactly
  // on the reservation. Valid while the padded box is still at least a page wide, which
  // is the same condition as `reservation <= 2 * gutter`.
  if (reservation <= 2 * gutter) return Math.ceil(2 * (reservation - gutter));

  // The padded box is narrower than the page: `margin-inline: auto` resolves to zero, the
  // page pins to the padding edge, and the padding IS the offset. Horizontal scrolling
  // appears here, which is correct — there is genuinely not enough room for both.
  return Math.ceil(reservation);
}
