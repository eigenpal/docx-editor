// The page facts a header or footer story resolves anchored content against.

import type { FieldPageContext } from './field-page-furniture.ts';

/** Page geometry for header/footer anchored frame resolution (story-relative layout space). */
export interface HeaderFooterPageContext {
  readonly pageNumber: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginLeft: number;
  readonly marginRight: number;
  readonly marginTop: number;
  readonly marginBottom: number;
  /** `w:pgMar/@w:header` for a header, `@w:footer` for a footer: the story edge's distance. */
  readonly storyDistance?: number;
}

/** Per-sheet geometry needed to resolve header/footer anchors before wrap and clipping. */
export interface HeaderFooterLayoutPageContext extends FieldPageContext {
  /** Effective content-box inset after this page's header/footer reserves are applied. */
  readonly contentInsetTop?: number;
  /** Effective bottom content-box inset after footer reserve. */
  readonly contentInsetBottom?: number;
  /** Story-box top measured from the physical sheet top. */
  readonly storyTop?: number;
  /**
   * This page's side margins, when they differ from the section's odd-page margins: an even
   * page under `w:mirrorMargins` (CT_OnOff, ECMA-376 Part 1 §17.15.1.57) or with a gutter on
   * its other edge (`w:pgMar/@w:gutter`, CT_PageMar, §17.6.11). Both are set together.
   */
  readonly marginLeft?: number;
  readonly marginRight?: number;
}

/**
 * `section` with the side margins of the page `page` describes. An object positioned from the
 * page edge or a margin band then resolves against the page it is on.
 */
export function pageContextOnSide(
  section: HeaderFooterPageContext | undefined,
  page: HeaderFooterLayoutPageContext | undefined
): HeaderFooterPageContext | undefined {
  if (!section || page?.marginLeft === undefined || page.marginRight === undefined) return section;
  return { ...section, marginLeft: page.marginLeft, marginRight: page.marginRight };
}
