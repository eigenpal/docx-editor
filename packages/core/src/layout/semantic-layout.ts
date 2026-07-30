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
import {
  DEFAULT_PAGE_GEOMETRY,
  type BlockFragmentRecord,
  type LayoutBox,
  type LineRecord,
  type PageGeometry,
  type PageRecord,
  type SemanticLayout,
  type TableRowFragmentRecord,
  type TextMeasurer,
} from './semantic-records.ts';

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

/** Whether a paragraph must start a new page (`w:pageBreakBefore`). */
function breaksBefore(props: readonly OoxmlProperty[]): boolean {
  return props.some(
    (property) =>
      property.localName === 'pageBreakBefore' &&
      property.attributes?.val !== '0' &&
      property.attributes?.val !== 'false'
  );
}

/** Body blocks — paragraphs AND tables — of a part, in document order. */
function bodyBlocks(part: OoxmlPart): OoxmlElement[] {
  const blocks: OoxmlElement[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'body') {
      for (const child of node.children) {
        if (child.kind === 'paragraph' || child.kind === 'table') blocks.push(child);
      }
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return blocks;
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
  const geometry = options.geometry ?? DEFAULT_PAGE_GEOMETRY;
  const measurer = options.measurer;
  const cache = options.cache;
  // Defaults to a constant deliberately NAMED for the risk: fonts resolve asynchronously, so
  // a caller that swaps the measurer without changing this is served the pre-font layout for
  // the rest of the session.
  const producer = options.producer ?? 'unversioned-measurer';

  const contentWidth = geometry.width - geometry.margin.left - geometry.margin.right;
  const contentHeight = geometry.height - geometry.margin.top - geometry.margin.bottom;

  const session = options.session;
  const context = `${producer}|${geometry.width}x${geometry.height}|${geometry.margin.top},${geometry.margin.right},${geometry.margin.bottom},${geometry.margin.left}`;

  // Prepass: everything needed to KEY a paragraph, before any of them is placed. Resuming
  // means knowing where the first change is, and that cannot be discovered while walking.
  //
  // Memoized on NODE IDENTITY: a paragraph the commit did not touch is the same object, and
  // its properties, indents and key derive from nothing but the node, the available width
  // and the producer. Recomputing the key — a serialization of the paragraph's subtree —
  // for every paragraph on every pass made the prepass, not placement, the cost of an
  // incremental layout: a one-character edit re-keyed the entire document.
  const bodies = bodyBlocks(part);
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
        key: paragraphLayoutKey({ paragraph: block, properties: props, width: available, producer }),
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
  }

  const pageBox = (index: number): LayoutBox => ({
    x: 0,
    y: index * (geometry.height + 24), // 24pt gutter between sheets, for the scroll surface
    width: geometry.width,
    height: geometry.height,
  });

  const flushPage = (): void => {
    const index = pages.length;
    const box = pageBox(index);
    pages.push({
      id: `page-${index}`,
      index,
      box,
      contentBox: {
        x: box.x + geometry.margin.left,
        y: box.y + geometry.margin.top,
        width: contentWidth,
        height: contentHeight,
      },
      fragments: pageFragments,
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
        cursorY + pendingLine.height > contentHeight &&
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
