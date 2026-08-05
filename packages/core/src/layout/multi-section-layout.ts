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
import { finalizePageFieldProjection, withPageFieldSources } from './field-projection.ts';
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
  type SectionColumns,
} from './section-properties.ts';
import type { PageGeometry, PageRecord, SemanticLayout } from './semantic-records.ts';
import type { PageFurniture, SemanticLayoutOptions } from './semantic-layout.ts';

export interface SectionLayoutResult {
  readonly layout: SemanticLayout;
  readonly pages: readonly PageRecord[];
  readonly lineCounter: number;
  /** Used height of the last page's content column, for a section continuing onto it. */
  readonly endCursorY: number;
  /** Trailing paragraph spacing at the end of the flow, for adjacent-spacing collapse. */
  readonly endSpaceAfter: number;
  /** Whether the last page is still open, or was closed by a trailing page break. */
  readonly endsOpenPage: boolean;
}

export type LayoutSectionFn = (
  bodies: readonly OoxmlElement[],
  revision: number,
  options: SemanticLayoutOptions & {
    readonly geometry: PageGeometry;
    readonly sectionColumns?: SectionColumns;
    readonly lineCounterStart?: number;
    readonly flowStartY?: number;
    readonly spaceBeforeCarry?: number;
    readonly pageIndexStart?: number;
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
      const pn = section.properties.pageNumbering;
      // Empty `{}` and absent both key as no authored numbering; attribute edits must bust
      // incremental reuse so PAGE start/fmt / SECTIONPAGES stay correct.
      const pnKey = pn
        ? `pn:${pn.start ?? ''},${pn.fmt ?? ''},${pn.chapStyle ?? ''},${pn.chapSep ?? ''}`
        : 'pn:';
      const columns = section.properties.columns;
      const columnsKey = `cols:${columns.count},${columns.gapTwips},${columns.equalWidth === false ? 0 : 1},${columns.separator ? 1 : 0};${(columns.definitions ?? []).map((column) => `${column.widthTwips}/${column.gapTwips}`).join(',')}`;
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
        pnKey,
        columnsKey,
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
 * Whether two sections could occupy one sheet: identical page box and margins.
 *
 * A sheet has ONE size. Word honours `continuous` by continuing the column on the current
 * page, which it cannot do when the new section restates the page — a continuous break that
 * also changes paper size or orientation starts a new page in Word too.
 */
function sameGeometry(a: PageGeometry, b: PageGeometry): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.margin.top === b.margin.top &&
    a.margin.right === b.margin.right &&
    a.margin.bottom === b.margin.bottom &&
    a.margin.left === b.margin.left &&
    (a.headerDistance ?? 36) === (b.headerDistance ?? 36) &&
    (a.footerDistance ?? 36) === (b.footerDistance ?? 36)
  );
}

/**
 * Append a continued section's first-page fragments to the sheet it continues.
 *
 * The fragments already carry content-relative offsets past the host page's used height
 * (the section was laid out with `flowStartY`), so this is a concatenation, not a shift.
 * The host page keeps its own furniture: the header/footer belong to the sheet, and the
 * continued section contributes content to it, not chrome.
 */
function withAppendedFragments(page: PageRecord, continued: PageRecord): PageRecord {
  if (
    continued.fragments.length === 0 &&
    !continued.columnSeparators?.length &&
    !continued.anchoredDrawings?.length
  ) {
    return page;
  }
  const anchoredDrawings =
    page.anchoredDrawings || continued.anchoredDrawings
      ? Object.freeze([...(page.anchoredDrawings ?? []), ...(continued.anchoredDrawings ?? [])])
      : undefined;
  return {
    ...page,
    fragments:
      continued.fragments.length > 0 ? [...page.fragments, ...continued.fragments] : page.fragments,
    ...((page.columnSeparators?.length || continued.columnSeparators?.length) && {
      columnSeparators: [...(page.columnSeparators ?? []), ...(continued.columnSeparators ?? [])],
    }),
    ...(anchoredDrawings ? { anchoredDrawings } : {}),
  };
}

/**
 * Publish a multi-section result onto the parent session, clearing the SINGLE-section
 * resume state it does not own.
 *
 * `previous` is shared by both paths, but `keys` / `checkpoints` / `context` describe one
 * flow over the whole body — meaningless once the document is sectioned. Leaving them
 * behind let a document go single -> multi -> single and match the ORIGINAL single-section
 * context on the way back, so the "nothing changed" early exit returned the multi-section
 * pages: undoing a section break repainted the pre-undo pagination.
 */
