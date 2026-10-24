// The top limit of a wrapping object that its paragraph positions.
//
// In modern compatibility modes a body object that wraps text and takes its vertical position
// from its anchor paragraph never starts above the content box top: a negative offset that
// would lift it into the top margin stops at the margin. An object that does not wrap
// (`wrapNone`, in front of or behind the text) keeps its offset. Legacy modes keep it too.

import type { ImageWrapTarget } from '../store/package/drawing-projection.ts';

interface ContentTopContext {
  readonly wrappedParagraphAnchorsBelowContentTop?: boolean;
  readonly storyKind: string;
  readonly cellBox: unknown;
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
    wrap !== 'inline' &&
    wrap !== 'behind' &&
    wrap !== 'inFront'
  );
}

/** The resolved top `y` (page-content coordinates) after the content box top limit. */
export function wrappedParagraphAnchorTop(
  y: number,
  verticalFrame: string,
  wrap: ImageWrapTarget,
  ctx: ContentTopContext
): number {
  return y < 0 && stopsAtContentTop(verticalFrame, wrap, ctx) ? 0 : y;
}
