// How wide the page may be drawn so that it fits the room it has.
//
// DOM-FREE ON PURPOSE. Everything here is arithmetic over two numbers a caller measured —
// how much room there is, and how wide one page is at 100%. `zoom-controller.ts` owns the
// measuring and the observing; this module owns the answer, so the rule can be tested
// without a layout, a browser, or a document.
//
// The unit is CSS pixels at 96dpi with zoom NOT applied, which is exactly what
// `Editor.getPageGeometry()` reports. Multiplying that by the number returned here gives
// the width the page will actually paint at.

import type { ZoomMode } from '../contracts/editor.ts';

/** The narrowest and widest scale the editor contract accepts. One definition, both users. */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 5;

/**
 * Room left beside the page, per side, when fitting.
 *
 * The page stack hugs its pages (`.docx-editor-one-surface__pages` is `width: max-content`),
 * so a fit computed against the bare available width paints the sheet flush against both
 * edges of the scroller with its drop shadow clipped. This is the breathing room Word leaves.
 */
export const FIT_GUTTER_PX = 24;

/**
 * Fit the page width, but never magnify: the default.
 *
 * A wide window keeps the 100% it has always had, and only a window too narrow to hold the
 * sheet shrinks. Uncapped fitting would render a Letter page at 183% on a 1600px monitor,
 * which is a reader app, not Word.
 */
export const AUTO_ZOOM_MODE: ZoomMode = { type: 'fit', fit: 'pageWidth', maxZoom: 1 };

/** The 100% that has no fitting behind it. */
export const FIXED_ZOOM_MODE: ZoomMode = { type: 'fixed' };

/**
 * Normalize the `'auto'` shorthand a host may pass anywhere a {@link ZoomMode} is accepted.
 *
 * Returns `null` for a value that is neither, so callers refuse rather than silently
 * substituting a mode the caller did not ask for.
 */
export function resolveZoomMode(mode: ZoomMode | 'auto'): ZoomMode | null {
  if (mode === 'auto') return AUTO_ZOOM_MODE;
  if (!mode || typeof mode !== 'object') return null;
  if (mode.type === 'fixed') return FIXED_ZOOM_MODE;
  if (mode.type === 'fit' && mode.fit === 'pageWidth') return mode;
  return null;
}

/** Whether a mode makes the engine track the viewport rather than hold a number. */
export function isFitMode(mode: ZoomMode): mode is Extract<ZoomMode, { type: 'fit' }> {
  return mode.type === 'fit';
}

/** What {@link fitZoom} needs to know. All lengths in CSS pixels at 96dpi. */
export interface FitZoomInput {
  /** The scroller's CONTENT box width: `clientWidth` less both inline paddings. */
  readonly availableWidthPx: number;
  /** One page's width at 100%, from `Editor.getPageGeometry()`. */
  readonly pageWidthPx: number;
  /** Room to leave per side; defaults to {@link FIT_GUTTER_PX}. */
  readonly gutterPx?: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
}

/**
 * The scale at which the page fits the room it has, or `null` when that cannot be known yet.
 *
 * NULL RATHER THAN A GUESS. A viewport that has not been laid out reports a zero width, and
 * a document that has not paginated reports no page. Substituting 1 there would paint at
 * 100% on the first frame and jump to the fitted scale on the second — a flinch on every
 * mount. The caller keeps the zoom it already had instead.
 *
 * CLAMPED, not refused, unlike `Editor.setZoom`. That method has a caller to tell about a bad
 * argument; this one is derived from a measurement, and the honest response to "the window is
 * 40px wide" is the narrowest scale there is.
 *
 * QUANTIZED DOWN to whole percent. Down because rounding 0.994 up to 1 paints a page wider
 * than the box it was fitted to; whole percent because the toolbar shows this number, and
 * because a sub-percent tremor from a scrollbar or a fractional device pixel would otherwise
 * re-lay out the whole document for a change nobody can see.
 */
export function fitZoom({
  availableWidthPx,
  pageWidthPx,
  gutterPx = FIT_GUTTER_PX,
  minZoom = ZOOM_MIN,
  maxZoom = ZOOM_MAX,
}: FitZoomInput): number | null {
  if (!Number.isFinite(availableWidthPx) || availableWidthPx <= 0) return null;
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return null;

  const gutter = Number.isFinite(gutterPx) && gutterPx > 0 ? gutterPx : 0;
  // A viewport narrower than the gutters themselves is still a viewport: fitting to what is
  // left of it after subtracting them would be a negative width, so the gutters give way
  // first. The floor below then catches whatever is left.
  const usable = Math.max(availableWidthPx - 2 * gutter, availableWidthPx * 0.5);

  const lower = Number.isFinite(minZoom) ? Math.max(minZoom, ZOOM_MIN) : ZOOM_MIN;
  const upper = Number.isFinite(maxZoom) ? Math.min(maxZoom, ZOOM_MAX) : ZOOM_MAX;
  // A caller that passes min > max has contradicted itself; the lower bound wins, because
  // an unreadably small page is a worse answer than a slightly-too-large one.
  const capped = Math.min(Math.max(usable / pageWidthPx, lower), Math.max(upper, lower));

  return Math.floor(capped * 100) / 100;
}
