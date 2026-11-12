// Where a menu's submenu panel and the context menu open, in client space, for both adapters.

/** Air kept between a submenu panel and the window edge, in CSS pixels. */
export const SUBMENU_EDGE_INSET = 8;

/**
 * The `left` and `top` of a submenu panel beside its parent row, in client pixels.
 *
 * The panel opens on the row's inline-end side: to the right in a left-to-right menu, to the
 * left in a right-to-left one, where the submenu caret points. It takes the other side when
 * it would not fit, and keeps `SUBMENU_EDGE_INSET` from the window edges. It aligns its top
 * with the row's, then rises so a submenu on the last row of a tall menu stays in view.
 *
 * @internal
 */
export function placeSubmenu(
  row: { readonly left: number; readonly right: number; readonly top: number },
  panel: { readonly width: number; readonly height: number },
  view: { readonly width: number; readonly height: number },
  rtl: boolean
): { readonly left: number; readonly top: number } {
  const rightSide = Math.min(row.right, view.width - panel.width - SUBMENU_EDGE_INSET);
  const leftSide = Math.max(SUBMENU_EDGE_INSET, row.left - panel.width);
  const fitsRight = row.right + panel.width <= view.width - SUBMENU_EDGE_INSET;
  const fitsLeft = row.left - panel.width >= SUBMENU_EDGE_INSET;
  const left = rtl ? (fitsLeft ? leftSide : rightSide) : fitsRight ? rightSide : leftSide;
  const top = Math.max(
    SUBMENU_EDGE_INSET,
    Math.min(row.top - 4, view.height - panel.height - SUBMENU_EDGE_INSET)
  );
  return { left, top };
}

/**
 * The keys that open and close a submenu: the inline-end arrow opens, the start one closes.
 *
 * @internal
 */
export function submenuKeys(rtl: boolean): { readonly open: string; readonly close: string } {
  return rtl
    ? { open: 'ArrowLeft', close: 'ArrowRight' }
    : { open: 'ArrowRight', close: 'ArrowLeft' };
}

/**
 * The `left`, `top`, and `maxHeight` of a context menu opened at a pointer, in client pixels.
 *
 * Horizontally it is a submenu beside a zero-width row at the pointer. Vertically it opens
 * below the pointer, flips above it when there is no room below, and otherwise moves up only
 * as far as it must to stay in the window. A menu taller than the window gets `maxHeight` (the
 * window less `SUBMENU_EDGE_INSET` at each edge) and scrolls inside.
 *
 * @internal
 */
export function placeContextMenu(
  pointer: { readonly x: number; readonly y: number },
  panel: { readonly width: number; readonly height: number },
  view: { readonly width: number; readonly height: number },
  rtl: boolean
): { readonly left: number; readonly top: number; readonly maxHeight: number } {
  const maxHeight = Math.max(0, view.height - SUBMENU_EDGE_INSET * 2);
  const height = Math.min(panel.height, maxHeight);
  const { left } = placeSubmenu(
    { left: pointer.x, right: pointer.x, top: pointer.y },
    { width: panel.width, height },
    view,
    rtl
  );
  // A keyboard-opened menu anchors on the scroller's corner, which is far above the window
  // once the reader has scrolled; it opens from the top inset instead.
  const y = Math.max(SUBMENU_EDGE_INSET, pointer.y);
  const bottom = view.height - SUBMENU_EDGE_INSET;
  const top =
    y + height <= bottom
      ? y
      : pointer.y - height >= SUBMENU_EDGE_INSET
        ? pointer.y - height
        : Math.max(SUBMENU_EDGE_INSET, bottom - height);
  return { left, top, maxHeight };
}

/**
 * Scroll a menu panel so that one of its rows is fully visible.
 *
 * Only the panel scrolls. `scrollIntoView` would also scroll the document under a fixed panel,
 * and a document scroll closes the menu.
 *
 * @internal
 */
export function revealMenuItem(panel: HTMLElement, item: Element | null): void {
  if (!item || !panel.contains(item)) return;
  const box = panel.getBoundingClientRect();
  const row = item.getBoundingClientRect();
  const top = box.top + panel.clientTop;
  const bottom = top + panel.clientHeight;
  if (row.top < top) panel.scrollTop -= top - row.top;
  else if (row.bottom > bottom) panel.scrollTop += row.bottom - bottom;
}

/**
 * Show a floating panel in the top layer, where no host stacking context, `transform`, or
 * `overflow` on an ancestor can cover or clip it. The panel stays in its DOM subtree, so it
 * keeps the editor's tokens and color mode. Returns false where the browser has no popover
 * support; the panel then relies on its `z-index` alone.
 *
 * @internal
 */
export function showInTopLayer(panel: HTMLElement): boolean {
  if (typeof panel.showPopover !== 'function') return false;
  if (!panel.hasAttribute('popover')) panel.setAttribute('popover', 'manual');
  try {
    panel.showPopover();
  } catch {
    // Already open: a second measure of the same panel.
  }
  return true;
}
