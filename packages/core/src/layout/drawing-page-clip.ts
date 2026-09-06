import type { LayoutBox } from './semantic-records.ts';

/** The frame fields a page clip reads: a structural subset of the anchor frame context. */
export interface PageClipFrame {
  readonly pageWidth: number;
  readonly pageHeight?: number | undefined;
  readonly marginLeft: number;
  readonly contentInsetTop: number;
  readonly contentInsetBottom: number;
  readonly contentBandHeight: number;
}

/**
 * Full physical page clip, including margins and all columns. A continuous section's
 * content band can end before the sheet does; it must not crop page-relative artwork.
 * Callers without physical height retain the full-band fallback.
 */
export function pageClipRegion(frameBase: PageClipFrame): LayoutBox {
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
