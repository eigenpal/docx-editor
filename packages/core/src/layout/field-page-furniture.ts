// Page-number fields across the FINISHED document, rather than inside one paragraph.
//
// PAGE, NUMPAGES and SECTIONPAGES cannot be resolved while a paragraph is being measured: the
// values are properties of a pagination that has not happened yet. So header/footer stories are
// laid out once carrying a projector, pages carry a {@link PageFieldSource} describing what the
// section says their numbering is, and the substitution happens here — once, after the page
// count is known.
//
// Split from `field-projection.ts`, which owns the paragraph walk. Nothing in this module reads
// a run; nothing in that one knows how many pages the document has. The dependency runs one way
// (`field-projection` re-exports these so existing importers keep one import site), so the two
// shared types live here rather than there.

import type { StoryPageFieldNeeds } from './field-instruction.ts';
import { NO_STORY_PAGE_FIELDS } from './field-instruction.ts';
import type { HeaderFooterStoryRecord, PageRecord, SemanticLayout } from './semantic-records.ts';

/**
 * Page-field evaluation context for furniture projection.
 *
 * `pageNumber` is the displayed PAGE value after section `w:pgNumType/@w:start` (1-based).
 * `pageCount` is document NUMPAGES. `sectionPageCount` is SECTIONPAGES for the attached
 * section. `format` is the authored `w:pgNumType/@w:fmt` applied only to PAGE.
 */
export interface FieldPageContext {
  readonly pageNumber: number;
  readonly pageCount: number;
  /** SECTIONPAGES; defaults to `pageCount` when omitted (single-section callers). */
  readonly sectionPageCount?: number;
  /** Authored ST_NumberFormat for PAGE; absent → decimal. */
  readonly format?: string;
}

/**
 * Per-page source for {@link finalizePageFieldProjection}, attached before document-level
 * page count is known. `pageCount` (NUMPAGES) is filled at finalize from `layout.pages.length`.
 */
export interface PageFieldSource {
  readonly pageNumber: number;
  readonly sectionPageCount: number;
  readonly format?: string;
}

/** True when any allowlisted page field is present. */
export function storyNeedsPageFields(needs: StoryPageFieldNeeds): boolean {
  return needs.hasPage || needs.hasNumPages || needs.hasSectionPages;
}

/**
 * Cache-key token for a page context under known field needs.
 *
 * Absent context and field-free stories share the empty baseline key. Keys include only the
 * dimensions the story actually reads so NUMPAGES-only / SECTIONPAGES-only stories reuse one
 * layout across every sheet that shares that count, while PAGE (and format) still distinguish
 * sheets whose measured digit widths differ.
 */
export function fieldPageContextToken(
  context: FieldPageContext | undefined,
  needs: StoryPageFieldNeeds = NO_STORY_PAGE_FIELDS
): string {
  if (!context) return '';
  if (!storyNeedsPageFields(needs)) return '';
  const parts: string[] = [];
  if (needs.hasPage) {
    parts.push(`p${context.pageNumber}`);
    if (context.format) parts.push(`f${context.format}`);
  }
  if (needs.hasNumPages) parts.push(`n${context.pageCount}`);
  if (needs.hasSectionPages) parts.push(`s${context.sectionPageCount ?? context.pageCount}`);
  return `|fld:${parts.join('/')}`;
}

/**
 * Attach section-local PAGE/SECTIONPAGES sources to remapped sheet pages.
 *
 * `displayedStart` is the 1-based PAGE value of the first page in `pages` (after
 * `w:pgNumType/@w:start` and cross-section continuation). NUMPAGES is filled later at
 * document finalize.
 *
 * Pages whose existing {@link PageFieldSource} already matches are returned by identity so
 * incremental layout can keep sheet records stable across no-op re-annotation.
 */
export function withPageFieldSources(
  pages: readonly PageRecord[],
  displayedStart: number,
  sectionPageCount: number,
  format: string | undefined
): PageRecord[] {
  let changed = false;
  const next = pages.map((page, index) => {
    const pageNumber = displayedStart + index;
    const existing = page.pageFieldSource;
    if (
      existing &&
      existing.pageNumber === pageNumber &&
      existing.sectionPageCount === sectionPageCount &&
      existing.format === format
    ) {
      return page;
    }
    changed = true;
    return {
      ...page,
      pageFieldSource: {
        pageNumber,
        sectionPageCount,
        ...(format ? { format } : {}),
      },
    };
  });
  return changed ? next : (pages as PageRecord[]);
}

/**
 * Project allowlisted PAGE/NUMPAGES/SECTIONPAGES onto every page's read-only furniture once
 * the document page count is known. Body stories are unchanged.
 *
 * Uses {@link PageFieldSource} when present (section restart + SECTIONPAGES + fmt). Absent
 * source keeps physical 1-based indices (`page.index + 1`) and treats the whole document as
 * one section — the empty-`pgNumType` comprehensive-fixture behaviour.
 */
export function finalizePageFieldProjection(layout: SemanticLayout): SemanticLayout {
  const pageCount = layout.pages.length;
  if (pageCount === 0) return layout;

  let changed = false;
  const pages = layout.pages.map((page) => {
    const source = page.pageFieldSource;
    const context: FieldPageContext = {
      pageNumber: source?.pageNumber ?? page.index + 1,
      pageCount,
      sectionPageCount: source?.sectionPageCount ?? pageCount,
      ...(source?.format ? { format: source.format } : {}),
    };
    const project = (
      story: HeaderFooterStoryRecord | undefined
    ): HeaderFooterStoryRecord | undefined => {
      if (!story?.pageFieldProjector) return story;
      changed = true;
      const projected = story.pageFieldProjector(context);
      // Strip the projector from the published record.
      const { pageFieldProjector: _drop, ...rest } = projected;
      void _drop;
      return rest;
    };
    const header = project(page.header);
    const footer = project(page.footer);
    if (header === page.header && footer === page.footer) return page;
    return {
      ...page,
      ...(header !== undefined ? { header } : {}),
      ...(footer !== undefined ? { footer } : {}),
    };
  });

  return changed ? { revision: layout.revision, pages } : layout;
}
