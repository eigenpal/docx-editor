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
import { finalizePageFieldProjection } from './field-projection.ts';
import { paragraphLayoutKey, type ParagraphLayoutCache } from './layout-cache.ts';
import {
  alignSpans,
  breakParagraph,
  type Alignment,
  type PendingLine,
} from './paragraph-flow.ts';
import {
  bottomBorderExtentPt,
  collapsedSpaceBefore,
  type ParagraphBorderEdge,
  type ParagraphSpacing,
} from './paragraph-style.ts';
import { DEFAULT_RUN_STYLE, resolveRunStyle } from './run-style.ts';
import type { ResolvedTabStops } from './paragraph-tabs.ts';
import {
  resolveParagraphLayoutInputs,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { CELL_PAD, readTableStructure } from './semantic-table.ts';
import { layoutRowFragment, type TableFlowDeps } from './semantic-table-layout.ts';
import { storyBlocks } from './story-roots.ts';
import { remapPage, type HeaderFooterStoryLayout } from './hf-layout.ts';
import {
  DEFAULT_SECTION_PROPERTIES,
  enumerateDocumentSections,
  geometryOfSection,
  type DocumentSection,
} from './section-properties.ts';
import {
  DEFAULT_PAGE_GEOMETRY,
  type BlockFragmentRecord,
  type HeaderFooterStoryRecord,
  type LayoutBox,
  type LineRecord,
  type PageGeometry,
  type PageRecord,
  type ParagraphBottomBorderRecord,
  type SemanticLayout,
  type TableRowFragmentRecord,
  type TextMeasurer,
} from './semantic-records.ts';

/** Which header/footer variant a page shows (ECMA-376 §17.10.5). */
export type HeaderFooterVariantName = 'default' | 'first' | 'even';

/**
 * Pre-laid page furniture, supplied by the host (phase 2).
 *
 * Baseline stories are laid out once per variant (`layoutHeaderFooterStory`) for furniture
 * height. Allowlisted PAGE/NUMPAGES fields are projected per page after the document page
 * count is known, via {@link HeaderFooterStoryLayout.withPageContext}.
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
}

/** The flow state as it stood immediately before one block was placed. */
interface FlowCheckpoint {
  /** Completed pages at this point. The prefix of the previous layout that still stands. */
  readonly pageCount: number;
  /** Fragments already on the page being built. */
  readonly pageFragments: readonly BlockFragmentRecord[];
  readonly cursorY: number;
  readonly lineCounter: number;
  /** Trailing paragraph spacing participating in adjacent-spacing collapse. */
  readonly previousSpaceAfter: number;
}

export interface LayoutSessionStats {
  /** Paragraphs placed by the last pass, against the number in the document. */
  readonly placed: number;
  readonly total: number;
  /** Pages carried over from the previous layout without being rebuilt. */
  readonly reusedPages: number;
  /** Passes that could not resume and laid the document out from the top. */
  readonly fullPasses: number;
}

export interface LayoutSession {
  /** @internal Mutable across passes; a caller only creates one and passes it back. */
  previous: SemanticLayout | null;
  checkpoints: FlowCheckpoint[];
  keys: string[];
  /** Geometry and producer of the previous pass; a change to either forces a full pass. */
  context: string;
  stats: LayoutSessionStats;
}

/**
 * A layout session, retained across revisions by the caller.
 *
 * Separate from the paragraph cache because it holds a different thing: the cache stores
 * how a paragraph BREAKS, this stores where the flow WAS. One survives reflow, the other
 * is invalidated by it.
 */
export function createLayoutSession(): LayoutSession {
  return {
    previous: null,
    checkpoints: [],
    keys: [],
    context: '',
    stats: { placed: 0, total: 0, reusedPages: 0, fullPasses: 0 },
  };
}

/**
 * Are two pending-fragment lists the same CONTENT?
 *
 * Structural, not by identity: a paragraph re-placed by this pass produces a new object even
 * when it lands exactly where it did before, and comparing references would refuse to
 * converge on precisely the edits that leave the flow undisturbed — the common case.
 *
 * The page the tail begins with embeds these fragments, so reusing that page is only sound
 * if what is pending here matches what was pending there.
 */
function sameFragments(
  a: readonly BlockFragmentRecord[],
  b: readonly BlockFragmentRecord[]
): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]!;
    const right = b[index]!;
    if (left === right) continue;
    if (fragmentSignature(left) !== fragmentSignature(right)) return false;
  }
  return true;
}

