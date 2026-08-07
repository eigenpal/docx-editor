// Whether there is room to put the comments beside the document, or only over it.
//
// The rule is one number and one comparison, but it belongs in the engine rather than in an
// adapter: both adapters need the same answer, and the width it is compared against is the
// engine's own scroll container — the element whose CSS padding reserves the gutter in the
// first place (`.docx-editor__scroll-container[data-review-pane='open']`).
//
// CONTAINER GEOMETRY, NOT A MEDIA QUERY. This editor is embedded. A 700px column inside a
// 2560px window is a narrow editor, and a `@media (max-width: 900px)` would call it wide and
// dock a 316px rail into 700px of room.

/**
 * The narrowest scroll container that still gets a docked rail.
 *
 * A Letter page is 816 CSS pixels at 100% and the open rail reserves 316, so anything under
 * this cannot show both without shrinking the document past comfortable reading. Above it,
 * the fit gives up a little scale and both fit.
 */
export const REVIEW_RAIL_DOCK_MIN_PX = 900;

/** How the review pane should present itself in a container this wide. */
export type ReviewPaneLayout = 'rail' | 'drawer';

/**
 * Pick the presentation for a measured container.
 *
 * An UNMEASURED container (zero, NaN — a viewport that has not been laid out, a server
 * render) answers `'rail'`. That is the shape a wide window gets, and a first frame that
 * guessed `'drawer'` would flash the document full width and then reserve the gutter.
 */
export function reviewPaneLayoutFor(
  containerWidthPx: number,
  minDockWidthPx = REVIEW_RAIL_DOCK_MIN_PX
): ReviewPaneLayout {
  if (!Number.isFinite(containerWidthPx) || containerWidthPx <= 0) return 'rail';
  return containerWidthPx >= minDockWidthPx ? 'rail' : 'drawer';
}
