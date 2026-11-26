// Page geometry records, in points. Re-exported from `semantic-records.ts`.

/** Page geometry, in points. */
export interface PageGeometry {
  readonly width: number;
  readonly height: number;
  readonly margin: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  /** `w:pgMar/@header` — sheet edge to header top, in points. Defaults to 36 (720 twips). */
  readonly headerDistance?: number;
  /** `w:pgMar/@footer` — sheet edge to footer bottom, in points. Defaults to 36. */
  readonly footerDistance?: number;
  /**
   * The side margins of a page with an even displayed number, present only when they differ
   * from `margin`: `w:mirrorMargins` (CT_OnOff, ECMA-376 Part 1 §17.15.1.57) swaps the sides,
   * and facing pages move the gutter (`w:pgMar/@w:gutter`, CT_PageMar, §17.6.11) to the other
   * edge. `margin` then describes the odd pages. Both pages have the same content width.
   * Read one page's geometry through {@link geometryOnPage}.
   */
  readonly evenPageMargin?: { readonly left: number; readonly right: number };
}

const evenPageGeometries = new WeakMap<PageGeometry, PageGeometry>();

/**
 * The geometry of the page that displays `pageNumber`: `geometry` itself on an odd page and
 * on every page of a section without {@link PageGeometry.evenPageMargin}, else the same
 * sheet with the even page's side margins. The result has one identity per `geometry`.
 */
export function geometryOnPage(geometry: PageGeometry, pageNumber: number): PageGeometry {
  const even = geometry.evenPageMargin;
  if (!even || pageNumber % 2 !== 0) return geometry;
  let onEven = evenPageGeometries.get(geometry);
  if (!onEven) {
    const { evenPageMargin: _, ...sheet } = geometry;
    onEven = Object.freeze({
      ...sheet,
      margin: Object.freeze({ ...geometry.margin, left: even.left, right: even.right }),
    });
    evenPageGeometries.set(geometry, onEven);
  }
  return onEven;
}

/** US Letter with one-inch margins, in points. */
export const DEFAULT_PAGE_GEOMETRY: PageGeometry = Object.freeze({
  width: 612,
  height: 792,
  margin: Object.freeze({ top: 72, right: 72, bottom: 72, left: 72 }),
});
