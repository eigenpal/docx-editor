// Per-section incremental layout for multi-section documents.
//
// A single LayoutSession cannot resume across section boundaries: each section has its own
// geometry and furniture, so a checkpoint from another geometry is not sound. Instead the
// orchestrator keeps one child session per section, keyed by section structure (bounds,
// geometry, break type, furniture), and reuses remapped page records by identity when the
// section-local layout and the stacked sheet offset both hold. Document-level PAGE/NUMPAGES
// finalize still runs once the total page count is known; when that count is unchanged,
// finalized page identities from the previous pass are restored for untouched sheets.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { finalizePageFieldProjection, withPageFieldSources } from './field-projection.ts';
import {
  remapPage,
  storyDrawingResourceToken,
  storyListMarkerToken,
  type HeaderFooterStoryLayout,
} from './hf-layout.ts';
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
import type { PageContentInsets } from './page-furniture-insets.ts';

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
    readonly balanceColumns?: boolean;
    readonly continuedPageInsets?: PageContentInsets;
  }
) => SectionLayoutResult;

function furnitureStoryEntries(
  stories: ReadonlyMap<string, HeaderFooterStoryLayout>,
  includeContent: boolean
): string {
  return [...stories]
    .map(([variant, story]) =>
      includeContent
        ? // `contentKey` describes the AUTHORED part, so it misses everything a story resolves
          // from ANOTHER part: the images it paints and the list markers it resolves from
          // `numbering.xml`. Both tokens ride along for the same reason they do in
          // `furnitureLayoutContext` — without them a reused section keeps a stale header.
          `${variant}=${story.flowHeight}@${story.contentKey}` +
          `${storyDrawingResourceToken(story)}${storyListMarkerToken(story)}`
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

/**
 * Stable key for section page geometry + furniture geometry (not story text).
 *
 * Deliberately EXCLUDES each section's block bounds: a split or join anywhere shifts the
 * absolute block indices of every section after it while changing none of them, and keying
 * on the bounds reset every child session — one Enter in a 100-section document re-laid all
 * 100 sections. Content changes are what the child sessions' own per-block keys detect;
 * this key only answers whether section COUNT, geometry, furniture, numbering and columns
 * still line up positionally.
 */
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
 * Whether two sections could occupy one sheet: identical page box (size / orientation).
 *
 * A sheet has ONE size. Word honours `continuous` by continuing the column on the current
 * page; a continuous break that also changes paper size or orientation starts a new page.
 * Mid-page margin / header-distance changes stay on the sheet — Word applies the new
 * content column below the resumed cursor, and the host sheet keeps its furniture.
 */
function samePageSize(a: PageGeometry, b: PageGeometry): boolean {
  return a.width === b.width && a.height === b.height;
}

/** One sheet's content box, as the insets a section pass flows against. */
function contentInsetsOf(page: PageRecord): PageContentInsets {
  const top = page.contentBox.y - page.box.y;
  return {
    top,
    bottom: page.box.height - top - page.contentBox.height,
    height: page.contentBox.height,
  };
}

/**
 * Append a continued section's first-page fragments to the sheet it continues.
 *
 * The fragments already carry content-relative offsets past the host page's used height
 * (the section was laid out with `flowStartY` and, since per-page insets, the host's own
 * content box through {@link contentInsetsOf}), so this is a concatenation, not a shift.
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
  session.startLineCounter = 0;
  session.endLineCounter = lineCounter;
  session.keys = [];
  session.checkpoints = [];
  session.context = '';
  session.producer = '';
}

/**
 * The published (remapped + PAGE-field-stamped) sheet a section-local page last produced.
 *
 * A rebuilt section remaps EVERY page it laid, including the ones its own incremental pass
 * carried over by reference — and `remapPage` mints fresh box and furniture wrappers even
 * when nothing moved. Paint skips a page only by record identity, so a one-character edit
 * repainted every sheet of its section. Keyed on the section-local record: an edit replaces
 * it, and any changed publish parameter misses, so the memo can only return a twin the same
 * inputs would rebuild.
 */
interface PublishedPageMemo {
  readonly globalIndex: number;
  readonly sheetY: number;
  readonly pageNumber: number;
  readonly sectionPageCount: number;
  readonly format: string | undefined;
  readonly published: PageRecord;
}
const publishedPageMemos = new WeakMap<PageRecord, PublishedPageMemo>();

function publishSectionPage(
  page: PageRecord,
  globalIndex: number,
  sheetY: number,
  pageNumber: number,
  sectionPageCount: number,
  format: string | undefined
): PageRecord {
  const memo = publishedPageMemos.get(page);
  if (
    memo &&
    memo.globalIndex === globalIndex &&
    memo.sheetY === sheetY &&
    memo.pageNumber === pageNumber &&
    memo.sectionPageCount === sectionPageCount &&
    memo.format === format
  ) {
    return memo.published;
  }
  const remapped = remapPage(page, globalIndex, sheetY);
  const published = withPageFieldSources([remapped], pageNumber, sectionPageCount, format)[0]!;
  publishedPageMemos.set(page, {
    globalIndex,
    sheetY,
    pageNumber,
    sectionPageCount,
    format,
    published,
  });
  return published;
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
  // One retention pass over the UNION of every section's live keys. Retaining inside each
  // section's pass evicted every other section's entries — the multi-section break cache
  // was empty on every pass. The sweep runs on the retention stride; skipped passes hand
  // every section `false` so none of them retains alone.
  const retainKeys =
    rest.cache && rest.retainKeys !== false
      ? (rest.retainKeys ?? ((rest.cache.retentionPassDue?.() ?? true) ? new Set<string>() : false))
      : false;
  const retainOnce = (): void => {
    if (retainKeys && !rest.retainKeys) rest.cache?.retain(retainKeys);
  };

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
        sourcePages: [],
      });
      continue;
    }

    // CONTINUOUS: `w:type` on THIS section's trailing `w:sectPr` says how the section starts
    // relative to the previous one (ECMA-376 §17.6.22 / ST_SectionMark). Absent type is
    // nextPage. When continuous, Word keeps the section on the page the last one ended,
    // resuming the column immediately below its final paragraph — only when the sheet size
    // and furniture push-down are unchanged (furniture belongs to the host sheet).
    const continues =
      sectionIndex > 0 &&
      section.properties.breakType === 'continuous' &&
      pages.length > 0 &&
      // A trailing page break already ended the previous sheet. Word puts the continued
      // section after that break, not on top of the page it closed.
      flowOpenPage &&
      previousGeometry !== null &&
      samePageSize(previousGeometry, geometry) &&
      previousFurnitureKey === furnitureKey;

    // Empty nextPage/even/odd: lay out zero blocks so the section still flushes one blank
    // page under its own geometry and furniture (Word-compatible trailing section break).
    const sectionSession = multi?.sections[sectionIndex];

    // A multi-column section that ends in a continuous section break balances its columns
    // (ECMA-376 §17.6.4). The break that ENDS this section is the next section's `w:type`;
    // the document's last section has no such break, so it keeps the fill-first shape.
    const balanceColumns =
      section.properties.columns.count > 1 &&
      sections[sectionIndex + 1]?.properties.breakType === 'continuous';

    // A continued section's local page 0 IS the host sheet, so it must flow against the box
    // that sheet already has. Its own variants describe a page it never opens: with `w:titlePg`
    // on both sections the host resolves `default` and this section would resolve `first`, and
    // the taller box packs content past the host's content bottom.
    const continuedPageInsets = continues ? contentInsetsOf(pages[pages.length - 1]!) : undefined;

    const laid = layoutSection(slice, revision, {
      ...rest,
      retainKeys,
      geometry,
      furniture,
      sectionColumns: section.properties.columns,
      ...(balanceColumns ? { balanceColumns } : {}),
      lineCounterStart: lineCounter,
      // A continued section's local page 0 IS the host sheet, so its document page index
      // is one behind the stack; every other section starts a fresh sheet at `startIndex`.
      pageIndexStart: continues ? startIndex - 1 : startIndex,
      ...(continues ? { flowStartY: flowCursorY, spaceBeforeCarry: flowSpaceAfter } : {}),
      ...(continuedPageInsets ? { continuedPageInsets } : {}),
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
      prevSpan.pageCount === laid.pages.length &&
      // IDENTITY, not counts: the section may have laid out more than once inside this
      // document pass (a reserve re-run, a balancing probe), and the final run then reports
      // "nothing placed" against its own session even though an earlier run this pass
      // rebuilt the pages. Reusing the previous pass's sheets on stats alone republished a
      // resize's pre-edit geometry — the image repainted, the frame the span carried did not.
      prevSpan.sourcePages.length === laid.pages.length &&
      prevSpan.sourcePages.every((page, index) => page === laid.pages[index]);

    const stackUnchanged =
      prevSpan !== undefined &&
      prevSpan.startIndex === startIndex &&
      prevSpan.sheetY === startSheetY &&
      prevSpan.remappedPages.length === laid.pages.length;

    const numbering = section.properties.pageNumbering;
    const displayedStart = numbering?.start !== undefined ? numbering.start : nextDisplayed;
    const format = numbering?.fmt;

    // The stack checks prove the sheets did not MOVE; this proves their displayed numbering
    // did not either. `displayedStart` is inherited through every section before this one, so
    // a continuous section merging into its host (indices and counts unchanged here) can still
    // shift a later span's PAGE values. The published pages carry what they were stamped with,
    // so the first one answers for the whole span.
    const firstPrevious = prevSpan?.remappedPages[0];
    const numberingUnchanged =
      prevSpan === undefined ||
      prevSpan.remappedPages.length === 0 ||
      (firstPrevious?.pageFieldSource !== undefined &&
        firstPrevious.pageFieldSource.pageNumber === displayedStart &&
        firstPrevious.pageFieldSource.sectionPageCount === prevSpan.remappedPages.length &&
        firstPrevious.pageFieldSource.format === format);

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
    } else if (localUnchanged && stackUnchanged && numberingUnchanged) {
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
        const next = publishSectionPage(
          page,
          pages.length + built.length,
          sheetY,
          displayedStart + built.length,
          laid.pages.length,
          format
        );
        built.push(next);
        sheetY = next.box.y + next.box.height + 24;
      }
      remapped = built;
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
      sourcePages: laid.pages,
    });
  }

  if (pages.length === 0) {
    const geometry = geometryOfSection(sections[0]?.properties ?? DEFAULT_SECTION_PROPERTIES);
    const laid = layoutSection([], revision, {
      ...rest,
      retainKeys,
      geometry,
      sectionColumns: sections[0]?.properties.columns ?? DEFAULT_SECTION_PROPERTIES.columns,
    });
    retainOnce();
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

  retainOnce();
  return finalized;
}
