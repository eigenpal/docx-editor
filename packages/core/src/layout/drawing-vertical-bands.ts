// Vertical margin bands of an anchored drawing (ECMA-376 Part 1 §20.4.3.5 ST_RelFromV).

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
