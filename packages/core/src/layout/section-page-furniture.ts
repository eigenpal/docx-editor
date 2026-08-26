// The furniture one section's pages show, and the shell a sheet minted after layout gets.
//
// Extracted from the section pass so both live beside each other: what a page's header and
// footer records ARE, and what a page that did not exist when the pass ran should be given.
// They have to agree — a page whose content box comes from one variant and whose header comes
// from another paints an empty band exactly a header high — and keeping them in one factory is
// what makes that agreement checkable.

import type { FieldPageContext } from './field-page-furniture.ts';
import { storyNeedsPageFields } from './field-projection.ts';
import type { HeaderFooterStoryLayout } from './hf-layout.ts';
import {
  headerFooterVariantFor,
  type HeaderFooterVariantName,
  type OverflowPageShell,
  type PageContentInsets,
  type PageFurniture,
} from './page-furniture-insets.ts';
import type { HeaderFooterStoryRecord, LayoutBox, PageGeometry } from './semantic-records.ts';

export interface SectionPageFurnitureInputs {
  readonly furniture?: PageFurniture;
  readonly geometry: PageGeometry;
  /** `w:pgMar/@w:header` in points. */
  readonly headerDistance: number;
  /** `w:pgMar/@w:footer` in points. */
  readonly footerDistance: number;
  /** Where this section's first sheet lands in the DOCUMENT. */
  readonly pageIndexStart: number;
  /** Content width the stories were laid out at. */
  readonly contentWidth: number;
  /** This section's per-page content insets, by section-local index. */
  readonly insetsFor: (localIndex: number) => PageContentInsets;
  /** Pages the pass has completed so far, read when a story projects NUMPAGES. */
  readonly pageCount: () => number;
}

export interface SectionPageFurniture {
  /** The sheet rectangle for section-local `index`, including the scroll-surface gutter. */
  pageBox(index: number): LayoutBox;
  /** The variant page `index` shows — the same resolution its content box was derived from. */
  variantFor(index: number): HeaderFooterVariantName;
  /** The placed header or footer record for section-local `index` on `box`. */
  furnitureFor(
    kind: 'header' | 'footer',
    index: number,
    box: LayoutBox
  ): HeaderFooterStoryRecord | undefined;
  /** Content box AND furniture for a sheet minted at a DOCUMENT index, placed on `box`. */
  overflowShellAt(documentPageIndex: number, box: LayoutBox): OverflowPageShell;
}

/** 24pt gutter between sheets, for the scroll surface. */
const SHEET_GUTTER_PT = 24;

export function createSectionPageFurniture(
  inputs: SectionPageFurnitureInputs
): SectionPageFurniture {
  const { furniture, geometry, headerDistance, footerDistance, pageIndexStart } = inputs;

  const pageBox = (index: number): LayoutBox => ({
    x: 0,
    y: index * (geometry.height + SHEET_GUTTER_PT),
    width: geometry.width,
    height: geometry.height,
  });

  const variantFor = (index: number): HeaderFooterVariantName =>
    headerFooterVariantFor(furniture, pageIndexStart, index);

  const furnitureFor = (
    kind: 'header' | 'footer',
    index: number,
    box: LayoutBox
  ): HeaderFooterStoryRecord | undefined => {
    if (!furniture) return undefined;
    const variant = variantFor(index);
    const story = (kind === 'header' ? furniture.headers : furniture.footers).get(variant);
    // An absent variant shows nothing — Word falls back to blank, not to `default`.
    if (!story) return undefined;
    const place = (laid: HeaderFooterStoryLayout): HeaderFooterStoryRecord => {
      const y =
        kind === 'header'
          ? box.y + headerDistance
          : box.y + geometry.height - footerDistance - laid.flowHeight;
      return {
        kind,
        variant,
        partName: laid.partName,
        ...(laid.part ? { part: laid.part } : {}),
        ...(laid.rId ? { rId: laid.rId } : {}),
        box: {
          x: box.x + geometry.margin.left,
          y,
          width: inputs.contentWidth,
          height: laid.flowHeight,
        },
        fragments: laid.fragments,
        ...(laid.anchoredDrawings ? { anchoredDrawings: laid.anchoredDrawings } : {}),
      };
    };
    const pageNumber = pageIndexStart + index + 1;
    const pageContext: FieldPageContext = {
      pageNumber,
      pageCount: Math.max(pageNumber, inputs.pageCount() + 1),
      sectionPageCount: index + 1,
    };
    const needs = story.pageFieldNeeds;
    const needsPerPageLayout =
      storyNeedsPageFields(needs) || (story.anchoredDrawings?.length ?? 0) > 0;
    const laid = needsPerPageLayout ? story.withPageContext(pageContext) : story;
    const placed = place(laid);
    if (storyNeedsPageFields(needs)) {
      return {
        ...placed,
        pageFieldProjector: (context) => place(story.withPageContext(context)),
      };
    }
    return placed;
  };

  const overflowShellAt = (documentPageIndex: number, box: LayoutBox): OverflowPageShell => {
    const local = documentPageIndex - pageIndexStart;
    const header = furnitureFor('header', local, box);
    const footer = furnitureFor('footer', local, box);
    return {
      insets: inputs.insetsFor(local),
      ...(header ? { header } : {}),
      ...(footer ? { footer } : {}),
    };
  };

  return { pageBox, variantFor, furnitureFor, overflowShellAt };
}
