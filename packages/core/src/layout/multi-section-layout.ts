// Per-section incremental layout for multi-section documents.
//
// A single LayoutSession cannot resume across section boundaries: each section has its own
// geometry and furniture, so a checkpoint from another geometry is not sound. Instead the
// orchestrator keeps one child session per section, keyed by section structure (bounds,
// geometry, break type, furniture), and reuses remapped page records by identity when the
// section-local layout and the stacked sheet offset both hold. Document-level PAGE/NUMPAGES
// finalize still runs once the total page count is known; when that count is unchanged,
// finalized page identities from the previous pass are restored for untouched sheets.

import type { OoxmlElement } from '@docx-editor.dev/core-contract/store';
import { finalizePageFieldProjection } from './field-projection.ts';
import { remapPage, type HeaderFooterStoryLayout } from './hf-layout.ts';
import {
  createLayoutSession,
  type LayoutSession,
  type MultiSectionLayoutState,
  type SectionStackSpan,
} from './layout-session.ts';
import {
  DEFAULT_SECTION_PROPERTIES,
  geometryOfSection,
  type DocumentSection,
} from './section-properties.ts';
import type { PageGeometry, PageRecord, SemanticLayout } from './semantic-records.ts';
import type { PageFurniture, SemanticLayoutOptions } from './semantic-layout.ts';

export interface SectionLayoutResult {
  readonly layout: SemanticLayout;
  readonly pages: readonly PageRecord[];
  readonly lineCounter: number;
}

export type LayoutSectionFn = (
  bodies: readonly OoxmlElement[],
  revision: number,
  options: SemanticLayoutOptions & {
    readonly geometry: PageGeometry;
    readonly lineCounterStart?: number;
  }
) => SectionLayoutResult;

function furnitureStoryEntries(
  stories: ReadonlyMap<string, HeaderFooterStoryLayout>,
  includeContent: boolean
): string {
  return [...stories]
    .map(([variant, story]) =>
      includeContent
        ? `${variant}=${story.flowHeight}@${story.contentKey}`
        : `${variant}=${story.flowHeight}`
    )
    .sort()
    .join(',');
}

/**
 * Furniture identity that changes the section content area (flags + flow heights only).
 *
 * Used by the multi-section structure key so a content-only A→B edit at equal height does
 * not reset every child session — story content invalidates through per-section layout
 * context instead ({@link furnitureFingerprint} / semantic-layout furniture context).
 */
function furnitureGeometryFingerprint(furniture: PageFurniture | undefined): string {
  if (!furniture) return '';
  return `hf:${furniture.titlePage ? 1 : 0}${furniture.evenAndOddHeaders ? 1 : 0};h:${furnitureStoryEntries(furniture.headers, false)};f:${furnitureStoryEntries(furniture.footers, false)}`;
}

/**
 * Full furniture cache identity: geometry flags/heights plus bounded story content keys.
 *
 * Equal-height header/footer text changes must not collide with prior furniture.
 */
export function furnitureFingerprint(furniture: PageFurniture | undefined): string {
  if (!furniture) return '';
  return `hf:${furniture.titlePage ? 1 : 0}${furniture.evenAndOddHeaders ? 1 : 0};h:${furnitureStoryEntries(furniture.headers, true)};f:${furnitureStoryEntries(furniture.footers, true)}`;
}

export function furnitureForSection(
  options: SemanticLayoutOptions,
  sectionIndex: number,
  sectionCount: number
): PageFurniture | undefined {
  if (options.sectionFurniture) return options.sectionFurniture[sectionIndex];
  if (sectionIndex === sectionCount - 1) return options.furniture;
  return undefined;
}

/** Stable key for section bounds + page geometry + furniture geometry (not story text). */
export function multiSectionStructureKey(
  sections: readonly DocumentSection[],
  options: SemanticLayoutOptions
): string {
  return sections
    .map((section, index) => {
      const geometry = geometryOfSection(section.properties);
      const furniture = furnitureForSection(options, index, sections.length);
      return [
        section.blockStart,
        section.blockEndExclusive,
        section.properties.breakType,
        geometry.width,
        geometry.height,
        geometry.margin.top,
        geometry.margin.right,
        geometry.margin.bottom,
        geometry.margin.left,
        geometry.headerDistance ?? 36,
        geometry.footerDistance ?? 36,
        furnitureGeometryFingerprint(furniture),
      ].join(':');
    })
    .join('|');
}

function ensureMultiState(
  session: LayoutSession | undefined,
  structureKey: string,
  sectionCount: number
): MultiSectionLayoutState | null {
  if (!session) return null;
  const existing = session.multi;
  if (
    existing &&
    existing.structureKey === structureKey &&
    existing.sections.length === sectionCount
  ) {
    return existing;
  }
  const fresh: MultiSectionLayoutState = {
    structureKey,
    sections: Array.from({ length: sectionCount }, () => createLayoutSession()),
    spans: [],
    previousRemapped: [],
    previousFinalized: null,
    previousPageCount: -1,
  };
  session.multi = fresh;
  return fresh;
}

/**
 * Whether an empty section still needs its own sheet.
 *
 * Default/`nextPage` (and deferred-parity `evenPage`/`oddPage`) start on a new page even with
 * no body blocks — Word keeps that blank sheet for geometry and furniture. `continuous`
 * shares the previous sheet, so an empty continuous section must not manufacture a page.
 */
export function emptySectionNeedsBlankPage(
  breakType: DocumentSection['properties']['breakType']
): boolean {
  return breakType !== 'continuous';
}

