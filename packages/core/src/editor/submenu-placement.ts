// Where a menu's submenu panel opens, in client space, for both adapters.

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
