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
import type { SemanticLayout } from './semantic-records.ts';

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
  /**
   * The content box local page 0 must flow against when this section CONTINUES the previous
   * one's sheet, instead of opening one of its own.
   *
   * A `continuous` section's local page 0 is physically the previous section's last sheet: the
   * orchestrator appends the fragments to that page and drops this section's shell, keeping the
   * host's `contentBox`. So the variant this section would resolve for its own first page says
   * nothing about the box the fragments land in — and when both sections carry `w:titlePg`, the
   * host resolves `default` while this section resolves `first`, a taller box, and the flow
   * packs content past the host sheet's content bottom into the bottom margin.
   *
   * Passing the host's own insets makes the shared sheet one box for both flows, whatever
   * either section's variants say.
   */
  readonly continuedPageInsets?: PageContentInsets;
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
    // Local page 0 of a continued section is the host's sheet, not this section's first page.
    if (index === 0 && inputs.continuedPageInsets) return inputs.continuedPageInsets;
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

/**
 * The content box a page at a DOCUMENT index resolves to, published per finished layout.
 *
 * A page record carries the box it was built with, and a pass that MINTS a new sheet from an
 * existing one — note overflow does exactly that — used to copy that box verbatim. That was
 * right while every page in a section shared one, and wrong once each page derives its own:
 * an overflow sheet cloned from a title page inherits a box its own variant never resolves
 * to, and lays its notes against it.
 *
 * Keyed by the finished layout rather than by a page, because every published page is a fresh
 * object (page-field sources, projection finalize, boundary attachment all rebuild them) while
 * the layout the notes pass receives is exactly the one the body pass returned. Absent — a
 * caller that assembled a layout some other way — degrades to the template's own box.
 */
const layoutContentInsets = new WeakMap<
  SemanticLayout,
  (documentPageIndex: number) => PageContentInsets
>();

/** Publish `resolve` for `layout`; see {@link pageContentInsetsAt}. */
export function registerPageContentInsets(
  layout: SemanticLayout,
  resolve: (documentPageIndex: number) => PageContentInsets
): void {
  layoutContentInsets.set(layout, resolve);
}

/** The insets a page at `documentPageIndex` resolves to, or undefined when unpublished. */
export function pageContentInsetsAt(
  layout: SemanticLayout,
  documentPageIndex: number
): PageContentInsets | undefined {
  return layoutContentInsets.get(layout)?.(documentPageIndex);
}
