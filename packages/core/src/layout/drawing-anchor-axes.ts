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
