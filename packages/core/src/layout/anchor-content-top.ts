// The top limit of a wrapping object that its paragraph positions.
//
// In modern compatibility modes a body object that wraps text and takes its vertical position
// from its anchor paragraph never starts above the content box top: a negative offset that
// would lift it into the top margin stops at the margin. An object that does not wrap
// (`wrapNone`, in front of or behind the text) keeps its offset. Legacy modes keep it too.
//
// In a table cell the same object, laid out in the cell, stops at the cell box top in every
// mode, and the row grows to hold it (see `cell-anchor-extent.ts`).

import type { ImageWrapTarget } from '../store/package/drawing-projection.ts';

interface ContentTopContext {
  readonly wrappedParagraphAnchorsBelowContentTop?: boolean;
  readonly storyKind: string;
  readonly cellBox: { readonly y: number } | null;
  readonly layoutInCell?: boolean;
  readonly inTableCell?: boolean;
}

/** Whether the object wraps text: not inline, not in front of or behind it. */
export function wrapsText(wrap: ImageWrapTarget): boolean {
  return wrap !== 'inline' && wrap !== 'behind' && wrap !== 'inFront';
}

/** Whether a body object with this frame and wrap stops at the content box top. */
export function stopsAtContentTop(
  verticalFrame: string,
  wrap: ImageWrapTarget,
  ctx: ContentTopContext
): boolean {
  return (
    ctx.wrappedParagraphAnchorsBelowContentTop === true &&
    ctx.storyKind === 'body' &&
    ctx.cellBox == null &&
    verticalFrame === 'paragraph' &&
    wrapsText(wrap)
  );
}

/** Whether a cell object with this frame and wrap stops at the cell box top. */
function stopsAtCellTop(verticalFrame: string, wrap: ImageWrapTarget, ctx: ContentTopContext) {
  return (
    ctx.cellBox != null &&
    ctx.inTableCell === true &&
    ctx.layoutInCell === true &&
    verticalFrame === 'paragraph' &&
    wrapsText(wrap)
  );
}

/** The resolved top `y` (page-content coordinates) after the content box top limit. */
export function wrappedParagraphAnchorTop(
  y: number,
  verticalFrame: string,
  wrap: ImageWrapTarget,
  ctx: ContentTopContext
): number {
  if (ctx.cellBox != null && y < ctx.cellBox.y && stopsAtCellTop(verticalFrame, wrap, ctx))
    return ctx.cellBox.y;
  return y < 0 && stopsAtContentTop(verticalFrame, wrap, ctx) ? 0 : y;
}
