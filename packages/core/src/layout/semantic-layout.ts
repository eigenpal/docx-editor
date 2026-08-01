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
import { paragraphLayoutKey, type ParagraphLayoutCache } from './layout-cache.ts';
import {
  alignSpans,
  breakParagraph,
  paragraphAlignment,
  paragraphIndent,
  propertiesOf,
  type Alignment,
  type PendingLine,
} from './paragraph-flow.ts';
import { DEFAULT_RUN_STYLE, type ResolvedRunStyle } from './run-style.ts';
import { CELL_PAD, readTableStructure } from './semantic-table.ts';
import { layoutRowFragment, type TableFlowDeps } from './semantic-table-layout.ts';
import { storyBlocks } from './story-roots.ts';
import type { HeaderFooterStoryLayout } from './hf-layout.ts';
import {
  DEFAULT_PAGE_GEOMETRY,
  type BlockFragmentRecord,
  type HeaderFooterStoryRecord,
  type LayoutBox,
  type LineRecord,
  type PageGeometry,
  type PageRecord,
  type SemanticLayout,
  type TableRowFragmentRecord,
  type TextMeasurer,
} from './semantic-records.ts';

/** Which header/footer variant a page shows (ECMA-376 §17.10.5). */
export type HeaderFooterVariantName = 'default' | 'first' | 'even';

/**
 * Pre-laid page furniture, supplied by the host (phase 2).
 *
 * Stories are laid out ONCE per variant (`layoutHeaderFooterStory`) and attached per page
 * here; the body pass only selects the variant and computes the push-down.
 */
export interface PageFurniture {
  readonly titlePage: boolean;
  readonly evenAndOddHeaders: boolean;
  readonly headers: ReadonlyMap<HeaderFooterVariantName, HeaderFooterStoryLayout>;
  readonly footers: ReadonlyMap<HeaderFooterVariantName, HeaderFooterStoryLayout>;
}

/** One section's slice of the flow, as pagination consumes it. */
export interface LayoutSectionInput {
  readonly geometry: PageGeometry;
  /** Index into the story's blocks of the first block this section governs. */
  readonly firstBlock: number;
  /** How the section begins. `continuous` with an unchanged geometry shares the page. */
  readonly breakType?: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage' | 'nextColumn';
}

export interface SemanticLayoutOptions {
  readonly geometry?: PageGeometry;
  /**
   * Per-section page geometry (the per-section lane). Sections partition the story's
   * blocks by `firstBlock`; each paginates against its own geometry, and a non-continuous
   * boundary starts a new page — one landscape section among portrait ones lays out as
   * Word shows it. Absent or single-entry means the whole story flows in `geometry`.
   */
  readonly sections?: readonly LayoutSectionInput[];
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
}

/** The flow state as it stood immediately before one block was placed. */
interface FlowCheckpoint {
  /** Completed pages at this point. The prefix of the previous layout that still stands. */
  readonly pageCount: number;
  /** Fragments already on the page being built. */
  readonly pageFragments: readonly BlockFragmentRecord[];
  readonly cursorY: number;
  readonly lineCounter: number;
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
          fragment.lines.map((line) => [line.id, line.box, line.baseline, line.spans]),
        ]);
  signatures.set(fragment, signature);
  return signature;
}

/** Whether two sections could share a sheet: identical page box and margins. */
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

/** Whether a paragraph must start a new page (`w:pageBreakBefore`). */
function breaksBefore(props: readonly OoxmlProperty[]): boolean {
  return props.some(
    (property) =>
      property.localName === 'pageBreakBefore' &&
      property.attributes?.val !== '0' &&
      property.attributes?.val !== 'false'
  );
}

/**
 * Lay a part out into pages, fragments, lines and spans.
 *
 * Deterministic: same tree plus same measurer produces byte-identical records, which is what
 * makes the incremental engine of section 9 differentially testable against a clean run.
 */
/** Prepass results by block node, valid while the width and producer both hold. */
type PreparedBlock =
  | {
      readonly kind: 'paragraph';
      readonly paragraph: OoxmlElement;
      readonly props: OoxmlProperty[];
      readonly indent: { left: number; right: number };
      readonly available: number;
      readonly alignment: Alignment;
      readonly key: string;
    }
  | {
      readonly kind: 'table';
      readonly table: OoxmlElement;
      readonly key: string;
    };

