// Semantic paragraph layout over the canonical tree (tasks 7.1, 7.3).
//
// Produces the revision-tagged records in `semantic-records.ts`: pages, paragraph fragments,
// lines and style spans, each carrying a stable source range. It reads the CANONICAL TREE
// and a measurement port, never the DOM and never ProseMirror.
//
// A paragraph that does not fit the remaining page height is FRAGMENTED rather than moved
// wholesale: the lines that fit stay, the rest continue on the next page under the same
// paragraph id. That is what makes a cross-page paragraph one paragraph for selection and
// two boxes for pagination.

import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlPart,
  OoxmlProperty,
} from '@docx-editor.dev/core-contract/store';
import { finalizePageFieldProjection, type HyperlinkProjector } from './field-projection.ts';
import { paragraphLayoutKey, type ParagraphLayoutCache } from './layout-cache.ts';
import { alignSpans, breakParagraph, type Alignment, type PendingLine } from './paragraph-flow.ts';
import {
  appliedSpaceBefore,
  paragraphBorderExtentPt,
  cascadedParagraphBorders,
  collapsedSpaceBefore,
  paragraphBorders,
  paragraphBordersFingerprint,
  paragraphBreaksBefore,
  type ParagraphBorders,
  type ParagraphLineSpacing,
  type ParagraphSpacing,
} from './paragraph-style.ts';
import {
  adjustedBreakIndex,
  keepNextFlowKeys,
  keepNextGroupHeight,
  paragraphKeeps,
  MAX_KEEP_NEXT_CHAIN,
  type ParagraphKeeps,
} from './pagination-keeps.ts';
import { DEFAULT_RUN_STYLE, resolveRunStyle } from './run-style.ts';
import {
  tabStopsFingerprint,
  withDefaultTabInterval,
  type ResolvedTabStops,
} from './paragraph-tabs.ts';
import {
  cascadeParagraphFormatting,
  resolveParagraphLayoutInputs,
  cascadeRunProperties,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { paragraphShadingBox } from './ooxml-shading.ts';
import { readTableStructure, type SemanticTableRow } from './semantic-table.ts';
import {
  createTableBorderOwnershipBudget,
  createTableVMergeResolveBudget,
  finalizeTableRows,
  initialCellCursors,
  layoutRowFragment,
  layoutRowFragmentBounded,
  measureRowHeight,
  MAX_TABLE_ROW_FRAGMENTS,
  rowWithSplitBorders,
  TablePaginationError,
  type CellPlaceCursor,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { storyBlocks } from './story-roots.ts';
import { type HeaderFooterStoryLayout } from './hf-layout.ts';
import { enumerateDocumentSections, geometryOfSection } from './section-properties.ts';
import {
  DEFAULT_PAGE_GEOMETRY,
  type BlockFragmentRecord,
  type HeaderFooterStoryRecord,
  type LayoutBox,
  type LineRecord,
  type PageGeometry,
  type PageRecord,
  type ParagraphBorderStrokeRecord,
  type ParagraphBottomBorderRecord,
  type SemanticLayout,
  type TableRowFragmentRecord,
  type TextMeasurer,
} from './semantic-records.ts';
import type { NumberingIndex } from './numbering-index.ts';
import { firstLineShift, withResolvedListItems, type ResolvedListItem } from './list-resolve.ts';
import { publishListMarker } from './list-marker.ts';
import { sameFragments } from './semantic-fragment-signature.ts';
import { type FlowCheckpoint, type LayoutSession } from './layout-session.ts';
import { furnitureForSection, layoutMultiSectionDocument } from './multi-section-layout.ts';

export {
  createLayoutSession,
  type LayoutSession,
  type LayoutSessionStats,
} from './layout-session.ts';

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

export interface SemanticLayoutOptions {
  readonly geometry?: PageGeometry;
  readonly measurer: TextMeasurer;
  /**
   * Reuse of measured-and-broken paragraphs across revisions (task 9.2).
   *
   * Only the BREAK is cached. Placement — y, fragments, page cuts — is always redone, so
   * an edit high in the document still repaginates everything below it while paragraphs
   * nobody touched are never measured again.
   */
  readonly cache?: ParagraphLayoutCache<readonly PendingLine[]>;
  /**
   * Who produced the measurements, folded into every cache key.
   *
   * A font arriving after first paint changes every advance in the document while no
   * content changes; without this the cache would serve the pre-font layout forever.
   */
  readonly producer?: string;
  /**
   * Incremental placement across revisions (task 9.3).
   *
   * Holds the previous complete layout and a flow checkpoint per paragraph, so a pass can
   * resume just before the first affected paragraph instead of re-placing the document from
   * the top, and can stop early when the flow reconverges with the previous run.
   *
   * Multi-section documents keep per-section child sessions on {@link LayoutSession.multi}.
   */
  readonly session?: LayoutSession;
  /** Header/footer stories to attach per page; absent means no furniture. */
  readonly furniture?: PageFurniture;
  /**
   * Per-section furniture, index-aligned with `enumerateDocumentSections`.
   *
   * When present, multi-section layout attaches each section's own headers/footers (after
   * OOXML inheritance). `furniture` remains the single-section / last-section fallback.
   */
  readonly sectionFurniture?: readonly (PageFurniture | undefined)[];
  /**
   * Styles-part cascade table (docDefaults + `w:style` last-wins). Absent keeps direct
   * formatting only — the pre-cascade behaviour, used by unit tests that never open a
   * package.
   */
  readonly styleCascade?: StyleCascadeTable;
  /**
   * Projection of `/word/numbering.xml`. Absent keeps pre-list behaviour (no markers /
   * level indents). The index is immutable for a session; list counter state is derived
   * per layout pass from document order.
   */
  readonly numberingIndex?: NumberingIndex;
  /**
   * Optional precomputed list items for the body story. When absent and
   * {@link numberingIndex} is set, layout walks the full body (including table cells)
   * once so counters continue across section boundaries and table document order.
   */
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
  /**
   * `w:settings/w:defaultTabStop` in points (ECMA-376 §17.15.1.25); absent keeps the 0.5"
   * schema default.
   *
   * It arrives as an option because the paragraph cascade cannot see `settings.xml`. A
   * metric-locale template declares 1134 twips (2cm) and every default-interval tab in the
   * document belongs on that grid. Constant for a session — the settings part is immutable
   * here — which is why the prepared-block memo does not key on it.
   */
  readonly defaultTabStopPt?: number;
  /**
   * Turns a typed `w:hyperlink` into the SANITIZED record its spans carry.
   *
   * An option because resolving `r:id` needs the package's relationships, which layout — a
   * per-part walk — cannot see. Absent means link runs still measure, break and paint;
   * they simply carry no link, so nothing is clickable and no text is lost. That is the
   * degradation a headless test or a furniture-only pass gets, and it is the safe one.
   */
  readonly projectLink?: HyperlinkProjector;
}

/** Prepass results by block node, valid while the width and producer both hold. */
type PreparedBlock =
  | {
      readonly kind: 'paragraph';
      readonly paragraph: OoxmlElement;
      readonly props: OoxmlProperty[];
      readonly indent: { left: number; right: number; hanging: number; firstLine: number };
      readonly available: number;
      readonly alignment: Alignment;
      readonly spacing: ParagraphSpacing;
      readonly lineSpacing: ParagraphLineSpacing;
      readonly contextualSpacing: boolean;
      readonly styleId: string | null;
      readonly borders: ParagraphBorders;
      /**
       * Border identity + indent, for the `w:between` group rule.
       *
       * Indent participates because a group whose members sit at different indents would need
       * a stepped outline; splitting the group there gives each member its own closed box,
       * which is the near miss rather than a rule drawn through the text.
       */
      readonly borderGroupKey: string;
      readonly shading: string | undefined;
      readonly inheritedRunProperties: readonly OoxmlProperty[];
      readonly tabStops: ResolvedTabStops;
      /** `w:widowControl` / `w:keepNext` / `w:keepLines`, after the style cascade. */
      readonly keeps: ParagraphKeeps;
      readonly listItem?: ResolvedListItem;
      readonly key: string;
    }
  | { readonly kind: 'table'; readonly table: OoxmlElement; readonly key: string };

interface PreparedBlockMemo {
  readonly contentWidth: number;
  readonly producer: string;
  readonly entry: PreparedBlock;
}

const preparedBlocks = new WeakMap<OoxmlNode, PreparedBlockMemo>();

/**
 * Does any style — or `w:docDefaults` — in this cascade declare a `w:pBdr`?
 *
 * Cached per table because it decides whether resolving a paragraph's borders needs the full
 * cascade at all. For the overwhelming majority of documents no style carries one, and there
 * the direct `w:pPr` IS the answer; running `cascadeParagraphFormatting` a second time per
 * paragraph to learn that would make the prepass, not placement, the cost of a layout.
 */
const cascadeBorderDeclarations = new WeakMap<StyleCascadeTable, boolean>();

function styleCascadeDeclaresBorders(table: StyleCascadeTable): boolean {
  const cached = cascadeBorderDeclarations.get(table);
  if (cached !== undefined) return cached;
  const declaresPBdr = (props: readonly OoxmlProperty[]): boolean =>
    props.some((property) => property.localName === 'pBdr');
  let declares = declaresPBdr(table.docDefaultsParagraph);
  if (!declares) {
    for (const style of table.styles.values()) {
      if (declaresPBdr(style.paragraphProperties)) {
        declares = true;
        break;
      }
    }
  }
  cascadeBorderDeclarations.set(table, declares);
  return declares;
}

/**
 * Resolve `w:pBdr` for one paragraph, through the style cascade when a style could contribute.
 *
 * `resolveParagraphLayoutInputs` publishes the bottom edge only, so the full set is resolved
 * here from the same nodes it cascades — same last-`w:pBdr`-wins rule, all six edges.
 */
function resolveParagraphBorders(
  pPr: OoxmlNode | undefined,
  styleCascade: StyleCascadeTable | undefined
): ParagraphBorders {
  if (!styleCascade || !styleCascadeDeclaresBorders(styleCascade)) return paragraphBorders(pPr);
  return cascadedParagraphBorders(
    cascadeParagraphFormatting(styleCascade, pPr).paragraphPropertyNodes
  );
}

export function layoutSemanticDocument(
  part: OoxmlPart,
  revision: number,
  options: SemanticLayoutOptions
): SemanticLayout {
  const sections = enumerateDocumentSections(part);
  const blocks = storyBlocks(part);
  // Full-body list resolve so counters continue across sections and table cells.
  const optionsWithLists = withResolvedListItems(options, blocks);

  if (sections.length > 1) {
    return layoutMultiSectionDocument(
      blocks,
      sections,
      revision,
      optionsWithLists,
      layoutBlocksWithGeometry
    );
  }

  const section = sections[0];
  const geometry =
    options.geometry ?? (section ? geometryOfSection(section.properties) : DEFAULT_PAGE_GEOMETRY);
  const furniture =
    furnitureForSection(optionsWithLists, 0, sections.length) ?? optionsWithLists.furniture;
  const laid = layoutBlocksWithGeometry(blocks, revision, {
    ...optionsWithLists,
    geometry,
    furniture,
  });
  const finalized = finalizePageFieldProjection(laid.layout);
  // layoutBlocksWithGeometry stores the pre-projection layout on the session; replace it so
  // incremental reuse keeps projected PAGE/NUMPAGES furniture.
  if (options.session) {
    options.session.multi = null;
    options.session.previous = finalized;
  }
  return finalized;
}

interface BlockLayoutResult {
  readonly layout: SemanticLayout;
  readonly pages: readonly PageRecord[];
  readonly lineCounter: number;
  /** Used height of the LAST page's content column, for a section that continues onto it. */
  readonly endCursorY: number;
  /** Trailing paragraph spacing at the end of the flow, for adjacent-spacing collapse. */
  readonly endSpaceAfter: number;
  /**
   * Whether the last page is the one the flow was still filling.
   *
   * False when the flow closed a page and opened nothing after it — an explicit
   * `w:br w:type="page"` on the last paragraph. `endCursorY` is 0 in BOTH cases, so a
   * section that continues onto this one cannot tell "empty column at the top of a fresh
   * sheet" from "that sheet is full and the break already ended it" without this.
   */
  readonly endsOpenPage: boolean;
}

function layoutBlocksWithGeometry(
  bodies: readonly OoxmlElement[],
  revision: number,
  options: SemanticLayoutOptions & {
    readonly geometry: PageGeometry;
    readonly lineCounterStart?: number;
    readonly flowStartY?: number;
    readonly spaceBeforeCarry?: number;
    readonly pageIndexStart?: number;
  }
): BlockLayoutResult {
  const geometry = options.geometry;
  const measurer = options.measurer;
  const cache = options.cache;
  // Defaults to a constant deliberately NAMED for the risk: fonts resolve asynchronously, so
  // a caller that swaps the measurer without changing this is served the pre-font layout for
  // the rest of the session. The style-cascade token is folded in so a different styles part
  // cannot reuse breaks measured under another inheritance table.
  const styleCascade = options.styleCascade;
  const listItems = options.listItems;
  // The default-tab interval moves every default-interval tab, and the prepared-block memo
  // is keyed by producer — so it belongs here rather than only in the per-paragraph token.
  const defaultTabStopPt = options.defaultTabStopPt;
  const producer =
    (options.producer ?? 'unversioned-measurer') +
    (styleCascade ? `|sc:${styleCascade.cacheToken}` : '') +
    (listItems && listItems.size > 0 ? `|num:${listItems.size}` : '') +
    (defaultTabStopPt !== undefined ? `|dts:${defaultTabStopPt}` : '');

  const contentWidth = geometry.width - geometry.margin.left - geometry.margin.right;

  // PAGE FURNITURE. A header taller than the top-margin remainder pushes the content area
  // down (Word's behaviour), computed as the worst case over the variants in use so the
  // content column is one height for every page. Capped at 40% of the sheet per edge: a
  // hostile header of five hundred paragraphs must not shrink the content area to nothing,
  // because pagination into a zero-height column never terminates.
  const furniture = options.furniture;
  const headerDistance = geometry.headerDistance ?? 36;
  const footerDistance = geometry.footerDistance ?? 36;
  const maxFlow = (stories: ReadonlyMap<string, HeaderFooterStoryLayout> | undefined): number => {
    let max = 0;
    for (const story of stories?.values() ?? []) max = Math.max(max, story.flowHeight);
    return max;
  };
  const furnitureCap = geometry.height * 0.4;
  const effectiveTop = Math.min(
    furnitureCap,
    Math.max(geometry.margin.top, furniture ? headerDistance + maxFlow(furniture.headers) : 0)
  );
  const effectiveBottom = Math.min(
    furnitureCap,
    Math.max(geometry.margin.bottom, furniture ? footerDistance + maxFlow(furniture.footers) : 0)
  );
  const contentHeight = geometry.height - effectiveTop - effectiveBottom;

  const session = options.session;
  const lineCounterStart = options.lineCounterStart ?? 0;
  const furnitureContext = furniture
    ? `|hf:${headerDistance},${footerDistance},${furniture.titlePage ? 1 : 0}${furniture.evenAndOddHeaders ? 1 : 0};` +
      [...furniture.headers]
        .map(([variant, story]) => `h${variant}=${story.flowHeight}@${story.contentKey}`)
        .sort()
        .join(',') +
      ';' +
      [...furniture.footers]
        .map(([variant, story]) => `f${variant}=${story.flowHeight}@${story.contentKey}`)
        .sort()
        .join(',')
    : '';
  // lineCounterStart participates: multi-section threads a global counter across sections, and
  // a shift from an earlier section's line count must invalidate this section's checkpoints.
  const flowStartY = options.flowStartY ?? 0;
  const spaceBeforeCarry = options.spaceBeforeCarry ?? 0;
  // Where this section's first sheet lands in the DOCUMENT. Even/odd header selection
  // alternates by page number, so it is not a section-local question.
  const pageIndexStart = options.pageIndexStart ?? 0;
  const context = `${producer}|${geometry.width}x${geometry.height}|${geometry.margin.top},${geometry.margin.right},${geometry.margin.bottom},${geometry.margin.left}|lc:${lineCounterStart}|fs:${flowStartY},${spaceBeforeCarry}|pi:${pageIndexStart}${furnitureContext}`;

  // Prepass: everything needed to KEY a paragraph, before any of them is placed. Resuming
  // means knowing where the first change is, and that cannot be discovered while walking.
  //
  // Memoized on NODE IDENTITY: a paragraph the commit did not touch is the same object, and
  // its properties, indents and key derive from nothing but the node, the available width
  // and the producer. Recomputing the key — a serialization of the paragraph's subtree —
  // for every paragraph on every pass made the prepass, not placement, the cost of an
  // incremental layout: a one-character edit re-keyed the entire document.
  const prepared = bodies.map((block): PreparedBlock => {
    const memo = preparedBlocks.get(block);
    if (memo && memo.contentWidth === contentWidth && memo.producer === producer) {
      return memo.entry;
    }
    let entry: PreparedBlock;
    if (block.kind === 'table') {
      // `nodeToken` hashes the whole subtree, so one key covers every cell edit.
      entry = {
        kind: 'table',
        table: block,
        key: paragraphLayoutKey({
          paragraph: block,
          properties: [],
          width: contentWidth,
          producer,
        }),
      };
    } else {
      const listItem = listItems?.get(block.id);
      const preparedParagraph = resolveParagraphLayoutInputs(
        block,
        contentWidth,
        styleCascade,
        listItem
      );
      const {
        props,
        indent,
        available,
        alignment,
        spacing,
        lineSpacing,
        contextualSpacing,
        styleId,
        shading,
        inheritedRunProperties,
      } = preparedParagraph;
      const borders = resolveParagraphBorders(
        block.children.find((child) => child.kind === 'paragraphProperties'),
        styleCascade
      );
      const bordersToken = paragraphBordersFingerprint(borders);
      // `w:defaultTabStop` lives in settings.xml, which the paragraph cascade never reads.
      const tabStops = withDefaultTabInterval(preparedParagraph.tabStops, defaultTabStopPt);
      const tabStopsCacheToken =
        tabStops === preparedParagraph.tabStops
          ? preparedParagraph.tabStopsCacheToken
          : tabStopsFingerprint(tabStops);
      entry = {
        kind: 'paragraph',
        paragraph: block,
        props,
        indent,
        available,
        alignment,
        spacing,
        lineSpacing,
        contextualSpacing,
        styleId,
        borders,
        borderGroupKey:
          bordersToken === '' ? '' : `${bordersToken}@${indent.left},${indent.left + available}`,
        shading,
        inheritedRunProperties,
        tabStops,
        keeps: paragraphKeeps(props),
        ...(listItem ? { listItem } : {}),
        key: paragraphLayoutKey({
          paragraph: block,
          properties: [
            ...props,
            ...inheritedRunProperties,
            { localName: 'tabStops', attributes: { token: tabStopsCacheToken } },
            ...(listItem
              ? [{ localName: 'list', attributes: { token: listItem.cacheToken } }]
              : []),
          ],
          width: available,
          producer,
        }),
      };
    }
    preparedBlocks.set(block, { contentWidth, producer, entry });
    return entry;
  });

  const keys = prepared.map((entry) => entry.key);
  const keepsNext = prepared.map((entry) => entry.kind === 'paragraph' && entry.keeps.keepNext);
  // FLOW keys — what incremental resume compares. `keys` stays what the break cache is
  // stored under; only `w:keepNext` makes the two differ (§17.3.1.15).
  const flowKeys = keepNextFlowKeys(keys, (index) => keepsNext[index]!);
  const previous = session?.previous ?? null;
  // A geometry or producer change invalidates every checkpoint, because it moves every
  // break; resuming from one would place new content against a stale flow.
  const resumable = previous !== null && session !== undefined && session.context === context;

  /** The first paragraph whose layout inputs differ from the previous pass. */
  let firstChanged = 0;
  if (resumable) {
    const limit = Math.min(flowKeys.length, session.keys.length);
    while (firstChanged < limit && flowKeys[firstChanged] === session.keys[firstChanged]) {
      firstChanged += 1;
    }
  }

  /**
   * How many trailing paragraphs are unchanged.
   *
   * Where the flow may reconverge: everything after an edit can only be reused verbatim if
   * it is the same content AND lands in the same place, and this bounds the first half of
   * that question.
   */
  let commonSuffix = 0;
  if (resumable) {
    const maxSuffix = Math.min(flowKeys.length, session.keys.length) - firstChanged;
    while (
      commonSuffix < maxSuffix &&
      flowKeys[flowKeys.length - 1 - commonSuffix] ===
        session.keys[session.keys.length - 1 - commonSuffix]
    ) {
      commonSuffix += 1;
    }
  }

  // NOTHING CHANGED. Every key matches and the document is the same length, so the previous
  // layout still describes it exactly — re-placing it would allocate a second set of
  // identical records and destroy the identity a consumer uses to skip repainting.
  if (resumable && firstChanged === prepared.length && prepared.length === session.keys.length) {
    const unchanged: SemanticLayout = { revision, pages: previous!.pages };
    session.previous = unchanged;
    session.stats = {
      placed: 0,
      total: prepared.length,
      reusedPages: previous!.pages.length,
      fullPasses: session.stats.fullPasses,
    };
    cache?.retain(new Set(keys));
    return {
      layout: unchanged,
      pages: unchanged.pages,
      lineCounter: session.endLineCounter,
      endCursorY: session.endCursorY,
      endSpaceAfter: session.endSpaceAfter,
      endsOpenPage: session.endsOpenPage,
    };
  }

  const pages: PageRecord[] = [];
  let pageFragments: BlockFragmentRecord[] = [];
  // A continuous section resumes the previous section's column rather than opening a
  // sheet, so its first block starts at that column's used height and its first paragraph
  // is NOT at a page top — page-top space-before suppression must not apply to it, and the
  // preceding paragraph's space-after still collapses against its space-before.
  let cursorY = flowStartY;
  let lineCounter = lineCounterStart;
  let previousSpaceAfter = spaceBeforeCarry;
  const checkpoints: FlowCheckpoint[] = [];
  let startIndex = 0;
  let placed = 0;
  let reusedPages = 0;
  let firstParagraphOfSection = flowStartY === 0;

  // RESUME. The checkpoint before the first changed paragraph describes a flow the new
  // document still agrees with, so the pages completed by then are carried over by
  // REFERENCE — unchanged pages keep their identity, which is what lets a consumer skip
  // repainting them (task 9.4).
  if (resumable && firstChanged > 0 && firstChanged < session.checkpoints.length) {
    const checkpoint = session.checkpoints[firstChanged]!;
    pages.push(...previous!.pages.slice(0, checkpoint.pageCount));
    pageFragments = [...checkpoint.pageFragments];
    cursorY = checkpoint.cursorY;
    lineCounter = checkpoint.lineCounter;
    previousSpaceAfter = checkpoint.previousSpaceAfter;
    startIndex = firstChanged;
    firstParagraphOfSection = false;
    reusedPages = pages.length;
    checkpoints.push(...session.checkpoints.slice(0, firstChanged));
  }

  const pageBox = (index: number): LayoutBox => ({
    x: 0,
    y: index * (geometry.height + 24), // 24pt gutter between sheets, for the scroll surface
    width: geometry.width,
    height: geometry.height,
  });

  /**
   * The variant page `index` shows: title page first, then even/odd when declared.
   *
   * `w:titlePg` (17.6.55) is a property of the SECTION, so its first page is the section's
   * own first — the local index. `w:evenAndOddHeaders` (17.10.1) lives in settings.xml and
   * alternates by the page's number in the DOCUMENT, so it reads through `pageIndexStart`:
   * a section that begins on an even page must open with the even header, and `remapPage`
   * renumbers a page without ever re-picking its variant.
   */
  const variantFor = (index: number): HeaderFooterVariantName =>
    furniture?.titlePage && index === 0
      ? 'first'
      : furniture?.evenAndOddHeaders && (pageIndexStart + index + 1) % 2 === 0
        ? 'even'
        : 'default';

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
        box: {
          x: box.x + geometry.margin.left,
          y,
          width: contentWidth,
          height: laid.flowHeight,
        },
        fragments: laid.fragments,
      };
    };
    const placed = place(story);
    const needs = story.pageFieldNeeds;
    // Only stories with allowlisted PAGE/NUMPAGES need finalize-time re-layout. Field-free
    // furniture keeps the baseline fragments on every sheet (no per-page projector).
    if (!needs.hasPage && !needs.hasNumPages) return placed;
    return {
      ...placed,
      pageFieldProjector: (context) => place(story.withPageContext(context)),
    };
  };

  const flushPage = (): void => {
    const index = pages.length;
    const box = pageBox(index);
    const header = furnitureFor('header', index, box);
    const footer = furnitureFor('footer', index, box);
    pages.push({
      id: `page-${index}`,
      index,
      box,
      contentBox: {
        x: box.x + geometry.margin.left,
        y: box.y + effectiveTop,
        width: contentWidth,
        height: contentHeight,
      },
      fragments: pageFragments,
      ...(header ? { header } : {}),
      ...(footer ? { footer } : {}),
    });
    pageFragments = [];
    cursorY = 0;
  };

  // Table layout shares the flow's line counter, paragraph cache, and precomputed list
  // items (counters already advanced in document order, including cell paragraphs).
  // Border ownership intervals and vMerge cell visits are budgeted once per pass so nested
  // finalize cannot amplify past the shared ceilings.
  const tableDeps: TableFlowDeps = {
    measurer,
    cache,
    producer,
    nextLineId: () => `line-${lineCounter++}`,
    styleCascade,
    listItems,
    ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
    ...(options.projectLink ? { projectLink: options.projectLink } : {}),
    borderOwnershipBudget: createTableBorderOwnershipBudget(),
    vMergeResolveBudget: createTableVMergeResolveBudget(),
  };

  type PreparedParagraph = Extract<PreparedBlock, { kind: 'paragraph' }>;

  // Current-pass list map first, so marker ordinals stay fresh when the memo reuses inputs.
  const firstLineOffsetOf = (entry: PreparedParagraph): number =>
    firstLineShift(
      listItems?.get(entry.paragraph.id) ?? entry.listItem,
      entry.indent,
      measurer,
      entry.tabStops,
      entry.available
    );

  // Shared by placement and by the `w:keepNext` lookahead, which needs the height of the
  // blocks it keeps WITH. Both read the same cache entry, so the lookahead re-measures nothing.
  const breakBlock = (entry: PreparedParagraph) =>
    breakParagraph(
      entry.paragraph,
      entry.paragraph.id,
      entry.indent.left,
      entry.available,
      measurer,
      cache,
      cache ? entry.key : null,
      entry.inheritedRunProperties,
      entry.tabStops,
      undefined,
      styleCascade
        ? (inherited, direct) => cascadeRunProperties(inherited, direct, styleCascade)
        : undefined,
      {
        lineSpacing: entry.lineSpacing,
        firstLineOffset: firstLineOffsetOf(entry),
        // The page's text column, so a `w:ptab` measuring against the margin ignores the
        // paragraph's own indents the way Word does.
        marginExtent: { left: 0, right: entry.indent.left + entry.available + entry.indent.right },
        ...(options.projectLink ? { projectLink: options.projectLink } : {}),
      }
    );

  /**
   * Lay out one top-level table with OOXML-aligned row pagination.
   *
   * Preflights the real unsplit row height (not a one-line estimate). A row that fits on a
   * fresh page but not the current remainder moves whole. A row taller than a fresh page
   * fragments at paragraph/line boundaries when splittable; `w:cantSplit` and unsafe nested
   * cuts fail closed via {@link TablePaginationError} instead of overflowing contentHeight.
   * Contiguous leading `w:tblHeader` rows form one atomic repeated group: preflighted and
   * placed together, moved whole when the remainder is too short, re-emitted complete atop
   * each continuation page, and rejected when the group itself exceeds a fresh content page.
   */
  const layoutTableInFlow = (table: OoxmlElement): void => {
    const structure = readTableStructure(table, contentWidth, 0, styleCascade);
    if (!structure || structure.rows.length === 0) return;
    const headerRows: SemanticTableRow[] = [];
    for (const row of structure.rows) {
      if (row.isHeader) headerRows.push(row);
      else break;
    }
    let fragmentIndex = 0;
    let fragmentTop = cursorY;
    let rows: TableRowFragmentRecord[] = [];
    // Authored rows backing the open fragment (includes header repeats) for finalize.
    let sourceRows: (typeof structure.rows)[number][] = [];
    const closeTableFragment = (): void => {
      if (rows.length === 0) return;
      const finalized = finalizeTableRows(
        rows,
        structure,
        sourceRows,
        tableDeps.borderOwnershipBudget,
        tableDeps.vMergeResolveBudget
      );
      const last = finalized[finalized.length - 1]!;
      pageFragments.push({
        kind: 'table',
        id: `${table.id}#f${fragmentIndex}`,
        tableId: table.id,
        fragmentIndex,
        rows: finalized,
        box: {
          x: 0,
          y: fragmentTop,
          width: contentWidth,
          height: last.box.y + last.box.height - fragmentTop,
        },
      });
      fragmentIndex += 1;
      rows = [];
      sourceRows = [];
    };

    /**
     * Place the contiguous leading header rows as one group. Never splits the group across
     * pages; fails closed when the group itself is taller than a fresh content page.
     */
    const placeHeaderGroup = (asRepeat: boolean): void => {
      if (headerRows.length === 0) return;

      let groupHeight = 0;
      for (const headerRow of headerRows) {
        groupHeight += measureRowHeight(headerRow, structure.columnWidthsPt, 0, 0, tableDeps);
      }
      if (groupHeight > contentHeight + 0.001) {
        throw new TablePaginationError(
          'table-row-overheight',
          `Table header group (${headerRows.length} row(s)) is taller than the page content box`
        );
      }
      if (cursorY + groupHeight > contentHeight + 0.001 && cursorY > 0) {
        closeTableFragment();
        flushPage();
        fragmentTop = 0;
      }

      for (const headerRow of headerRows) {
        const placed = layoutRowFragment(
          headerRow,
          structure.columnWidthsPt,
          0,
          cursorY,
          asRepeat,
          0,
          tableDeps
        );
        if (placed.bottom > contentHeight + 0.001) {
          throw new TablePaginationError(
            'table-row-overheight',
            `Table header row ${headerRow.id} overflowed the page content box`
          );
        }
        rows.push(placed.record);
        sourceRows.push(headerRow);
        cursorY = placed.bottom;
      }
    };

    const breakForContinuation = (emitHeaders: boolean): void => {
      closeTableFragment();
      flushPage();
      fragmentTop = 0;
      if (emitHeaders) placeHeaderGroup(true);
    };

    // Initial authored header group (not repeats) — atomic with body-row pagination below.
    placeHeaderGroup(false);

    for (const row of structure.rows.slice(headerRows.length)) {
      const naturalHeight = measureRowHeight(row, structure.columnWidthsPt, 0, 0, tableDeps);
      let cursors: CellPlaceCursor[] = initialCellCursors(row);
      let isContinuation = false;
      let fragmentsForRow = 0;
      let movedToFreshPage = false;

      // Whole-row move: fits a fresh page but not the remaining band.
      if (
        naturalHeight <= contentHeight + 0.001 &&
        cursorY + naturalHeight > contentHeight + 0.001 &&
        cursorY > 0
      ) {
        breakForContinuation(true);
        movedToFreshPage = true;
      }

      for (;;) {
        fragmentsForRow += 1;
        if (fragmentsForRow > MAX_TABLE_ROW_FRAGMENTS) {
          throw new TablePaginationError(
            'table-row-fragment-limit',
            `Table row ${row.id} exceeded ${MAX_TABLE_ROW_FRAGMENTS} page fragments`
          );
        }

        const remaining = contentHeight - cursorY;
        if (remaining <= 0.001 && cursorY > 0) {
          if (movedToFreshPage) {
            throw new TablePaginationError(
              'table-row-overheight',
              `Table row ${row.id} cannot fit after repeated header rows`
            );
          }
          breakForContinuation(true);
          movedToFreshPage = true;
          continue;
        }

        // Prefer an unsplit placement when the natural height fits the remaining band.
        if (!isContinuation && naturalHeight <= remaining + 0.001) {
          const placed = layoutRowFragment(
            row,
            structure.columnWidthsPt,
            0,
            cursorY,
            false,
            0,
            tableDeps
          );
          if (placed.bottom > contentHeight + 0.001) {
            throw new TablePaginationError(
              'table-row-overheight',
              `Table row ${row.id} overflowed the page content box after placement`
            );
          }
          rows.push(placed.record);
          sourceRows.push(row);
          cursorY = placed.bottom;
          break;
        }

        // Does not fit the remaining band.
        if (row.cantSplit) {
          if (cursorY > 0 && !movedToFreshPage) {
            breakForContinuation(true);
            movedToFreshPage = true;
            continue;
          }
          throw new TablePaginationError(
            'table-row-overheight',
            `Table row ${row.id} has w:cantSplit and is taller than the available page content`
          );
        }

        const placed = layoutRowFragmentBounded(
          row,
          structure.columnWidthsPt,
          0,
          cursorY,
          contentHeight,
          false,
          isContinuation,
          0,
          tableDeps,
          cursors
        );

        // First attempt on a non-empty page placed nothing useful → move to next page.
        if (!placed.fitted && cursorY > 0 && !movedToFreshPage) {
          breakForContinuation(true);
          movedToFreshPage = true;
          continue;
        }

        if (!placed.fitted) {
          throw new TablePaginationError(
            placed.nestedSplitBlocked ? 'table-row-split-unsupported' : 'table-row-overheight',
            placed.nestedSplitBlocked
              ? `Table row ${row.id} contains a nested table taller than the page content box`
              : `Table row ${row.id} has content that cannot fit a page content box`
          );
        }

        if (placed.bottom > contentHeight + 0.001) {
          throw new TablePaginationError(
            'table-row-overheight',
            `Table row ${row.id} overflowed the page content box`
          );
        }

        const hasMore = placed.remainder !== null;
        const source = rowWithSplitBorders(row, isContinuation, hasMore);
        rows.push(placed.record);
        sourceRows.push(source);
        cursorY = placed.bottom;

        if (!hasMore) break;

        cursors = placed.remainder!;
        isContinuation = true;
        movedToFreshPage = false;
        breakForContinuation(true);
      }
    }
    closeTableFragment();
  };

  let converged = false;
  let convergedAt = prepared.length;
  for (let index = startIndex; index < prepared.length; index += 1) {
    const entry = prepared[index]!;

    // The flow as it stands BEFORE this block: what a later pass resumes from.
    checkpoints[index] = {
      pageCount: pages.length,
      pageFragments: [...pageFragments],
      cursorY,
      lineCounter,
      previousSpaceAfter,
    };

    // CONVERGENCE. Once inside the unchanged tail, if the flow returns to exactly the state
    // the previous pass was in at this same paragraph, everything after lays out identically
    // and the rest of the previous layout is appended verbatim.
    //
    // Tested at EVERY paragraph of the unchanged tail, not just its first: an edit puts the
    // flow out of step for the rest of the page it lands on, and the state only comes back
    // into line once the page it disturbed has been completed.
    //
    // The fragments still pending must MATCH, because the first reused page contains them —
    // structurally, since a paragraph re-placed by this pass is a new object even when it
    // lands exactly where it did before.
    //
    // Exact means exact: one page fewer, one point of cursor, or one line id out of step and
    // every id downstream would differ from a clean pass.
    if (resumable && commonSuffix > 0 && index >= prepared.length - commonSuffix) {
      const mark = session.checkpoints[index + (session.keys.length - prepared.length)];
      if (
        mark &&
        mark.cursorY === cursorY &&
        mark.lineCounter === lineCounter &&
        mark.previousSpaceAfter === previousSpaceAfter &&
        mark.pageCount === pages.length &&
        sameFragments(mark.pageFragments, pageFragments)
      ) {
        const tail = previous!.pages.slice(mark.pageCount);
        pages.push(...tail);
        reusedPages += tail.length;
        converged = true;
        convergedAt = index;
        // Tail line ids come from the previous pass; report the terminal counter so a
        // multi-section orchestrator can thread the global line sequence correctly.
        lineCounter = session.endLineCounter;
        break;
      }
    }

    placed += 1;

    if (entry.kind === 'table') {
      previousSpaceAfter = 0;
      layoutTableInFlow(entry.table);
      continue;
    }

    const {
      paragraph,
      props,
      indent,
      alignment,
      available,
      spacing: authoredSpacing,
      contextualSpacing,
      styleId,
      borders,
      shading,
      inheritedRunProperties,
      keeps,
    } = entry;
    // `w:contextualSpacing` (17.3.1.9) drops the gap between paragraphs of the SAME style.
    // Word's own ListParagraph sets it, so without this every Word-authored list carries a
    // paragraph gap between its items.
    const previousEntry = index > 0 ? prepared[index - 1] : undefined;
    const nextEntry = prepared[index + 1];
    const sameStyleAs = (other: PreparedBlock | undefined): boolean =>
      other?.kind === 'paragraph' && other.styleId === styleId && styleId !== null;
    const spacing: ParagraphSpacing = contextualSpacing
      ? {
          before: sameStyleAs(previousEntry) ? 0 : authoredSpacing.before,
          after: sameStyleAs(nextEntry) ? 0 : authoredSpacing.after,
        }
      : authoredSpacing;
    const listItem = listItems?.get(paragraph.id) ?? entry.listItem;
    // `w:firstLine` moves the first line right of the indent, `w:hanging` moves it left.
    // The schema treats them as mutually exclusive; where a producer writes both, hanging
    // wins, which is how Word reads it.
    // A NUMBERED/BULLETED paragraph's first-line slot belongs to the MARKER: `listMarkerBox`
    // places it at `left - hanging`, and Word's `w:suff` puts the text back at `left` — or
    // after the marker, or at the next tab stop past an overflowing one (§17.9.30).
    const firstLineOffset = firstLineOffsetOf(entry);
    const paragraphId = paragraph.id;
    // `w:between` (§17.3.1.24): consecutive paragraphs with IDENTICAL border settings are ONE
    // bordered block in Word — the box opens above the first and closes below the last, and
    // each interior boundary carries `w:between` or nothing. Applying a box to three selected
    // paragraphs in Word draws one box, not three, and this is why.
    const borderGroupKey = entry.borderGroupKey;
    const inSameBorderGroup = (other: PreparedBlock | undefined): boolean =>
      borderGroupKey !== '' &&
      other?.kind === 'paragraph' &&
      other.borderGroupKey === borderGroupKey;
    const continuesAbove = inSameBorderGroup(previousEntry);
    const continuesBelow = inSameBorderGroup(nextEntry);
    const topEdge = continuesAbove ? undefined : borders.top;
    // What closes the paragraph: the bottom rule, or the `between` rule when the block runs on.
    const closingEdge = continuesBelow ? borders.between : borders.bottom;
    const topExtent = paragraphBorderExtentPt(topEdge);
    const borderExtent = paragraphBorderExtentPt(closingEdge);

    if (paragraphBreaksBefore(props) && (pageFragments.length > 0 || pages.length === 0)) {
      flushPage();
      previousSpaceAfter = 0;
    }

    const lines = breakBlock(entry);

    // Fit uses unsuppressed lead; top-of-page suppression applies after any flush below.
    {
      const lead = collapsedSpaceBefore(spacing.before, previousSpaceAfter);
      const emptyStyle =
        inheritedRunProperties.length === 0
          ? DEFAULT_RUN_STYLE
          : resolveRunStyle(inheritedRunProperties);
      const firstHeight = lines[0]?.height ?? measurer.lineMetrics(emptyStyle).height;
      const firstTail = lines.length <= 1 ? borderExtent + spacing.after : 0;
      let needed = lead + topExtent + firstHeight + firstTail;
      // `w:keepNext` (§17.3.1.15): this paragraph may not be the last thing on its page. Priced
      // ONCE per chain, at its head — a member whose predecessor keeps too already moved with
      // the group. A chain that cannot fit a page of its own is abandoned.
      if (keeps.keepNext && !keepsNext[index - 1]) {
        const group = keepNextGroupHeight(prepared, index, previousSpaceAfter, (at) => {
          const member = prepared[at];
          return member?.kind === 'paragraph' ? breakBlock(member).map((l) => l.height) : [];
        });
        if (group !== null && group + topExtent <= contentHeight) {
          needed = Math.max(needed, group + topExtent);
        }
      }
      if (cursorY + needed > contentHeight && cursorY > 0) {
        flushPage();
        previousSpaceAfter = 0;
      }
    }

    const atTopOfPage = cursorY === 0 && pageFragments.length === 0;
    const appliedBefore = appliedSpaceBefore(
      spacing.before,
      previousSpaceAfter,
      atTopOfPage,
      firstParagraphOfSection
    );
    if (appliedBefore > 0) cursorY += appliedBefore;
    // The top rule and its gap are flow height above the first line, exactly as the bottom
    // rule is flow height below the last — pagination has to see both or a boxed paragraph
    // overhangs the bottom margin by the height of its own frame.
    if (topExtent > 0) cursorY += topExtent;
    firstParagraphOfSection = false;

    // Place the lines, fragmenting at page boundaries.
    let fragmentIndex = 0;
    let pending: LineRecord[] = [];
    let fragmentStart = lines[0]?.start ?? 0;
    let fragmentBefore = appliedBefore;
    // Reserved above the FIRST fragment only: a paragraph continued onto the next page opens
    // once, the same way it closes once.
    let fragmentTopExtent = topExtent;
    let endedWithPageBreak = false;
    previousSpaceAfter = 0;

    const flushFragment = (isLast: boolean): void => {
      if (pending.length === 0) return;
      const linesTop = pending[0]!.box.y;
      const top = linesTop - fragmentBefore - fragmentTopExtent;
      const linesBottom =
        pending[pending.length - 1]!.box.y + pending[pending.length - 1]!.box.height;
      const appliedAfter = isLast ? spacing.after : 0;
      const strokes: ParagraphBorderStrokeRecord[] = [];
      let bottomBorderRecord: ParagraphBottomBorderRecord | undefined;
      let contentTop = linesTop;
      let contentBottom = linesBottom;
      // THE FOUR EDGES ARE ONE BOX. The side rules sit outside the text column by their own
      // `w:space`, so a top rule drawn only across the column stops short of them and the
      // frame reads as two horizontal rules with two detached vertical bars beside it —
      // which is what a callout looked like. Word closes the rectangle, so the horizontal
      // rules span from the left rule's outer edge to the right rule's.
      const boxLeft = borders.left
        ? indent.left - borders.left.spacePt - borders.left.widthPt
        : indent.left;
      const boxRight = borders.right
        ? indent.left + available + borders.right.spacePt + borders.right.widthPt
        : indent.left + available;
      const boxWidth = Math.max(boxRight - boxLeft, 0);
      if (fragmentTopExtent > 0 && topEdge) {
        const ruleY = linesTop - topEdge.spacePt - topEdge.widthPt;
        strokes.push({
          side: 'top',
          edge: topEdge,
          box: { x: boxLeft, y: ruleY, width: boxWidth, height: topEdge.widthPt },
        });
        contentTop = ruleY;
      }
      if (isLast && closingEdge) {
        const ruleY = linesBottom + closingEdge.spacePt;
        const box = {
          x: boxLeft,
          y: ruleY,
          width: boxWidth,
          height: closingEdge.widthPt,
        };
        strokes.push({ side: continuesBelow ? 'between' : 'bottom', edge: closingEdge, box });
        // `bottomBorder` stays the BOTTOM rule alone: a `between` rule closing a grouped
        // paragraph is a different edge, and a consumer reading it as the box's bottom would
        // draw the block's frame at every interior boundary.
        if (!continuesBelow) bottomBorderRecord = { edge: closingEdge, box };
        contentBottom = ruleY + closingEdge.widthPt;
      }
      if (isLast) cursorY = Math.max(cursorY, contentBottom + appliedAfter);
      const height = Math.max(contentBottom + appliedAfter - top, 0);
      // Side rules run the height of the bordered block, and inside a group they run THROUGH
      // the inter-paragraph gap so the box reads as one outline rather than a ladder.
      const sideTop = continuesAbove && fragmentIndex === 0 ? top : contentTop;
      const sideBottom = continuesBelow && isLast ? top + height : contentBottom;
      const sideHeight = Math.max(sideBottom - sideTop, 0);
      if (borders.left) {
        strokes.push({
          side: 'left',
          edge: borders.left,
          box: {
            x: indent.left - borders.left.spacePt - borders.left.widthPt,
            y: sideTop,
            width: borders.left.widthPt,
            height: sideHeight,
          },
        });
      }
      if (borders.right) {
        strokes.push({
          side: 'right',
          edge: borders.right,
          box: {
            x: indent.left + available + borders.right.spacePt,
            y: sideTop,
            width: borders.right.widthPt,
            height: sideHeight,
          },
        });
      }
      // `w:bar` is the change-bar rule beside the paragraph. It belongs to the paragraph, not
      // to the block, so it neither opens nor closes with the group.
      if (borders.bar) {
        strokes.push({
          side: 'bar',
          edge: borders.bar,
          box: {
            x: indent.left - borders.bar.spacePt - borders.bar.widthPt,
            y: linesTop,
            width: borders.bar.widthPt,
            height: Math.max(linesBottom - linesTop, 0),
          },
        });
      }
      const marker =
        fragmentIndex === 0
          ? publishListMarker(
              listItem,
              measurer,
              pending[0] ? { y: pending[0].box.y, height: pending[0].box.height } : undefined
            )
          : undefined;
      pageFragments.push({
        kind: 'paragraph',
        id: `${paragraphId}#f${fragmentIndex}`,
        paragraphId,
        fragmentIndex,
        range: {
          paragraphId,
          start: fragmentStart,
          end: pending[pending.length - 1]!.range.end,
        },
        props,
        spacing: { before: fragmentBefore, after: appliedAfter },
        ...(bottomBorderRecord ? { bottomBorder: bottomBorderRecord } : {}),
        ...(strokes.length > 0 ? { borders: strokes } : {}),
        ...(shading === undefined
          ? {}
          : {
              shading,
              // A BORDERED paragraph is shaded across the whole frame, not just the text
              // band: Word fills the box its borders draw, `w:space` padding included, so a
              // fill that stopped at the line area left a pale stripe floating inside an
              // empty rectangle. Unbordered shading keeps the line area, which is what Word
              // fills there. Borders paint after this, so the frame is never covered.
              // Gated on a real FRAME — a side rule is what makes the fill a box. A heading
              // with only `w:bottom` is the common single-edge case, and widening its fill
              // down to the rule would be a silent change in the opposite direction.
              shadingBox:
                borders.left || borders.right
                  ? {
                      x: boxLeft,
                      y: contentTop,
                      width: boxWidth,
                      height: Math.max(contentBottom - contentTop, 0),
                    }
                  : paragraphShadingBox(pending, indent.left, available)!,
            }),
        ...(marker ? { marker } : {}),
        lines: pending,
        box: { x: indent.left, y: top, width: available, height },
      });
      fragmentIndex += 1;
      fragmentStart = pending[pending.length - 1]!.range.end;
      pending = [];
      fragmentBefore = 0;
      fragmentTopExtent = 0;
    };

    // First line of this paragraph on the CURRENT page: the anchor a keep rule retreats to.
    // Not always 0 — a paragraph already cut by a page boundary keeps what it kept. Each
    // retreat moves a line onto a later page, so the walk terminates; `maxRetreats` guards a
    // future rule that could cycle, and fails OPEN at the natural break rather than throwing.
    let fragmentFirstLine = 0;
    let retreats = 0;
    const maxRetreats = lines.length + MAX_KEEP_NEXT_CHAIN;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const pendingLine = lines[lineIndex]!;
      const isLastLine = lineIndex === lines.length - 1;
      const tail = isLastLine ? borderExtent + spacing.after : 0;
      if (
        cursorY + pendingLine.height + tail > contentHeight &&
        (pending.length > 0 || pageFragments.length > 0 || pages.length > 0)
      ) {
        // `w:widowControl` (§17.3.1.44) / `w:keepLines` (§17.3.1.16) change where a paragraph
        // may be CUT, not where it fits: retreat off a stranded line, or off keepLines whole.
        const alone = pageFragments.length === 0;
        const breakAt =
          retreats < maxRetreats
            ? adjustedBreakIndex(lineIndex, fragmentFirstLine, lines.length, keeps, alone)
            : lineIndex;
        const retreated = breakAt < lineIndex;
        // Un-placing hands line ids BACK: a line re-placed on the next page must carry the id
        // it already took, or every id below it is out of step with a clean pass.
        for (let back = lineIndex; back > breakAt; back -= 1) {
          const removed = pending.pop()!;
          cursorY -= removed.box.height;
          lineCounter -= 1;
        }
        // Moving WHOLE means it now OPENS a page: space-before drops, the top rule travels.
        const movesWhole = retreated && pending.length === 0 && fragmentIndex === 0;
        flushFragment(false);
        flushPage();
        fragmentBefore = 0;
        if (movesWhole) cursorY = fragmentTopExtent;
        else fragmentTopExtent = 0;
        fragmentFirstLine = breakAt;
        if (retreated) {
          retreats += 1;
          lineIndex = breakAt - 1;
          continue;
        }
      }
      const record: LineRecord = {
        id: `line-${lineCounter}`,
        range: { paragraphId, start: pendingLine.start, end: pendingLine.end },
        spans: alignSpans(
          // The paragraph id is rewritten at PLACEMENT, exactly as `box.y` is. A cached
          // break is keyed by content, so two paragraphs holding the same text share one
          // entry — and the spans in it carry whichever paragraph happened to produce them.
          // Two identical list items were enough to make the second one's spans claim the
          // first one's id.
          pendingLine.spans.map((span) => ({
            ...span,
            range: { ...span.range, paragraphId },
            box: { ...span.box, y: cursorY },
          })),
          measurer,
          // Alignment measures against the box the LINE actually got: a first line carrying
          // `w:firstLine`/`w:hanging` starts elsewhere and has a different width, so centring
          // or justifying it against the paragraph box would push it off its own margins.
          indent.left + (lineIndex === 0 ? firstLineOffset : 0),
          Math.max(1, available - (lineIndex === 0 ? firstLineOffset : 0)),
          alignment,
          isLastLine
        ),
        box: { x: indent.left, y: cursorY, width: available, height: pendingLine.height },
        baseline: pendingLine.baseline,
        leading: pendingLine.leading,
      };
      lineCounter += 1;
      pending.push(record);
      cursorY += pendingLine.height;
      if (pendingLine.pageBreakAfter) {
        flushFragment(isLastLine);
        flushPage();
        fragmentBefore = 0;
        fragmentTopExtent = 0;
        endedWithPageBreak = true;
        // An explicit break is the author's cut; the keep rules apply afresh after it.
        fragmentFirstLine = lineIndex + 1;
      }
    }
    flushFragment(true);
    previousSpaceAfter = endedWithPageBreak ? 0 : spacing.after;
  }

  // A TERMINAL checkpoint, describing the flow after the last paragraph. Without it,
  // appending a paragraph gives `firstChanged === paragraphCount` — "resume after the end" —
  // for which nothing was stored, so the most ordinary edit there is, typing at the bottom of
  // a document and pressing Enter, re-placed everything.
  if (!converged) {
    checkpoints[prepared.length] = {
      pageCount: pages.length,
      pageFragments: [...pageFragments],
      cursorY,
      lineCounter,
      previousSpaceAfter,
    };
  }

  // Captured BEFORE the terminal flush, which zeroes the cursor. A converged pass stopped
  // early and never walked the tail, so its end state is the one the previous pass stored.
  const endCursorY = converged && session ? session.endCursorY : cursorY;
  const endSpaceAfter = converged && session ? session.endSpaceAfter : previousSpaceAfter;
  // The terminal flush closes the page the flow was still filling. When it does NOT run,
  // the last page was already closed by a page break and the cursor sits at the top of a
  // sheet that was never opened — nothing may be appended to what is in `pages`.
  const flushesOpenPage = !converged && (pageFragments.length > 0 || pages.length === 0);
  const endsOpenPage = converged && session ? session.endsOpenPage : flushesOpenPage;

  if (flushesOpenPage) flushPage();
  // Entries for paragraphs this pass never asked for are gone from the document, or their
  // context changed; holding them would let the cache grow with the session rather than
  // with the document.
  // Retain by the keys of every paragraph in the DOCUMENT, not just those this pass
  // re-placed: a resumed pass never visits the prefix, and evicting its entries would make
  // the next full pass measure the whole document again.
  cache?.retain(new Set(keys));
  const layout: SemanticLayout = { revision, pages };
  if (session) {
    session.previous = layout;
    // A converged pass stops early, so the tail's checkpoints were never recomputed. The
    // previous pass's remain valid precisely because the flow matched at the join.
    session.checkpoints = converged
      ? [
          ...checkpoints.slice(0, convergedAt),
          ...session.checkpoints.slice(convergedAt + (session.keys.length - prepared.length)),
        ]
      : checkpoints;
    session.keys = flowKeys;
    session.context = context;
    session.endLineCounter = lineCounter;
    session.endCursorY = endCursorY;
    session.endSpaceAfter = endSpaceAfter;
    session.endsOpenPage = endsOpenPage;
    session.stats = {
      placed,
      total: prepared.length,
      reusedPages,
      fullPasses: session.stats.fullPasses + (startIndex === 0 ? 1 : 0),
    };
  }
  return { layout, pages, lineCounter, endCursorY, endSpaceAfter, endsOpenPage };
}

export { createFixedMeasurer } from './fixed-measurer.ts';
