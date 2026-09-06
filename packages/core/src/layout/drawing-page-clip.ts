import type { DrawingAnchorFrameContext } from './drawing-layout.ts';
import type { LayoutBox } from './semantic-records.ts';

/**
 * Full physical page clip, including margins and all columns. A continuous section's
 * content band can end before the sheet does; it must not crop page-relative artwork.
 * Callers without physical height retain the full-band fallback.
 */
export function pageClipRegion(
  frameBase: Pick<
    DrawingAnchorFrameContext,
    'pageWidth' | 'marginLeft' | 'contentInsetTop' | 'contentInsetBottom' | 'contentBandHeight'
  > &
    Partial<Pick<DrawingAnchorFrameContext, 'pageHeight'>>
): LayoutBox {
  const height = frameBase.pageHeight;
  return Object.freeze({
    x: -frameBase.marginLeft,
    y: -frameBase.contentInsetTop,
    width: frameBase.pageWidth,
    height:
      height !== undefined && Number.isFinite(height) && height > 0
        ? height
        : frameBase.contentBandHeight + frameBase.contentInsetTop + frameBase.contentInsetBottom,
  });
}