const signatures = new WeakMap<BlockFragmentRecord, string>();

/** Cached per record, so a fragment is serialized once however often convergence is tested. */
function fragmentSignature(fragment: BlockFragmentRecord): string {
  const cached = signatures.get(fragment);
  if (cached !== undefined) return cached;
  // Every PUBLISHED field participates. A field left out converges a freshly built
  // fragment against a stale one and discards the new value — the exact bug the `props`
  // note below records for paragraph properties.
  const signature =
    fragment.kind === 'table'
      ? JSON.stringify([
          fragment.id,
          fragment.tableId,
          fragment.fragmentIndex,
          fragment.box,
          fragment.rows,
        ])
      : JSON.stringify([
          fragment.id,
          fragment.box,
          fragment.range,
          // `props` is a PUBLISHED field. A paragraph-property change layout does not read
          // moves no geometry, so without this the freshly built fragment converged against
          // the old one and was discarded — leaving a painter or style consumer reading the
          // pre-edit value.
          fragment.props,
          fragment.spacing,
          fragment.bottomBorder,
          fragment.shading,
          fragment.lines.map((line) => [line.id, line.box, line.baseline, line.spans]),
        ]);
  signatures.set(fragment, signature);
  return signature;
}

/** Whether a paragraph must start a new page (`w:pageBreakBefore`). */
function breaksBefore(props: readonly OoxmlProperty[]): boolean {
  return props.some(
    (property) =>
      property.localName === 'pageBreakBefore' &&
      property.attributes?.val !== '0' &&
      property.attributes?.val !== 'false'
  );
}

/** Prepass results by block node, valid while the width and producer both hold. */
type PreparedBlock =
  | {
      readonly kind: 'paragraph';
      readonly paragraph: OoxmlElement;
      readonly props: OoxmlProperty[];
      readonly indent: { left: number; right: number };
      readonly available: number;
      readonly alignment: Alignment;
      readonly spacing: ParagraphSpacing;
      readonly bottomBorder: ParagraphBorderEdge | undefined;
      readonly shading: string | undefined;
      readonly inheritedRunProperties: readonly OoxmlProperty[];
      readonly tabStops: ResolvedTabStops;
      readonly key: string;
    }
  | { readonly kind: 'table'; readonly table: OoxmlElement; readonly key: string };

interface PreparedBlockMemo {
  readonly contentWidth: number;
  readonly producer: string;
  readonly entry: PreparedBlock;
}

const preparedBlocks = new WeakMap<OoxmlNode, PreparedBlockMemo>();

function furnitureForSection(
  options: SemanticLayoutOptions,
  sectionIndex: number,
  sectionCount: number
): PageFurniture | undefined {
  if (options.sectionFurniture) return options.sectionFurniture[sectionIndex];
  if (sectionIndex === sectionCount - 1) return options.furniture;
  return undefined;
}

/**
 * Lay a multi-section part out section by section.
 *
 * `w:type` on a section (default `nextPage`) controls whether that section starts on a new
 * sheet relative to the previous one. Continuous sections keep flowing on the current sheet
 * only when the previous section left no open page — after a normal flush they still start
 * cleanly. Odd/even page types currently behave like nextPage (blank-page skipping deferred).
 */
function layoutMultiSectionDocument(
  blocks: readonly OoxmlElement[],
  sections: readonly DocumentSection[],
  revision: number,
  options: SemanticLayoutOptions
): SemanticLayout {
  const pages: PageRecord[] = [];
  let sheetY = 0;
  let lineCounter = 0;
  // Multi-section invalidates the single-geometry incremental session: section boundaries
  // change content width and furniture, so a checkpoint from another geometry is not sound.
  const { session: _session, ...rest } = options;
  void _session;

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex]!;
    const slice = blocks.slice(section.blockStart, section.blockEndExclusive);
    const geometry = geometryOfSection(section.properties);
    const furniture = furnitureForSection(options, sectionIndex, sections.length);

    // Start this section on a new page unless it is continuous and we somehow still have an
    // open sheet — each section call flushes its own pages, so nextPage/odd/even simply means
    // "do not share a sheet with the previous section", which is already the case.
    void section.properties.breakType;

    if (slice.length === 0) {
      // An empty section still produces a blank page when it breaks to a new page, matching
      // Word's empty-section behaviour for nextPage. Continuous empty sections add nothing.
      if (
        sectionIndex > 0 &&
        section.properties.breakType !== 'continuous' &&
        pages.length > 0
      ) {
        // Nothing to place; the previous section already ended on its own last page.
      }
      continue;
    }

    const laid = layoutBlocksWithGeometry(slice, revision, {
      ...rest,
      geometry,
      furniture,
      lineCounterStart: lineCounter,
    });
    lineCounter = laid.lineCounter;

    for (const page of laid.pages) {
      const remapped = remapPage(page, pages.length, sheetY);
      pages.push(remapped);
      sheetY = remapped.box.y + remapped.box.height + 24;
    }
  }

  if (pages.length === 0) {
    // Degenerate: every section empty. Emit one blank page from the first section's geometry.
    const geometry = geometryOfSection(sections[0]?.properties ?? DEFAULT_SECTION_PROPERTIES);
    const laid = layoutBlocksWithGeometry([], revision, { ...rest, geometry });
    return finalizePageFieldProjection({ revision, pages: laid.pages });
  }

  return finalizePageFieldProjection({ revision, pages });
}

