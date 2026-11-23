// Which coordinates an anchored drawing's axes resolve in, and the vertical margin bands
// (ECMA-376 Part 1 §20.4.3.5 ST_RelFromV).

/**
 * Whether a vertical frame resolves in page-content coordinates in this story: the page frame
 * always, and the margin bands when the story has no sheet top of its own (body and footer).
 */
export function resolvesInPageContent(
  frame: string | undefined,
  frameBase: { readonly topMarginFrameOrigin?: number }
): boolean {
  if (frame === 'page') return true;
  const marginBand =
    frame === 'topMargin' ||
    frame === 'bottomMargin' ||
    frame === 'insideMargin' ||
    frame === 'outsideMargin';
  return marginBand && frameBase.topMarginFrameOrigin === undefined;
}

/** A vertical band from `top` to `bottom`, as the edges an alignment reads. */
export function band(
  top: number,
  bottom: number
): { readonly top: number; readonly bottom: number; readonly center: number } {
  return { top, bottom, center: (top + bottom) / 2 };
}

/** The page edges a header or footer record carries for the axes that resolve on the page. */
export interface FurniturePageAxes {
  readonly verticalPageTop?: number;
  readonly horizontalPageLeft?: number;
}

/**
 * The page edges, in record space, of a header or footer record's page-resolved axes. A
 * record laid out in its table cell resolves against the cell box on both axes, so it carries
 * neither. Body records carry neither: their record space is already the page-content space.
 */
export function furniturePageAxes(
  frameBase: {
    readonly storyKind: string;
    readonly contentInsetTop: number;
    readonly marginLeft: number;
    readonly topMarginFrameOrigin?: number;
  },
  frames: { readonly horizontal?: string; readonly vertical?: string },
  resolvedInCell: boolean
): FurniturePageAxes {
  if (resolvedInCell) return {};
  if (frameBase.storyKind !== 'header' && frameBase.storyKind !== 'footer') return {};
  return {
    ...(resolvesInPageContent(frames.vertical, frameBase)
      ? { verticalPageTop: -frameBase.contentInsetTop }
      : {}),
    ...(frames.horizontal === 'page' ? { horizontalPageLeft: -frameBase.marginLeft } : {}),
  };
}

/**
 * The top of an object that `wp:align` places against a paragraph or a line, or null for
 * every other frame and value.
 *
 * ECMA-376 Part 1 §20.4.3.2 ST_AlignV aligns an object "with respect to the vertical
 * alignment base", and §20.4.3.5 ST_RelFromV makes that base the paragraph "which contains
 * the drawing anchor" or the line "containing the anchor character". The specification does
 * not give either base a height. This engine gives the line base no height: `center` centers
 * the object on the line top and `bottom` puts its bottom edge there. Against a paragraph,
 * `center` and `bottom` place the object at the paragraph top, as `top` does.
 */
export function paragraphOrLineAlignedTop(
  frame: string,
  align: string | null,
  baseTop: number,
  objectHeight: number
): number | null {
  if (align !== 'center' && align !== 'bottom') return null;
  if (frame === 'paragraph') return baseTop;
  if (frame !== 'line') return null;
  return align === 'center' ? baseTop - objectHeight / 2 : baseTop - objectHeight;
}

/** Whether a table cell box has a finite, positive size to lay an object out in. */
export function usableCellBox(
  box: { readonly width: number; readonly height: number } | null | undefined
): box is { readonly width: number; readonly height: number } {
  if (!box) return false;
  if (!Number.isFinite(box.height) || box.height <= 0) return false;
  return Number.isFinite(box.width) && box.width > 0;
}