/**
 * Lay a multi-section part out section by section, with per-section incremental sessions.
 *
 * `w:type` on a section (default `nextPage`) controls whether that section starts on a new
 * sheet relative to the previous one. Continuous sections keep flowing on the current sheet
 * only when the previous section left no open page — after a normal flush they still start
 * cleanly. Odd/even page types currently behave like nextPage (blank-page skipping deferred).
 *
 * An empty final section is still laid out when its break type requires a new sheet: that
 * materializes the blank page Word keeps for the section's geometry and furniture.
 */
export function layoutMultiSectionDocument(
  blocks: readonly OoxmlElement[],
  sections: readonly DocumentSection[],
  revision: number,
  options: SemanticLayoutOptions,
  layoutSection: LayoutSectionFn
): SemanticLayout {
  const { session, ...rest } = options;
  const structureKey = multiSectionStructureKey(sections, options);
  const multi = ensureMultiState(session, structureKey, sections.length);

  const pages: PageRecord[] = [];
  const remappedAll: PageRecord[] = [];
  const newSpans: SectionStackSpan[] = [];
  let sheetY = 0;
  let lineCounter = 0;
  let placed = 0;
  let total = 0;
  let reusedPages = 0;

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex]!;
    const slice = blocks.slice(section.blockStart, section.blockEndExclusive);
    const geometry = geometryOfSection(section.properties);
    const furniture = furnitureForSection(options, sectionIndex, sections.length);
    const startIndex = pages.length;
    const startSheetY = sheetY;
    const prevSpan = multi?.spans[sectionIndex];

    // Empty continuous: share/continue — record a zero-page span so section indices stay
    // aligned for incremental reuse, and do not invent a blank sheet.
    if (slice.length === 0 && !emptySectionNeedsBlankPage(section.properties.breakType)) {
      newSpans.push({
        startIndex,
        pageCount: 0,
        sheetY: startSheetY,
        remappedPages: [],
      });
      continue;
    }

    // Empty nextPage/even/odd: lay out zero blocks so the section still flushes one blank
    // page under its own geometry and furniture (Word-compatible trailing section break).
    const sectionSession = multi?.sections[sectionIndex];

    const laid = layoutSection(slice, revision, {
      ...rest,
      geometry,
      furniture,
      lineCounterStart: lineCounter,
      ...(sectionSession ? { session: sectionSession } : {}),
    });
    lineCounter = laid.lineCounter;

    if (sectionSession) {
      placed += sectionSession.stats.placed;
      total += sectionSession.stats.total;
    } else {
      placed += slice.length;
      total += slice.length;
    }

    const localUnchanged =
      sectionSession !== undefined &&
      sectionSession.stats.placed === 0 &&
      sectionSession.stats.reusedPages === laid.pages.length &&
      prevSpan !== undefined &&
      prevSpan.pageCount === laid.pages.length;

    const stackUnchanged =
      prevSpan !== undefined &&
      prevSpan.startIndex === startIndex &&
      prevSpan.sheetY === startSheetY &&
      prevSpan.remappedPages.length === laid.pages.length;

    let remapped: readonly PageRecord[];
    if (localUnchanged && stackUnchanged) {
      remapped = prevSpan.remappedPages;
      reusedPages += remapped.length;
      for (const page of remapped) {
        pages.push(page);
        remappedAll.push(page);
        sheetY = page.box.y + page.box.height + 24;
      }
    } else {
      const built: PageRecord[] = [];
      for (const page of laid.pages) {
        const next = remapPage(page, pages.length, sheetY);
        built.push(next);
        pages.push(next);
        remappedAll.push(next);
        sheetY = next.box.y + next.box.height + 24;
      }
      remapped = built;
    }

    newSpans.push({
      startIndex,
      pageCount: remapped.length,
      sheetY: startSheetY,
      remappedPages: remapped,
    });
  }

  if (pages.length === 0) {
    const geometry = geometryOfSection(sections[0]?.properties ?? DEFAULT_SECTION_PROPERTIES);
    const laid = layoutSection([], revision, { ...rest, geometry });
    const finalized = finalizePageFieldProjection({ revision, pages: laid.pages });
    if (multi) {
      multi.spans = [];
      multi.previousRemapped = laid.pages;
      multi.previousFinalized = finalized;
      multi.previousPageCount = finalized.pages.length;
    }
    if (session) {
      session.previous = finalized;
      session.endLineCounter = lineCounter;
      session.stats = {
        placed: 0,
        total: 0,
        reusedPages: 0,
        fullPasses: session.stats.fullPasses + 1,
      };
    }
    return finalized;
  }

  const freshlyFinalized = finalizePageFieldProjection({ revision, pages });
  let finalized = freshlyFinalized;

  // Restore prior finalized page identities when the remapped source and total count hold.
  if (
    multi?.previousFinalized &&
    multi.previousPageCount === freshlyFinalized.pages.length &&
    multi.previousRemapped.length === remappedAll.length
  ) {
    const prevFinal = multi.previousFinalized.pages;
    const prevRemapped = multi.previousRemapped;
    const merged = freshlyFinalized.pages.map((page, index) => {
      if (remappedAll[index] === prevRemapped[index] && prevFinal[index]) {
        return prevFinal[index]!;
      }
      return page;
    });
    finalized = { revision, pages: merged };
  }

  if (multi) {
    multi.spans = newSpans;
    multi.previousRemapped = remappedAll;
    multi.previousFinalized = finalized;
    multi.previousPageCount = finalized.pages.length;
  }

  if (session) {
    session.previous = finalized;
    session.endLineCounter = lineCounter;
    session.stats = {
      placed,
      total: total || 1,
      reusedPages,
      fullPasses: session.stats.fullPasses + (placed === total && reusedPages === 0 ? 1 : 0),
    };
  }

  return finalized;
}