export function layoutSemanticDocument(
  part: OoxmlPart,
  revision: number,
  options: SemanticLayoutOptions
): SemanticLayout {
  const sections = enumerateDocumentSections(part);
  const blocks = storyBlocks(part);

  if (sections.length > 1) {
    return layoutMultiSectionDocument(blocks, sections, revision, options);
  }

  const section = sections[0];
  const geometry =
    options.geometry ??
    (section ? geometryOfSection(section.properties) : DEFAULT_PAGE_GEOMETRY);
  const furniture = furnitureForSection(options, 0, sections.length) ?? options.furniture;
  const laid = layoutBlocksWithGeometry(blocks, revision, { ...options, geometry, furniture });
  const finalized = finalizePageFieldProjection(laid.layout);
  // layoutBlocksWithGeometry stores the pre-projection layout on the session; replace it so
  // incremental reuse keeps projected PAGE/NUMPAGES furniture.
  if (options.session) options.session.previous = finalized;
  return finalized;
}

interface BlockLayoutResult {
  readonly layout: SemanticLayout;
  readonly pages: readonly PageRecord[];
  readonly lineCounter: number;
}

function layoutBlocksWithGeometry(
  bodies: readonly OoxmlElement[],
  revision: number,
  options: SemanticLayoutOptions & {
    readonly geometry: PageGeometry;
    readonly lineCounterStart?: number;
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
  const producer =
    (options.producer ?? 'unversioned-measurer') +
    (styleCascade ? `|sc:${styleCascade.cacheToken}` : '');

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
  const furnitureContext = furniture
    ? `|hf:${headerDistance},${footerDistance},${furniture.titlePage ? 1 : 0}${furniture.evenAndOddHeaders ? 1 : 0};` +
      [...furniture.headers]
        .map(([variant, story]) => `h${variant}=${story.flowHeight}`)
        .join(',') +
      ';' +
      [...furniture.footers].map(([variant, story]) => `f${variant}=${story.flowHeight}`).join(',')
    : '';
  const context = `${producer}|${geometry.width}x${geometry.height}|${geometry.margin.top},${geometry.margin.right},${geometry.margin.bottom},${geometry.margin.left}${furnitureContext}`;

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
      const preparedParagraph = resolveParagraphLayoutInputs(block, contentWidth, styleCascade);
      const {
        props,
        indent,
        available,
        alignment,
        spacing,
        bottomBorder,
        shading,
        inheritedRunProperties,
        tabStops,
        tabStopsCacheToken,
      } = preparedParagraph;
      entry = {
        kind: 'paragraph',
        paragraph: block,
        props,
        indent,
        available,
        alignment,
        spacing,
        bottomBorder,
        shading,
        inheritedRunProperties,
        tabStops,
        key: paragraphLayoutKey({
          paragraph: block,
          properties: [
            ...props,
            ...inheritedRunProperties,
            { localName: 'tabStops', attributes: { token: tabStopsCacheToken } },
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
  const previous = session?.previous ?? null;
  // A geometry or producer change invalidates every checkpoint, because it moves every
  // break; resuming from one would place new content against a stale flow.
  const resumable = previous !== null && session !== undefined && session.context === context;

  /** The first paragraph whose layout inputs differ from the previous pass. */
  let firstChanged = 0;
  if (resumable) {
    const limit = Math.min(keys.length, session.keys.length);
    while (firstChanged < limit && keys[firstChanged] === session.keys[firstChanged]) {
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
    const maxSuffix = Math.min(keys.length, session.keys.length) - firstChanged;
    while (
      commonSuffix < maxSuffix &&
      keys[keys.length - 1 - commonSuffix] === session.keys[session.keys.length - 1 - commonSuffix]
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
      lineCounter: options.lineCounterStart ?? 0,
    };
  }

  const pages: PageRecord[] = [];
  let pageFragments: BlockFragmentRecord[] = [];
  let cursorY = 0;
  let lineCounter = options.lineCounterStart ?? 0;
  let previousSpaceAfter = 0;
  const checkpoints: FlowCheckpoint[] = [];
  let startIndex = 0;
  let placed = 0;
  let reusedPages = 0;

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
    reusedPages = pages.length;
    checkpoints.push(...session.checkpoints.slice(0, firstChanged));
  }

  const pageBox = (index: number): LayoutBox => ({
    x: 0,
    y: index * (geometry.height + 24), // 24pt gutter between sheets, for the scroll surface
    width: geometry.width,
    height: geometry.height,
  });

  /** The variant page `index` shows: title page first, then even/odd when declared. */
  const variantFor = (index: number): HeaderFooterVariantName =>
    furniture?.titlePage && index === 0
      ? 'first'
      : furniture?.evenAndOddHeaders && (index + 1) % 2 === 0
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
    // Baseline attach for height; document-level finalize re-projects PAGE/NUMPAGES once
    // the total page count is known (digit widths affect right-tab geometry).
    return {
      ...place(story),
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

  // Table layout shares the flow's line counter and paragraph cache.
  const tableDeps: TableFlowDeps = {
    measurer,
    cache,
    producer,
    nextLineId: () => `line-${lineCounter++}`,
    styleCascade,
  };

  /**
   * Lay out one top-level table with bounded whole-row pagination.
   * A row that would not fit forces a page break first (a single row never splits, v1);
   * leading `w:tblHeader` rows re-emit atop each continuation page before a body row.
   */
  const layoutTableInFlow = (table: OoxmlElement): void => {
    const structure = readTableStructure(table, contentWidth, 0);
    if (!structure || structure.rows.length === 0) return;
    const lineHeight = measurer.lineMetrics(DEFAULT_RUN_STYLE).height;
    const headerRows = [];
    for (const row of structure.rows) {
      if (row.isHeader) headerRows.push(row);
      else break;
    }
    let fragmentIndex = 0;
    let fragmentTop = cursorY;
    let rows: TableRowFragmentRecord[] = [];
    const closeTableFragment = (): void => {
      if (rows.length === 0) return;
      const last = rows[rows.length - 1]!;
      pageFragments.push({
        kind: 'table',
        id: `${table.id}#f${fragmentIndex}`,
        tableId: table.id,
        fragmentIndex,
        rows,
        box: {
          x: 0,
          y: fragmentTop,
          width: contentWidth,
          height: last.box.y + last.box.height - fragmentTop,
        },
      });
      fragmentIndex += 1;
      rows = [];
    };
    for (const row of structure.rows) {
      if (cursorY + lineHeight + 2 * CELL_PAD > contentHeight && cursorY > 0) {
        closeTableFragment();
        flushPage();
        fragmentTop = 0;
        // Re-emit the header rows before a continuing body row (not before a header itself).
        if (!row.isHeader) {
          for (const headerRow of headerRows) {
            const placed = layoutRowFragment(
              headerRow,
              structure.columnWidthsPt,
              0,
              cursorY,
              true,
              0,
              tableDeps
            );
            rows.push(placed.record);
            cursorY = placed.bottom;
          }
        }
      }
      const placed = layoutRowFragment(
        row,
        structure.columnWidthsPt,
        0,
        cursorY,
        false,
        0,
        tableDeps
      );
      rows.push(placed.record);
      cursorY = placed.bottom;
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
      spacing,
      bottomBorder,
      shading,
      inheritedRunProperties,
      tabStops,
    } = entry;
    const paragraphId = paragraph.id;
    const borderExtent = bottomBorderExtentPt(bottomBorder);

    if (breaksBefore(props) && (pageFragments.length > 0 || pages.length === 0)) {
      flushPage();
      previousSpaceAfter = 0;
    }

    const lines = breakParagraph(
      paragraph,
      paragraphId,
      indent.left,
      available,
      measurer,
      cache,
      cache ? entry.key : null,
      inheritedRunProperties,
      tabStops
    );

    // Keep before-spacing with the paragraph. If its first line and one-line tail do not
    // fit, start the paragraph on a fresh page instead of stranding an empty gap.
    {
      const lead = collapsedSpaceBefore(spacing.before, previousSpaceAfter);
      const emptyStyle =
        inheritedRunProperties.length === 0
          ? DEFAULT_RUN_STYLE
          : resolveRunStyle(inheritedRunProperties);
      const firstHeight = lines[0]?.height ?? measurer.lineMetrics(emptyStyle).height;
      const firstTail = lines.length <= 1 ? borderExtent + spacing.after : 0;
      if (cursorY + lead + firstHeight + firstTail > contentHeight && cursorY > 0) {
        flushPage();
        previousSpaceAfter = 0;
      }
    }

    // Word collapses adjacent paragraph spacing to the larger of previous-after/current-before.
    const appliedBefore = collapsedSpaceBefore(spacing.before, previousSpaceAfter);
    if (appliedBefore > 0) cursorY += appliedBefore;

    // Place the lines, fragmenting at page boundaries.
    let fragmentIndex = 0;
    let pending: LineRecord[] = [];
    let fragmentStart = lines[0]?.start ?? 0;
    let fragmentBefore = appliedBefore;
    let endedWithPageBreak = false;
    previousSpaceAfter = 0;

    const flushFragment = (isLast: boolean): void => {
      if (pending.length === 0) return;
      const top = pending[0]!.box.y - fragmentBefore;
      const linesBottom = pending[pending.length - 1]!.box.y + pending[pending.length - 1]!.box.height;
      const appliedAfter = isLast ? spacing.after : 0;
      let bottomBorderRecord: ParagraphBottomBorderRecord | undefined;
      let contentBottom = linesBottom;
      if (isLast && bottomBorder) {
        const ruleY = linesBottom + bottomBorder.spacePt;
        bottomBorderRecord = {
          edge: bottomBorder,
          box: {
            x: indent.left,
            y: ruleY,
            width: available,
            height: bottomBorder.widthPt,
          },
        };
        contentBottom = ruleY + bottomBorder.widthPt;
      }
      if (isLast) cursorY = Math.max(cursorY, contentBottom + appliedAfter);
      const height = Math.max(contentBottom + appliedAfter - top, 0);
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
        ...(shading === undefined ? {} : { shading }),
        lines: pending,
        box: { x: indent.left, y: top, width: available, height },
      });
      fragmentIndex += 1;
      fragmentStart = pending[pending.length - 1]!.range.end;
      pending = [];
      fragmentBefore = 0;
    };

    for (const [lineIndex, pendingLine] of lines.entries()) {
      const isLastLine = lineIndex === lines.length - 1;
      const tail = isLastLine ? borderExtent + spacing.after : 0;
      if (
        cursorY + pendingLine.height + tail > contentHeight &&
        (pending.length > 0 || pageFragments.length > 0 || pages.length > 0)
      ) {
        flushFragment(false);
        flushPage();
        fragmentBefore = 0;
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
          indent.left,
          available,
          alignment,
          isLastLine
        ),
        box: { x: indent.left, y: cursorY, width: available, height: pendingLine.height },
        baseline: pendingLine.baseline,
      };
      lineCounter += 1;
      pending.push(record);
      cursorY += pendingLine.height;
      if (pendingLine.pageBreakAfter) {
        flushFragment(isLastLine);
        flushPage();
        fragmentBefore = 0;
        endedWithPageBreak = true;
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

  if (!converged && (pageFragments.length > 0 || pages.length === 0)) flushPage();
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
    // A converged pass stops early, so the tail's checkpoints were never recomputed; the
    // previous pass's remain valid precisely because the flow matched.
    // A converged pass stops early, so the tail's checkpoints were never recomputed. The
    // previous pass's remain valid precisely because the flow matched at the join.
    session.checkpoints = converged
      ? [
          ...checkpoints.slice(0, convergedAt),
          ...session.checkpoints.slice(convergedAt + (session.keys.length - prepared.length)),
        ]
      : checkpoints;
    session.keys = keys;
    session.context = context;
    session.stats = {
      placed,
      total: prepared.length,
      reusedPages,
      fullPasses: session.stats.fullPasses + (startIndex === 0 ? 1 : 0),
    };
  }
  return { layout, pages, lineCounter };
}

export { createFixedMeasurer } from './fixed-measurer.ts';
