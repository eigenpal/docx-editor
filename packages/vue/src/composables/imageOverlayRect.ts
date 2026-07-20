/**
 * Pure geometry for the Vue image-selection overlay. Kept separate from the
 * component so the scrollbar-gutter handling can be unit-tested without a DOM.
 */

export interface OverlayRectInputs {
  /** `image.getBoundingClientRect()` (viewport coords). */
  imageRect: { left: number; top: number; width: number; height: number };
  /** `offsetParent.getBoundingClientRect()` (the scroll container, viewport coords). */
  parentRect: { left: number; top: number };
  scrollLeft: number;
  scrollTop: number;
  /** `offsetParent.offsetWidth` / `.clientWidth` — used to derive the gutter. */
  parentOffsetWidth: number;
  parentClientWidth: number;
  zoom: number;
}

export interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Position the overlay (absolute, inside the scroll container) over the image.
 *
 * The scroll container uses `scrollbar-gutter: stable both-edges`, which
 * reserves an inline-start gutter that sits OUTSIDE the absolute-positioning
 * origin. `getBoundingClientRect().left` is the border-box left (before the
 * gutter), so `imageRect.left - parentRect.left` over-counts the left gutter
 * and the frame lands shifted right by that width (issue #764). With
 * `both-edges` the two gutters are equal, so the left gutter is half of the
 * total reserved inline space (`offsetWidth - clientWidth`, no borders here).
 * On overlay-scrollbar platforms (e.g. macOS) the reserved space is 0, so the
 * correction is a no-op and behavior is unchanged.
 */
export function computeImageOverlayRect(i: OverlayRectInputs): OverlayRect {
  const reservedX = Math.max(0, i.parentOffsetWidth - i.parentClientWidth);
  const leftGutter = reservedX / 2;
  const z = i.zoom || 1;
  return {
    left: (i.imageRect.left - i.parentRect.left - leftGutter + i.scrollLeft) / z,
    top: (i.imageRect.top - i.parentRect.top + i.scrollTop) / z,
    width: i.imageRect.width / z,
    height: i.imageRect.height / z,
  };
}