function adoptMultiSectionResult(
  session: LayoutSession,
  finalized: SemanticLayout,
  lineCounter: number
): void {
  session.previous = finalized;
  session.endLineCounter = lineCounter;
  session.keys = [];
  session.checkpoints = [];
  session.context = '';
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
  // The open column at the end of the last section, for a `continuous` section to resume.
  let flowCursorY = 0;
  let flowSpaceAfter = 0;
  let flowOpenPage = true;
  let previousGeometry: PageGeometry | null = null;
  let previousFurnitureKey = '';
  /** Next displayed PAGE value if the following section does not author `w:start`. */
  let nextDisplayed = 1;

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex]!;
    const slice = blocks.slice(section.blockStart, section.blockEndExclusive);
    const geometry = geometryOfSection(section.properties);
    const furniture = furnitureForSection(options, sectionIndex, sections.length);
    const startIndex = pages.length;
    const startSheetY = sheetY;
    const prevSpan = multi?.spans[sectionIndex];

    const furnitureKey = furnitureGeometryFingerprint(furniture);

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

    // CONTINUOUS: Word keeps the new section on the page the last one ended, resuming the
    // column immediately below its final paragraph. Only possible when the sheet does not
    // change under it — same page box and margins, and the same furniture push-down, since
    // both fix the content column this section would be flowing into.
    const continues =
      sectionIndex > 0 &&
      sections[sectionIndex - 1]!.properties.breakType === 'continuous' &&
      pages.length > 0 &&
      // A trailing page break already ended the previous sheet. Word puts the continued
      // section after that break, not on top of the page it closed.
      flowOpenPage &&
      previousGeometry !== null &&
      sameGeometry(previousGeometry, geometry) &&
      previousFurnitureKey === furnitureKey;

    // Empty nextPage/even/odd: lay out zero blocks so the section still flushes one blank
    // page under its own geometry and furniture (Word-compatible trailing section break).
    const sectionSession = multi?.sections[sectionIndex];

    const laid = layoutSection(slice, revision, {
      ...rest,
      geometry,
      furniture,
      sectionColumns: section.properties.columns,
      lineCounterStart: lineCounter,
      // A continued section's local page 0 IS the host sheet, so its document page index
      // is one behind the stack; every other section starts a fresh sheet at `startIndex`.
      pageIndexStart: continues ? startIndex - 1 : startIndex,
      ...(continues ? { flowStartY: flowCursorY, spaceBeforeCarry: flowSpaceAfter } : {}),
      ...(sectionSession ? { session: sectionSession } : {}),
    });
    lineCounter = laid.lineCounter;
    flowCursorY = laid.endCursorY;
    flowSpaceAfter = laid.endSpaceAfter;
    flowOpenPage = laid.endsOpenPage;
    previousGeometry = geometry;
    previousFurnitureKey = furnitureKey;

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

    const numbering = section.properties.pageNumbering;
    const displayedStart = numbering?.start !== undefined ? numbering.start : nextDisplayed;
    const format = numbering?.fmt;

    let remapped: readonly PageRecord[];
    if (continues) {
      // The section's first page is not a sheet: it is the tail of the one before it. Its
      // fragments join that sheet and the shell is dropped; anything that overflowed onto
      // a second page stacks normally from there. Identity reuse is skipped — the host
      // sheet is rebuilt this pass, so no prior page record describes it.
      const hostIndex = pages.length - 1;
      const host = pages[hostIndex]!;
      const merged = withAppendedFragments(host, laid.pages[0]!);
      if (merged !== host) {
        pages[hostIndex] = merged;
        const remappedIndex = remappedAll.lastIndexOf(host);
        if (remappedIndex !== -1) remappedAll[remappedIndex] = merged;
      }
      // The host section's span deliberately keeps the PRE-MERGE page. It records what
      // that section alone produced, and a later pass republishes it verbatim through the
      // identity-reuse path — so writing the merged page back there would re-append this
      // section's fragments to a sheet that already carries them, once per pass, forever.
      const built: PageRecord[] = [];
      for (const page of laid.pages.slice(1)) {
        const next = remapPage(page, pages.length + built.length, sheetY);
        built.push(next);
        sheetY = next.box.y + next.box.height + 24;
      }
      // Local page 0 lived on the host; overflow pages start at displayedStart + 1.
      // SECTIONPAGES counts the host contribution plus overflow sheets.
      const sectionPageCount = built.length + 1;
      remapped = withPageFieldSources(built, displayedStart + 1, sectionPageCount, format);
      for (const page of remapped) {
        pages.push(page);
        remappedAll.push(page);
      }
      nextDisplayed = displayedStart + sectionPageCount;
    } else if (localUnchanged && stackUnchanged) {
      remapped = prevSpan.remappedPages;
      reusedPages += remapped.length;
      for (const page of remapped) {
        pages.push(page);
        remappedAll.push(page);
        sheetY = page.box.y + page.box.height + 24;
      }
      nextDisplayed = displayedStart + remapped.length;
    } else {
      const built: PageRecord[] = [];
      for (const page of laid.pages) {
        const next = remapPage(page, pages.length + built.length, sheetY);
        built.push(next);
        sheetY = next.box.y + next.box.height + 24;
      }
      remapped = withPageFieldSources(built, displayedStart, built.length, format);
      for (const page of remapped) {
        pages.push(page);
        remappedAll.push(page);
      }
      nextDisplayed = displayedStart + remapped.length;
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
    const laid = layoutSection([], revision, {
      ...rest,
      geometry,
      sectionColumns: sections[0]?.properties.columns ?? DEFAULT_SECTION_PROPERTIES.columns,
    });
    const finalized = finalizePageFieldProjection({ revision, pages: laid.pages });
    if (multi) {
      multi.spans = [];
      multi.previousRemapped = laid.pages;
      multi.previousFinalized = finalized;
      multi.previousPageCount = finalized.pages.length;
    }
    if (session) {
      adoptMultiSectionResult(session, finalized, lineCounter);
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
    adoptMultiSectionResult(session, finalized, lineCounter);
    session.stats = {
      placed,
      total: total || 1,
      reusedPages,
      fullPasses: session.stats.fullPasses + (placed === total && reusedPages === 0 ? 1 : 0),
    };
  }

  return finalized;
}
