// Per-page content-box insets, derived from the header and footer variant THAT page shows.
//
// Word resolves the variant page by page (`w:titlePg` 17.6.55, `w:evenAndOddHeaders` 17.10.1)
// and sizes that page's content box from the chosen variant's own height. A section-wide worst
// case over every variant is wrong wherever the variants differ: a section that sets
// `w:titlePg` but declares no `w:headerReference w:type="first"` has NO header on its first
// page, so that page's body starts at `w:pgMar/@w:top` — not below the default header's height.
//
// The cap keeps pagination terminating. A hostile header of five hundred paragraphs must not
// shrink the content column to nothing, because pagination into a zero-height column never ends.

import type { HeaderFooterStoryLayout } from './hf-layout.ts';

/** Which header/footer variant a page shows (ECMA-376 §17.10.5). */
export type HeaderFooterVariantName = 'default' | 'first' | 'even';

/**
 * Pre-laid page furniture, supplied by the host (phase 2).
 *
 * Baseline stories are laid out once per variant (`layoutHeaderFooterStory`) for furniture
 * height. Stories that actually contain allowlisted PAGE/NUMPAGES fields attach a projector
 * so document-level finalize can re-layout under the known page count; field-free furniture
 * reuses the baseline on every sheet.
 */
export interface PageFurniture {
  readonly titlePage: boolean;
  readonly evenAndOddHeaders: boolean;
  readonly headers: ReadonlyMap<HeaderFooterVariantName, HeaderFooterStoryLayout>;
  readonly footers: ReadonlyMap<HeaderFooterVariantName, HeaderFooterStoryLayout>;
}

/** Fraction of the sheet one edge's furniture may consume before the cap binds. */
const FURNITURE_INSET_FRACTION = 0.4;

/** The content box one page gets, in points, relative to the sheet's top-left. */
export interface PageContentInsets {
  /** Distance from the sheet's top edge to the content box. */
  readonly top: number;
  /** Distance from the content box's bottom edge to the sheet's bottom edge. */
  readonly bottom: number;
  /** `pageHeight - top - bottom`. */
  readonly height: number;
}

export interface PageContentInsetInputs {
  readonly furniture?: PageFurniture;
  readonly pageHeight: number;
  readonly marginTop: number;
  readonly marginBottom: number;
  /** `w:pgMar/@w:header` in points. */
  readonly headerDistance: number;
  /** `w:pgMar/@w:footer` in points. */
  readonly footerDistance: number;
  /** Where this section's first sheet lands in the DOCUMENT, for even/odd selection. */
  readonly pageIndexStart: number;
}

/**
 * The variant the page at section-local `index` shows.
 *
 * `w:titlePg` is a property of the SECTION, so its first page is the section's own first — the
 * local index. `w:evenAndOddHeaders` lives in settings.xml and alternates by the page's number
 * in the DOCUMENT, so it reads through `pageIndexStart`: a section that begins on an even page
 * must open with the even header, and `remapPage` renumbers a page without re-picking anything.
 */
export function headerFooterVariantFor(
  furniture: PageFurniture | undefined,
  pageIndexStart: number,
  index: number
): HeaderFooterVariantName {
  if (furniture?.titlePage && index === 0) return 'first';
  if (furniture?.evenAndOddHeaders && (pageIndexStart + index + 1) % 2 === 0) return 'even';
  return 'default';
}

/**
 * Build the per-page inset resolver for one section pass.
 *
 * Memoized by variant name, of which there are three, so a thousand-page section resolves the
 * arithmetic three times rather than once per sheet.
 */
export function createPageContentInsets(
  inputs: PageContentInsetInputs
): (index: number) => PageContentInsets {
  const { furniture, pageHeight, marginTop, marginBottom } = inputs;
  const cap = pageHeight * FURNITURE_INSET_FRACTION;
  const memo = new Map<HeaderFooterVariantName, PageContentInsets>();
  const edge = (distance: number, story: HeaderFooterStoryLayout | undefined, margin: number) =>
    // An absent variant reserves nothing: the page has no furniture on that edge at all, so
    // the authored margin is the whole inset.
    Math.min(cap, Math.max(margin, story ? distance + story.flowHeight : 0));
  return (index: number): PageContentInsets => {
    const variant = headerFooterVariantFor(furniture, inputs.pageIndexStart, index);
    const cached = memo.get(variant);
    if (cached) return cached;
    const top = edge(inputs.headerDistance, furniture?.headers.get(variant), marginTop);
    const bottom = edge(inputs.footerDistance, furniture?.footers.get(variant), marginBottom);
    const insets: PageContentInsets = Object.freeze({
      top,
      bottom,
      height: pageHeight - top - bottom,
    });
    memo.set(variant, insets);
    return insets;
  };
}