interface PreparedBlockMemo {
  readonly contentWidth: number;
  readonly producer: string;
  readonly entry: PreparedBlock;
}

const preparedBlocks = new WeakMap<OoxmlNode, PreparedBlockMemo>();

export function layoutSemanticDocument(
  part: OoxmlPart,
  revision: number,
  options: SemanticLayoutOptions
): SemanticLayout {
  const measurer = options.measurer;
  const cache = options.cache;
  // Defaults to a constant deliberately NAMED for the risk: fonts resolve asynchronously, so
  // a caller that swaps the measurer without changing this is served the pre-font layout for
  // the rest of the session.
  const producer = options.producer ?? 'unversioned-measurer';
  const furniture = options.furniture;

  // SECTIONS. The flow is partitioned into sections, each paginating against its own
  // geometry. The single-geometry call is the degenerate one-section case, so there is
  // exactly one pagination path.
  const sections: readonly LayoutSectionInput[] =
    options.sections && options.sections.length > 0
      ? options.sections
      : [{ geometry: options.geometry ?? DEFAULT_PAGE_GEOMETRY, firstBlock: 0 }];

  // PAGE FURNITURE push-down, derived per section geometry. A header taller than the
  // top-margin remainder pushes the content area down (Word's behaviour), computed as the
  // worst case over the variants in use so the content column is one height for every page
  // of the section. Capped at 40% of the sheet per edge: a hostile header of five hundred
  // paragraphs must not shrink the content area to nothing, because pagination into a
  // zero-height column never terminates.
  const maxFlow = (stories: ReadonlyMap<string, HeaderFooterStoryLayout> | undefined): number => {
    let max = 0;
    for (const story of stories?.values() ?? []) max = Math.max(max, story.flowHeight);
    return max;
  };
  interface SectionMetrics {
    readonly geometry: PageGeometry;
    readonly contentWidth: number;
    readonly contentHeight: number;
    readonly effectiveTop: number;
    readonly headerDistance: number;
    readonly footerDistance: number;
  }
  const metricsOf = (geometry: PageGeometry): SectionMetrics => {
    const headerDistance = geometry.headerDistance ?? 36;
    const footerDistance = geometry.footerDistance ?? 36;
    const furnitureCap = geometry.height * 0.4;
    const effectiveTop = Math.min(
      furnitureCap,
      Math.max(geometry.margin.top, furniture ? headerDistance + maxFlow(furniture.headers) : 0)
    );
    const effectiveBottom = Math.min(
      furnitureCap,
      Math.max(geometry.margin.bottom, furniture ? footerDistance + maxFlow(furniture.footers) : 0)
    );
    return {
      geometry,
      contentWidth: geometry.width - geometry.margin.left - geometry.margin.right,
      contentHeight: geometry.height - effectiveTop - effectiveBottom,
      effectiveTop,
      headerDistance,
      footerDistance,
    };
  };
  const sectionMetrics = sections.map((section) => metricsOf(section.geometry));

  const session = options.session;
  const furnitureContext = furniture
    ? `|hf:${furniture.titlePage ? 1 : 0}${furniture.evenAndOddHeaders ? 1 : 0};` +
      [...furniture.headers]
        .map(([variant, story]) => `h${variant}=${story.flowHeight}`)
        .join(',') +
      ';' +
      [...furniture.footers].map(([variant, story]) => `f${variant}=${story.flowHeight}`).join(',')
    : '';
  // EVERY section participates: a change to any section's geometry or extent moves breaks,
  // so it must invalidate checkpoints exactly as the single geometry did.
  const sectionsContext = sections
    .map(({ geometry: g, firstBlock, breakType }) => {
      return `${firstBlock}${breakType ?? 'nextPage'}@${g.width}x${g.height}|${g.margin.top},${g.margin.right},${g.margin.bottom},${g.margin.left}|${g.headerDistance ?? 36},${g.footerDistance ?? 36}`;
    })
    .join(';');
  const context = `${producer}|${sectionsContext}${furnitureContext}`;

  // Prepass: everything needed to KEY a paragraph, before any of them is placed. Resuming
  // means knowing where the first change is, and that cannot be discovered while walking.
  //
  // Memoized on NODE IDENTITY: a paragraph the commit did not touch is the same object, and
  // its properties, indents and key derive from nothing but the node, the available width
  // and the producer. Recomputing the key — a serialization of the paragraph's subtree —
  // for every paragraph on every pass made the prepass, not placement, the cost of an
  // incremental layout: a one-character edit re-keyed the entire document.
  const bodies = storyBlocks(part);

  // Which section governs each block. Sections partition the block list by `firstBlock`;
  // blocks before the first section's start (malformed input) flow in the first section.
  const sectionOfBlock = new Array<number>(bodies.length);
  {
    let sectionIndex = 0;
    for (let index = 0; index < bodies.length; index += 1) {
      while (
        sectionIndex + 1 < sections.length &&
        sections[sectionIndex + 1]!.firstBlock <= index
      ) {
        sectionIndex += 1;
      }
      sectionOfBlock[index] = sectionIndex;
    }
  }

  const prepared = bodies.map((block, blockIndex): PreparedBlock => {
    // A block is broken at ITS section's width — that is what makes a landscape section's
    // lines longer than its portrait neighbours'.
    const contentWidth = sectionMetrics[sectionOfBlock[blockIndex]!]!.contentWidth;
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
      const props = propertiesOf(
        block.children.find((child) => child.kind === 'paragraphProperties')
      );
      const indent = paragraphIndent(props);
      const available = Math.max(1, contentWidth - indent.left - indent.right);
      entry = {
        kind: 'paragraph',
        paragraph: block,
        props,
        indent,
        available,
        alignment: paragraphAlignment(props),
        key: paragraphLayoutKey({
          paragraph: block,
          properties: props,
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
    return unchanged;
  }

  const pages: PageRecord[] = [];
  let pageFragments: BlockFragmentRecord[] = [];
  let cursorY = 0;
  let lineCounter = 0;
  const checkpoints: FlowCheckpoint[] = [];
  let startIndex = 0;
  let placed = 0;
  let reusedPages = 0;

  // The section whose geometry the page being built uses. The boundary switch happens as
  // part of PLACING a section's first block, after that block's checkpoint — so a resumed
  // pass re-derives the same switch from the same block index.
  let activeSectionIndex = 0;
  let active = sectionMetrics[0]!;
  /** Where the NEXT page's sheet begins. Cumulative, because sheets vary in height. */
  let pageTop = 0;

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
    startIndex = firstChanged;
    reusedPages = pages.length;
    checkpoints.push(...session.checkpoints.slice(0, firstChanged));
    const lastCarried = pages[pages.length - 1];
    pageTop = lastCarried ? lastCarried.box.y + lastCarried.box.height + 24 : 0;
    // The page being built belongs to the section of the block placed BEFORE the resume
    // point; the loop re-runs the boundary switch if the resumed block starts a section.
    activeSectionIndex = sectionOfBlock[startIndex - 1] ?? 0;
    active = sectionMetrics[activeSectionIndex]!;
  }

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
    const y =
      kind === 'header'
        ? box.y + active.headerDistance
        : box.y + active.geometry.height - active.footerDistance - story.flowHeight;
    // The story's lines were BROKEN at the body section's width (furniture is laid out
    // once per variant); on a page of another section it is positioned in that page's
    // margins. Re-breaking furniture per section is a follow-up refinement.
    return {
      kind,
      variant,
      partName: story.partName,
      box: {
        x: box.x + active.geometry.margin.left,
        y,
        width: active.contentWidth,
        height: story.flowHeight,
      },
      fragments: story.fragments,
    };
  };

  // Sheets of mixed widths centre against the widest, as Word lays a landscape page
  // among portrait ones. Single-section documents keep x = 0 exactly as before.
  const maxSheetWidth = Math.max(...sectionMetrics.map((metrics) => metrics.geometry.width));

  const flushPage = (): void => {
    const index = pages.length;
    const geometry = active.geometry;
    // 24pt gutter between sheets, for the scroll surface. Cumulative, not index-derived:
    // sheets no longer share one height.
    const box: LayoutBox = {
      x: (maxSheetWidth - geometry.width) / 2,
      y: pageTop,
      width: geometry.width,
      height: geometry.height,
    };
    pageTop += geometry.height + 24;
    const header = furnitureFor('header', index, box);
    const footer = furnitureFor('footer', index, box);
    pages.push({
      id: `page-${index}`,
      index,
      box,
      contentBox: {
        x: box.x + geometry.margin.left,
        y: box.y + active.effectiveTop,
        width: active.contentWidth,
        height: active.contentHeight,
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
  };

  /**
   * Lay out one top-level table with bounded whole-row pagination.
   * A row that would not fit forces a page break first (a single row never splits, v1);
   * leading `w:tblHeader` rows re-emit atop each continuation page before a body row.
   */
  const layoutTableInFlow = (table: OoxmlElement): void => {
    const structure = readTableStructure(table, active.contentWidth, 0);
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
          width: active.contentWidth,
          height: last.box.y + last.box.height - fragmentTop,
        },
      });
      fragmentIndex += 1;
      rows = [];
    };
    for (const row of structure.rows) {
      if (cursorY + lineHeight + 2 * CELL_PAD > active.contentHeight && cursorY > 0) {
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

    // SECTION BOUNDARY. This block belongs to a later section: close the page the previous
    // section was filling (unless it is still empty) and switch the flow onto the new
    // section's geometry. `continuous` with an unchanged geometry shares the page —
    // Word's column-change case; a changed geometry cannot share a sheet, so it breaks.
    // Even/odd parity blanks are not modelled: those types break like `nextPage`.
    const blockSection = sectionOfBlock[index] ?? sections.length - 1;
    if (blockSection !== activeSectionIndex) {
      const next = sectionMetrics[blockSection]!;
      const sharesPage =
        (sections[blockSection]!.breakType ?? 'nextPage') === 'continuous' &&
        sameGeometry(active.geometry, next.geometry);
      if (!sharesPage && pageFragments.length > 0) flushPage();
      activeSectionIndex = blockSection;
      active = next;
    }

    placed += 1;

    if (entry.kind === 'table') {
      layoutTableInFlow(entry.table);
      continue;
    }

    const { paragraph, props, indent, alignment, available } = entry;
    const paragraphId = paragraph.id;

    if (breaksBefore(props) && (pageFragments.length > 0 || pages.length === 0)) {
      flushPage();
    }

    const lines = breakParagraph(
      paragraph,
      paragraphId,
      indent.left,
      available,
      measurer,
      cache,
      cache ? entry.key : null
    );

    // Place the lines, fragmenting at page boundaries.
    let fragmentIndex = 0;
    let pending: LineRecord[] = [];
    let fragmentStart = lines[0]?.start ?? 0;

    const flushFragment = (): void => {
      if (pending.length === 0) return;
      const top = pending[0]!.box.y;
      const height = pending.reduce((sum, record) => sum + record.box.height, 0);
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
        lines: pending,
        box: { x: indent.left, y: top, width: available, height },
      });
      fragmentIndex += 1;
      fragmentStart = pending[pending.length - 1]!.range.end;
      pending = [];
    };

    for (const [lineIndex, pendingLine] of lines.entries()) {
      if (
        cursorY + pendingLine.height > active.contentHeight &&
        (pending.length > 0 || pageFragments.length > 0)
      ) {
        flushFragment();
        flushPage();
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
          lineIndex === lines.length - 1
        ),
        box: { x: indent.left, y: cursorY, width: available, height: pendingLine.height },
        baseline: pendingLine.baseline,
      };
      lineCounter += 1;
      pending.push(record);
      cursorY += pendingLine.height;
    }
    flushFragment();
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
  return layout;
}

/**
 * A deterministic measurer for tests and headless use.
 *
 * Monospace by construction: every character is the same width and every line the same
 * height, scaled by `w:sz` when present. Real shaping is the HarfBuzz path; this exists so
 * layout behaviour can be asserted without a font stack deciding the answer.
 */
export function createFixedMeasurer(charWidth = 6, lineHeight = 14): TextMeasurer {
  // 11pt is the size the base width and height describe; everything else scales from it.
  const scale = (style: ResolvedRunStyle): number => style.fontSizePt / 11;
  return {
    measure: (text, style) => {
      // Advance, then horizontal scaling, then character spacing — the order Word applies
      // them, and the order that makes `w:spacing` an absolute per-character addition
      // rather than something the scale multiplies.
      const advance = text.length * charWidth * scale(style);
      const scaled = advance * (style.horizontalScalePercent / 100);
      return scaled + text.length * style.characterSpacingPt;
    },
    lineMetrics: (style) => {
      // Super/subscript draw smaller, so they need less line height than their nominal size.
      const shrink = style.verticalAlign === 'baseline' ? 1 : 0.75;
      const height = lineHeight * scale(style) * shrink;
      return { height, baseline: height * 0.8 };
    },
  };
}
