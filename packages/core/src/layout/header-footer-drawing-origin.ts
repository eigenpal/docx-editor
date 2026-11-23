import type { AnchoredDrawingRecord } from './drawing-layout.ts';

/** Resolve the header's physical sheet top in its local story coordinates. */
export function headerTopMarginOrigin(
  part: { readonly root: { readonly localName: string } },
  context: { readonly storyTop?: number } | undefined,
  page: { readonly storyDistance?: number } | undefined
): number | undefined {
  if (part.root.localName !== 'hdr') return undefined;
  const top = context?.storyTop ?? page?.storyDistance;
  return top === undefined ? undefined : -top;
}

/**
 * Resolve a header/footer anchor origin across mixed page- and story-relative axes. An axis
 * that layout resolved in page-content coordinates carries the page edge in record space
 * (`horizontalPageLeft`, `verticalPageTop`) and is placed from the page box. Every other axis,
 * including one resolved against a table cell, is placed from the story box. @internal
 */
export function headerFooterAnchoredDrawingOrigin(
  drawing: AnchoredDrawingRecord,
  storyOrigin: Readonly<{ x: number; y: number }>,
  pageOrigin: Readonly<{ x: number; y: number }>
): Readonly<{ x: number; y: number }> {
  return Object.freeze({
    x:
      drawing.horizontalPageLeft !== undefined
        ? pageOrigin.x + drawing.x - drawing.horizontalPageLeft
        : storyOrigin.x + drawing.x,
    y:
      drawing.verticalPageTop !== undefined
        ? pageOrigin.y + drawing.y - drawing.verticalPageTop
        : storyOrigin.y + drawing.y,
  });
}
