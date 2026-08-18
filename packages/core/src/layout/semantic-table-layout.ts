// Table row and cell layout over the canonical tree.
//
// Row, cell, and nested-table flow operate on typed tree nodes with the injected
// TextMeasurer and emit semantic records:
//
//   - a row is laid out in TWO PASSES — every cell flows into a buffer while the tallest
//     bottom is tracked, then every cell box is emitted at the final row height;
//   - a vMerge continuation emits its box but no content, so text is never duplicated;
//   - after all rows of a fragment are placed, vertical merges expand the restart box,
//     vAlign shifts content, and collapsed borders resolve onto layout-owned edges;
//   - top-level table rows paginate with a real-height preflight: an unsplit row that does
//     not fit moves to the next page; a row taller than a fresh page fragments at
//     paragraph/line boundaries when splittable, or fails closed under w:cantSplit /
//     unsupported nested cuts;
//   - a NESTED table lays out with its own geometry inside the cell box, no pagination.
//
// All coordinates are points, relative to the page content box — exactly the space body
// paragraph fragments already live in. Cell paragraph breaks go through the shared
// `breakParagraph`, so they hit the same cache with keys at the cell's content width.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import {
  clipInlineDrawingRecordToRegion,
  shiftInlineDrawingRecord,
  publishAnchoredDrawingsForParagraph,
  anchoredDrawingAtomsInParagraph,
  type AnchoredDrawingRecord,
  type DrawingAnchorFrameContext,
} from './drawing-layout.ts';
import {
  exclusionLayoutToken,
  filterExclusionZonesForParagraphOrder,
  localizeExclusionZones,
  topAndBottomSkipBeforeLine,
} from './drawing-exclusion.ts';
import type { FieldPageContext, HyperlinkProjector } from './field-projection.ts';
import { paragraphLayoutKey, type ParagraphLayoutCache } from './layout-cache.ts';
import { alignDrawings, alignSpans, breakParagraph, type PendingLine } from './paragraph-flow.ts';
import {
  markRevisionFields,
  paragraphMarkFormatRevisionOf,
  paragraphMarkRevisionsOf,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import {
  collapsedSpaceBefore,
  paragraphBorderExtentPt,
  paragraphBorderStrokeWidthPt,
} from './paragraph-style.ts';
import { tabStopsFingerprint, withDefaultTabInterval } from './paragraph-tabs.ts';
import { DEFAULT_RUN_STYLE } from './run-style.ts';
import {
  resolveParagraphLayoutInputs,
  cascadeRunProperties,
  type StyleCascadeTable,
  type TableCellStyleFormatting,
} from './style-cascade.ts';
import { paragraphShadingBox } from './ooxml-shading.ts';
import {
  MAX_TABLE_NESTING,
  readTableStructure,
  tableOriginX,
  type CellMarginsPt,
  type SemanticTableCell,
  type SemanticTableRow,
  type SemanticTableStructure,
} from './semantic-table.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  ParagraphBorderStrokeRecord,
  ParagraphBottomBorderRecord,
  ParagraphFragmentRecord,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
  TextMeasurer,
  LayoutBox,
} from './semantic-records.ts';
import { firstLineShift, type ResolvedListItem } from './list-resolve.ts';
import { publishListMarker } from './list-marker.ts';
import { annotateTableFragmentGeometry } from './semantic-table-interaction.ts';
import {
  borderExtentPt,
  resolveTableCellBorderGrid,
  type BorderGridCell,
  type BorderGridGeometry,
  type CellBorderBox,
  type TableBorderBox,
  type TableBorderOwnershipBudget,
} from './table-borders.ts';
import {
  resolveVMergeSpans,
  type TableVMergeResolveBudget,
  type TableVMergeResolveWork,
} from './table-vmerge.ts';

export {
  createTableBorderOwnershipBudget,
  MAX_BORDER_OWNERSHIP_INTERVALS,
} from './table-borders.ts';

/** Walk top-level prepared blocks and table cell paragraphs in document order. */
export function paragraphDocumentOrderOf(
  prepared: readonly {
    readonly kind: 'paragraph' | 'table';
    readonly paragraph?: OoxmlElement;
    readonly table?: OoxmlElement;
  }[],
  contentWidth: number,
  styleCascade: StyleCascadeTable | undefined,
  displayMode: RevisionDisplayMode
): ReadonlyMap<string, number> {
  const order = new Map<string, number>();
  let index = 0;
  const walkTable = (table: OoxmlElement): void => {
    const structure = readTableStructure(table, contentWidth, 0, styleCascade, displayMode);
    if (!structure) return;
    for (const row of structure.rows) {
      for (const cell of row.cells) {
        for (const block of cell.blocks) {
          if (block.localName === 'p') {
            order.set(block.id, index++);
          } else if (block.localName === 'tbl') {
            walkTable(block);
          }
        }
      }
    }
  };
  for (const block of prepared) {
    if (block.kind === 'paragraph' && block.paragraph) {
      order.set(block.paragraph.id, index++);
    } else if (block.kind === 'table' && block.table) {
      walkTable(block.table);
    }
  }
  return order;
}

export {
  createTableVMergeResolveBudget,
  MAX_VMERGE_RESOLVE_CELLS,
  resolveVMergeSpans,
  type TableVMergeResolveBudget,
  type TableVMergeResolveWork,
} from './table-vmerge.ts';

/** Soft ceiling on fragments emitted for one authored row (hostile / runaway splits). */
export const MAX_TABLE_ROW_FRAGMENTS = 4096;

/** A cell box never narrows below this, however wide a `w:tblCellSpacing` gap is stated. */
const MIN_CELL_BOX_PT = 1;

/**
 * Why a table could not be paginated as authored.
 *
 * Each is a bound: a row taller than a page, a row that cannot be split, or a row producing more
 * fragments than the limit allows.
 */
export type TablePaginationErrorCode =
  | 'table-row-overheight'
  | 'table-row-split-unsupported'
  | 'table-row-fragment-limit';

/**
 * Bounded table pagination failure. Prefer this over emitting a fragment that overflows
 * the page content box.
 */
export class TablePaginationError extends Error {
  readonly code: TablePaginationErrorCode;
  constructor(code: TablePaginationErrorCode, message: string) {
    super(message);
    this.name = 'TablePaginationError';
    this.code = code;
  }
}

export interface TableFlowDeps {
  readonly measurer: TextMeasurer;
  readonly cache?: ParagraphLayoutCache<readonly PendingLine[]> | undefined;
  readonly producer: string;
  /** Produces a stable id from the paragraph-local line identity. */
  readonly nextLineId: (
    paragraphId: string,
    start: number,
    lineIndex: number,
    occurrence?: string
  ) => string;
  /** Stable visual occurrence for repeated header rows on the current page. */
  readonly pageOccurrenceKey?: () => string;
  readonly styleCascade?: StyleCascadeTable;
  /** When set (header/footer page projection), PAGE/NUMPAGES resolve against this context. */
  readonly pageContext?: FieldPageContext;
  /** Derived footnote/endnote marks for noteReference / noteRef projection. */
  readonly noteMarks?: import('./note-projection.ts').NoteMarkContext;
  /**
   * Precomputed body-story list items (including cell paragraphs). Absent for header/footer
   * stories that do not share the body counter stream.
   */
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
  /**
   * `w:settings/w:defaultTabStop` in points; absent keeps the 0.5" schema default. A cell
   * paragraph tabs on the same document-wide grid as a body paragraph.
   */
  readonly defaultTabStopPt?: number;
  /**
   * Turns a typed `w:hyperlink` into the sanitized record its spans carry. A link in a
   * table cell is an ordinary link; without this it would paint its text and be dead.
   */
  readonly projectLink?: HyperlinkProjector;
  readonly inlineDrawingLayout?: import('./drawing-layout.ts').InlineDrawingLayoutContext;
  /** Per-paragraph drawing projection/resource token for break cache keys. */
  readonly drawingTokenForParagraph?: (paragraph: OoxmlNode) => string;
  /** @deprecated Prefer {@link drawingTokenForParagraph}. */
  readonly drawingLayoutToken?: string;
  /**
   * Shared sparse ownership-interval budget for border finalize across nested tables in
   * one layout pass. Created once per flow; omit only in isolated unit tests.
   */
  readonly borderOwnershipBudget?: TableBorderOwnershipBudget;
  /**
   * Shared cell-visit budget for vMerge span resolve across nested tables in one layout
   * pass. Exhaustion fails soft (remaining restarts keep rowSpan 1).
   */
  readonly vMergeResolveBudget?: TableVMergeResolveBudget;
  /**
   * Which tracked revisions this pass resolves away. A cell paragraph must resolve the same
   * mode as a body paragraph, or one table would show the proposed result while the text
   * around it showed the original.
   */
  readonly displayMode?: RevisionDisplayMode;
  readonly anchorFrameBase?: () => Omit<
    DrawingAnchorFrameContext,
    'paragraphBox' | 'anchorLineBox' | 'anchorCharacterX' | 'columnBox' | 'cellBox' | 'layoutInCell'
  >;
  /** Lays out a textbox drawing's story; absent hosts degrade to the placeholder path. */
  readonly layoutTextboxStoryFor?: (
    projection: import('../store/package/drawing-projection.ts').DrawingProjection
  ) => import('./textbox-story-layout.ts').TextboxStoryLayout | null;
  readonly pageContentClip?: () => import('./semantic-records.ts').LayoutBox;
  readonly collectAnchoredDrawings?: (drawings: readonly AnchoredDrawingRecord[]) => void;
  /** Root anchor sink — preserved when row defer strips {@link collectAnchoredDrawings}. */
  readonly publishAnchoredDrawings?: (drawings: readonly AnchoredDrawingRecord[]) => void;
  readonly columnBoxForParagraph?: (
    paragraphBox: import('./semantic-records.ts').LayoutBox
  ) => import('./semantic-records.ts').LayoutBox;
  readonly deferAnchoredDrawings?: (pending: {
    readonly paragraph: OoxmlNode;
    readonly paragraphId: string;
    readonly paragraphBox: LayoutBox;
    readonly lines: readonly LineRecord[];
    readonly cellOriginX: number;
    readonly cellContentWidth: number;
  }) => void;
  readonly onAnchorShift?: (paragraphId: string, dy: number) => void;
  readonly onAnchorRepublish?: (
    paragraphId: string,
    drawings: readonly AnchoredDrawingRecord[]
  ) => void;
  /** When true, row finalize forwards deferred anchors without publishing them. */
  readonly anchorDeferOnly?: boolean;
  /** Body-page wrap exclusion zones active while breaking cell paragraphs. */
  readonly pageExclusionZones?: () => readonly import('./drawing-exclusion.ts').ExclusionZone[];
  /** Document-order index for filtering wrap zones to earlier anchors only. */
  readonly paragraphOrderIndex?: (paragraphId: string) => number | undefined;
}

/**
 * Per-cell progress through a row that may span pages. Indices are into the authored
 * cell.blocks list and the paragraph's broken lines — never DOM geometry.
 */
export interface CellPlaceCursor {
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly previousSpaceAfter: number;
  readonly paragraphFragmentIndex: number;
}

export function initialCellCursors(row: SemanticTableRow): CellPlaceCursor[] {
  return row.cells.map(() => ({
    blockIndex: 0,
    lineIndex: 0,
    previousSpaceAfter: 0,
    paragraphFragmentIndex: 0,
  }));
}

function anchorPublishSink(
  deps: TableFlowDeps
): ((drawings: readonly AnchoredDrawingRecord[]) => void) | undefined {
  return deps.publishAnchoredDrawings ?? deps.collectAnchoredDrawings;
}

type DeferredRowAnchor = {
  readonly paragraph: OoxmlNode;
  readonly paragraphId: string;
  readonly paragraphBox: LayoutBox;
  readonly lines: readonly LineRecord[];
  readonly cellOriginX: number;
  readonly cellContentWidth: number;
};

function publishDeferredRowAnchors(
  deferredRowAnchors: readonly DeferredRowAnchor[],
  cells: readonly TableCellFragmentRecord[],
  rowTop: number,
  rowHeight: number,
  deps: TableFlowDeps
): void {
  const publish = anchorPublishSink(deps);
  if (
    deferredRowAnchors.length === 0 ||
    !publish ||
    !deps.inlineDrawingLayout ||
    !deps.anchorFrameBase ||
    !deps.pageContentClip
  ) {
    return;
  }
  for (const pending of deferredRowAnchors) {
    let paragraphBox: LayoutBox | null = null;
    let cellFrameBox: LayoutBox | null = null;
    let lines: readonly LineRecord[] = pending.lines;
    for (const cell of cells) {
      for (const block of cell.blocks) {
        if (block.kind === 'paragraph' && block.paragraphId === pending.paragraphId) {
          paragraphBox = block.box;
          lines = block.lines;
          cellFrameBox = cell.box;
          break;
        }
      }
      if (paragraphBox) break;
    }
    if (!paragraphBox) continue;
    const cellBox =
      cellFrameBox ??
      Object.freeze({
        x: pending.cellOriginX,
        y: rowTop,
        width: pending.cellContentWidth,
        height: rowHeight,
      });
    publish(
      publishAnchoredDrawingsForParagraph({
        paragraph: pending.paragraph,
        paragraphId: pending.paragraphId,
        paragraphBox,
        lines,
        drawingLayout: deps.inlineDrawingLayout,
        frameBase: deps.anchorFrameBase(),
        columnBox: deps.columnBoxForParagraph?.(paragraphBox) ?? paragraphBox,
        cellBox,
        pageClip: deps.pageContentClip(),
        measurer: deps.measurer,
        ...(deps.layoutTextboxStoryFor ? { layoutTextboxStory: deps.layoutTextboxStoryFor } : {}),
      })
    );
  }
}

function republishAnchoredParagraphsInBlocks(
  blocks: readonly BlockFragmentRecord[],
  authoredBlocks: readonly OoxmlElement[],
  cellBox: LayoutBox,
  deps: TableFlowDeps
): void {
  if (
    !deps.onAnchorRepublish ||
    !deps.inlineDrawingLayout ||
    !deps.anchorFrameBase ||
    !deps.pageContentClip
  ) {
    return;
  }
  for (const block of blocks) {
    if (block.kind !== 'paragraph') continue;
    const paragraph = authoredBlocks.find(
      (candidate) => candidate.kind === 'paragraph' && candidate.id === block.paragraphId
    );
    if (!paragraph || paragraph.kind !== 'paragraph') continue;
    const atoms = anchoredDrawingAtomsInParagraph(paragraph, deps.inlineDrawingLayout);
    if (atoms.length === 0) continue;
    deps.onAnchorRepublish(
      block.paragraphId,
      publishAnchoredDrawingsForParagraph({
        paragraph,
        paragraphId: block.paragraphId,
        paragraphBox: block.box,
        lines: block.lines,
        drawingLayout: deps.inlineDrawingLayout,
        frameBase: deps.anchorFrameBase(),
        columnBox: deps.columnBoxForParagraph?.(block.box) ?? block.box,
        cellBox,
        pageClip: deps.pageContentClip(),
        measurer: deps.measurer,
        ...(deps.layoutTextboxStoryFor ? { layoutTextboxStory: deps.layoutTextboxStoryFor } : {}),
      })
    );
  }
}

function rowDepsForAnchors(
  deps: TableFlowDeps,
  deferredRowAnchors: DeferredRowAnchor[]
): {
  readonly rowDeps: TableFlowDeps;
  readonly flushDeferred: (
    cells: readonly TableCellFragmentRecord[],
    rowTop: number,
    rowHeight: number
  ) => void;
} {
  const publishAnchoredDrawings = anchorPublishSink(deps);
  const parentDefer = deps.deferAnchoredDrawings;
  if (!publishAnchoredDrawings && !parentDefer) {
    return { rowDeps: deps, flushDeferred: () => {} };
  }
  const rowDeps: TableFlowDeps = {
    ...deps,
    publishAnchoredDrawings,
    collectAnchoredDrawings: undefined,
    deferAnchoredDrawings: (pending) => {
      deferredRowAnchors.push(pending);
    },
  };
  const flushDeferred = (
    cells: readonly TableCellFragmentRecord[],
    rowTop: number,
    rowHeight: number
  ): void => {
    if (deferredRowAnchors.length === 0) return;
    if (publishAnchoredDrawings && !deps.anchorDeferOnly) {
      publishDeferredRowAnchors(deferredRowAnchors, cells, rowTop, rowHeight, deps);
    } else if (parentDefer) {
      for (const pending of deferredRowAnchors) parentDefer(pending);
    }
    deferredRowAnchors.length = 0;
  };
  return { rowDeps, flushDeferred };
}

function sumCols(cols: readonly number[], from: number, to: number): number {
  let sum = 0;
  for (let index = from; index < to && index < cols.length; index += 1) sum += cols[index]!;
  return sum;
}

function shiftBlocks(blocks: readonly BlockFragmentRecord[], dy: number): BlockFragmentRecord[] {
  if (dy === 0) return [...blocks];
  return blocks.map((block) => {
    if (block.kind === 'table') {
      return {
        ...block,
        box: { ...block.box, y: block.box.y + dy },
        rows: block.rows.map((row) => ({
          ...row,
          box: { ...row.box, y: row.box.y + dy },
          cells: row.cells.map((cell) => ({
            ...cell,
            box: { ...cell.box, y: cell.box.y + dy },
            blocks: shiftBlocks(cell.blocks, dy),
          })),
        })),
      };
    }
    return {
      ...block,
      box: { ...block.box, y: block.box.y + dy },
      ...(block.shadingBox
        ? { shadingBox: { ...block.shadingBox, y: block.shadingBox.y + dy } }
        : {}),
      ...(block.bottomBorder
        ? {
            bottomBorder: {
              ...block.bottomBorder,
              box: { ...block.bottomBorder.box, y: block.bottomBorder.box.y + dy },
            },
          }
        : {}),
      // Every `w:pBdr` stroke, not only the bottom one. vAlign moves the whole paragraph
      // down its cell; a frame left at the pre-shift y would sit above the text it encloses.
      ...(block.borders
        ? {
            borders: block.borders.map((strokeRecord) => ({
              ...strokeRecord,
              box: { ...strokeRecord.box, y: strokeRecord.box.y + dy },
            })),
          }
        : {}),
      ...(block.marker
        ? {
            marker: {
              ...block.marker,
              box: { ...block.marker.box, y: block.marker.box.y + dy },
            },
          }
        : {}),
      lines: block.lines.map((line) => ({
        ...line,
        box: { ...line.box, y: line.box.y + dy },
        spans: line.spans.map((span) => ({
          ...span,
          box: { ...span.box, y: span.box.y + dy },
        })),
        ...(line.drawings
          ? {
              drawings: line.drawings.map((drawing) => shiftInlineDrawingRecord(drawing, 0, dy)),
            }
          : {}),
      })),
    };
  });
}

/**
 * Place one paragraph's broken lines sequentially from `top`, producing a single fragment.
 *
 * The pending spans carry x offsets relative to the PARAGRAPH origin (that is what makes
 * the break cacheable across positions); placement shifts them by `originX` and stamps y,
 * exactly as body placement stamps `cursorY`.
 *
 * When `lineStart`/`maxBottom` are set, only lines that fit below `maxBottom` are placed and
 * the remainder line index is returned so a later page can continue the same paragraph.
 */
function placeCellParagraph(
  paragraph: OoxmlElement,
  originX: number,
  cellContentWidth: number,
  top: number,
  deps: TableFlowDeps,
  previousSpaceAfter: number,
  options?: {
    readonly lineStart?: number;
    readonly fragmentIndex?: number;
    readonly maxBottom?: number;
    /** When false, omit trailing paragraph spacing (more content follows on a later page). */
    readonly includeAfter?: boolean;
    /** When false, omit the bottom border (paragraph continues). */
    readonly includeBottomBorder?: boolean;
    /** What the table style says about this cell's paragraphs (17.7.6.6). */
    readonly tableCellStyle?: TableCellStyleFormatting;
  }
): {
  readonly fragment: ParagraphFragmentRecord | null;
  readonly bottom: number;
  readonly spaceAfter: number;
  readonly nextLineIndex: number;
  readonly complete: boolean;
  readonly fitted: boolean;
} {
  const paragraphId = paragraph.id;
  const listItem = deps.listItems?.get(paragraphId);
  const {
    props,
    indent,
    available,
    alignment,
    spacing,
    lineSpacing,
    bottomBorder,
    borders,
    shading,
    inheritedRunProperties,
    markRunProperties,
    tabStops: cascadedTabStops,
    tabStopsCacheToken: cascadedTabStopsCacheToken,
  } = resolveParagraphLayoutInputs(
    paragraph,
    cellContentWidth,
    deps.styleCascade,
    listItem,
    options?.tableCellStyle,
    true
  );
  // `w:defaultTabStop` lives in settings.xml, which the paragraph cascade never reads.
  const tabStops = withDefaultTabInterval(cascadedTabStops, deps.defaultTabStopPt);
  const tabStopsCacheToken =
    tabStops === cascadedTabStops ? cascadedTabStopsCacheToken : tabStopsFingerprint(tabStops);
  // A cell paragraph breaks like a body paragraph: same line spacing, same first-line
  // offset. Contextual spacing is a body-flow question (it compares document neighbours),
  // so it is not applied per cell.
  // A NUMBERED/BULLETED paragraph's first-line slot belongs to the MARKER: `listMarkerBox`
  // places it at `left - hanging`, and Word's `w:suff` puts the text back at `left` — or
  // after the marker, or at the next tab stop past an overflowing one (§17.9.30).
  const firstLineOffset = firstLineShift(listItem, indent, deps.measurer, tabStops, available);
  const rawZones = deps.pageExclusionZones?.() ?? Object.freeze([]);
  const paragraphOrder = deps.paragraphOrderIndex?.(paragraphId) ?? Number.MAX_SAFE_INTEGER;
  const filtered = deps.paragraphOrderIndex
    ? filterExclusionZonesForParagraphOrder(rawZones, paragraphOrder, (id) =>
        deps.paragraphOrderIndex?.(id)
      )
    : rawZones;
  const pageZones = localizeExclusionZones(filtered, originX, 0, {
    left: 0,
    right: indent.left + available + indent.right,
  });
  // Zone geometry alone does NOT identify the break: these zones stay in page-content Y
  // (only x is localized to the cell), so which band a line crosses depends on where the
  // paragraph starts. Two cells of the same text and width under the same float would
  // otherwise share a cache entry and the one that sits clear of the picture would inherit
  // the wrapped break of the one that does not.
  const exclusionToken = exclusionLayoutToken(pageZones);
  const positionedExclusionToken = exclusionToken ? `${top.toFixed(3)}|${exclusionToken}` : '';
  const key = paragraphLayoutKey({
    paragraph,
    properties: [
      ...props,
      ...inheritedRunProperties,
      ...markRunProperties,
      { localName: 'tabStops', attributes: { token: tabStopsCacheToken } },
      ...(listItem ? [{ localName: 'list', attributes: { token: listItem.cacheToken } }] : []),
    ],
    width: available,
    producer: deps.producer,
    ...(deps.drawingTokenForParagraph?.(paragraph)
      ? { drawingToken: deps.drawingTokenForParagraph(paragraph) }
      : deps.drawingLayoutToken
        ? { drawingToken: deps.drawingLayoutToken }
        : {}),
    ...(positionedExclusionToken ? { exclusionToken: positionedExclusionToken } : {}),
  });
  const lines = breakParagraph(
    paragraph,
    paragraphId,
    indent.left,
    available,
    deps.measurer,
    deps.cache,
    deps.cache ? key : null,
    inheritedRunProperties,
    tabStops,
    deps.pageContext,
    deps.styleCascade
      ? (inherited, direct) => cascadeRunProperties(inherited, direct, deps.styleCascade)
      : undefined,
    {
      lineSpacing,
      firstLineOffset,
      // A cell's own content box is the column a positional tab measures against.
      marginExtent: { left: 0, right: indent.left + available + indent.right },
      ...(deps.projectLink ? { projectLink: deps.projectLink } : {}),
      displayMode: deps.displayMode,
      ...(deps.noteMarks ? { noteMarks: deps.noteMarks } : {}),
      ...(deps.inlineDrawingLayout ? { inlineDrawingLayout: deps.inlineDrawingLayout } : {}),
      contentLeft: 0,
      contentRight: indent.left + available + indent.right,
      paragraphStartY: top,
      anchorCellBox: Object.freeze({
        x: 0,
        y: 0,
        width: indent.left + available + indent.right,
        height: Math.max(1, available),
      }),
      ...(pageZones.length > 0 ? { pageExclusionZones: pageZones } : {}),
      ...(deps.styleCascade ? { themeFonts: deps.styleCascade.themeFonts } : {}),
      markRunProperties,
    }
  );

  const lineStart = options?.lineStart ?? 0;
  const fragmentIndex = options?.fragmentIndex ?? 0;
  const maxBottom = options?.maxBottom ?? Number.POSITIVE_INFINITY;
  const includeAfter = options?.includeAfter ?? true;
  const includeBottomBorder = options?.includeBottomBorder ?? true;

  const appliedBefore =
    lineStart === 0 ? collapsedSpaceBefore(spacing.before, previousSpaceAfter) : 0;
  const fragmentX = originX + indent.left;
  // The top rule and its gap are flow height above the first line, exactly as the bottom rule
  // is flow height below the last — so the cell's content band has to reserve it or a boxed
  // paragraph's frame paints over the cell's own top border. Reserved on the FIRST fragment
  // only: a paragraph continued onto the next page opens once, the way it closes once.
  const topExtent = lineStart === 0 ? paragraphBorderExtentPt(borders.top) : 0;
  const records: LineRecord[] = [];
  let y = top + appliedBefore + topExtent;
  let nextLineIndex = lineStart;
  let fitted = false;

  for (let lineIndex = lineStart; lineIndex < lines.length; lineIndex += 1) {
    const pendingLine = lines[lineIndex]!;
    const isLastLine = lineIndex === lines.length - 1;
    const borderExtra =
      isLastLine && includeBottomBorder && bottomBorder ? paragraphBorderExtentPt(bottomBorder) : 0;
    const afterExtra = isLastLine && includeAfter ? spacing.after : 0;
    const skipBefore =
      pageZones.length > 0
        ? topAndBottomSkipBeforeLine(y, pendingLine.height, pageZones)
        : (pendingLine.exclusionSkipBefore ?? 0);
    const lineBottom = y + skipBefore + pendingLine.height + borderExtra + afterExtra;
    if (lineBottom > maxBottom + 0.001) {
      break;
    }
    y += skipBefore;
    const lineIndent = originX + indent.left + (lineIndex === 0 ? firstLineOffset : 0);
    const lineAvailableWidth = Math.max(1, available - (lineIndex === 0 ? firstLineOffset : 0));
    const placedSpans = pendingLine.spans.map((span) => ({
      ...span,
      range: { ...span.range, paragraphId },
      box: { ...span.box, x: span.box.x + originX, y },
    }));
    const alignedSpans = alignSpans(
      placedSpans,
      deps.measurer,
      lineIndent,
      lineAvailableWidth,
      alignment,
      isLastLine,
      alignment === 'center' || alignment === 'right' ? pendingLine.width : undefined
    );
    // Empty lines align too — see the body-flow twin in `semantic-layout.ts`.
    const alignOffset =
      placedSpans.length > 0 && alignedSpans.length > 0
        ? alignedSpans[0]!.box.x - placedSpans[0]!.box.x
        : alignment !== 'left' && alignment !== 'both'
          ? (() => {
              const slack = lineAvailableWidth - pendingLine.width;
              if (slack <= 0) return 0;
              return alignment === 'center' ? slack / 2 : slack;
            })()
          : 0;
    const cellClip = Object.freeze({
      x: originX,
      y: top,
      width: cellContentWidth,
      height: Math.max(0, maxBottom - top),
    });
    const alignedDrawings = alignDrawings(
      pendingLine.drawings.map((drawing) =>
        clipInlineDrawingRecordToRegion(
          Object.freeze({
            ...drawing,
            paragraphId,
            x: originX + drawing.x,
            advanceStart: originX + drawing.advanceStart,
            advanceEnd: originX + drawing.advanceEnd,
            y: y + drawing.y,
            paintBounds: Object.freeze({
              ...drawing.paintBounds,
              x: originX + drawing.paintBounds.x,
              y: y + drawing.paintBounds.y,
            }),
            hitBounds: Object.freeze({
              ...drawing.hitBounds,
              x: originX + drawing.hitBounds.x,
              y: y + drawing.hitBounds.y,
            }),
          }),
          cellClip
        )
      ),
      alignOffset
    );
    records.push({
      id: deps.nextLineId(paragraphId, pendingLine.start, lineIndex),
      range: { paragraphId, start: pendingLine.start, end: pendingLine.end },
      spans: alignedSpans,
      ...(alignedDrawings.length > 0 ? { drawings: alignedDrawings } : {}),
      box: {
        x: originX + indent.left,
        y,
        width: available,
        height: pendingLine.height,
      },
      contentX: alignedSpans[0]?.box.x ?? lineIndent + alignOffset,
      baseline: pendingLine.baseline,
      leading: pendingLine.leading,
      trailingSpacing: pendingLine.trailingSpacing,
      ...(pendingLine.deletedRanges ? { deletedRanges: pendingLine.deletedRanges } : {}),
    });
    y += pendingLine.height;
    nextLineIndex = lineIndex + 1;
    fitted = true;
  }

  if (!fitted) {
    return {
      fragment: null,
      bottom: top,
      spaceAfter: previousSpaceAfter,
      nextLineIndex: lineStart,
      complete: false,
      fitted: false,
    };
  }

  const complete = nextLineIndex >= lines.length;
  const linesTop = records[0]!.box.y;
  const linesBottom = y;
  // Every `w:pBdr` edge, in the paint order body flow publishes: open, close, sides, bar.
  //
  // `w:between` grouping (§17.3.1.24) is NOT applied inside a cell. Grouping is a decision
  // about a paragraph's NEIGHBOURS, and cell flow places one paragraph at a time with no
  // lookahead, so a run of identically bordered cell paragraphs each closes with its own
  // `w:bottom` — Word would draw one frame around the run.
  const strokes: ParagraphBorderStrokeRecord[] = [];
  let bottomBorderRecord: ParagraphBottomBorderRecord | undefined;
  let contentTop = linesTop;
  let contentBottom = linesBottom;
  // THE FOUR EDGES ARE ONE BOX — the same rule the body flow follows, and it has to be the
  // same here or one document paints the identical callout two ways depending on whether it
  // sits in a table cell or a header. The side rules stand outside the text column by their
  // own `w:space`, so horizontals drawn only across the column leave the frame open.
  // Stroke thickness uses the inflated compound band for `double`/etc. (shared with body).
  const leftStroke = borders.left ? paragraphBorderStrokeWidthPt(borders.left) : 0;
  const rightStroke = borders.right ? paragraphBorderStrokeWidthPt(borders.right) : 0;
  const boxLeft = borders.left ? fragmentX - borders.left.spacePt - leftStroke : fragmentX;
  const boxRight = borders.right
    ? fragmentX + available + borders.right.spacePt + rightStroke
    : fragmentX + available;
  const boxWidth = Math.max(boxRight - boxLeft, 0);
  if (topExtent > 0 && borders.top) {
    const topStroke = paragraphBorderStrokeWidthPt(borders.top);
    const ruleY = linesTop - borders.top.spacePt - topStroke;
    strokes.push({
      side: 'top',
      edge: borders.top,
      box: { x: boxLeft, y: ruleY, width: boxWidth, height: topStroke },
    });
    contentTop = ruleY;
  }
  if (complete && includeBottomBorder && bottomBorder) {
    const closeStroke = paragraphBorderStrokeWidthPt(bottomBorder);
    const ruleY = linesBottom + bottomBorder.spacePt;
    const box = {
      x: boxLeft,
      y: ruleY,
      width: boxWidth,
      height: closeStroke,
    };
    bottomBorderRecord = { edge: bottomBorder, box };
    strokes.push({ side: 'bottom', edge: bottomBorder, box });
    contentBottom = ruleY + closeStroke;
  }
  // Side rules run corner to corner of THIS fragment's frame. Horizontally they are
  // publish-only: Word draws them outside the text column and never re-breaks the lines for
  // them, which is why `available` above is untouched by a box.
  const sideHeight = Math.max(contentBottom - contentTop, 0);
  if (borders.left) {
    strokes.push({
      side: 'left',
      edge: borders.left,
      box: {
        x: fragmentX - borders.left.spacePt - leftStroke,
        y: contentTop,
        width: leftStroke,
        height: sideHeight,
      },
    });
  }
  if (borders.right) {
    strokes.push({
      side: 'right',
      edge: borders.right,
      box: {
        x: fragmentX + available + borders.right.spacePt,
        y: contentTop,
        width: rightStroke,
        height: sideHeight,
      },
    });
  }
  // `w:bar` is the change-bar rule beside the paragraph, not part of the frame — it runs the
  // text only and adds no flow height, so a barred cell paragraph is exactly as tall as a
  // bare one.
  if (borders.bar) {
    const barStroke = paragraphBorderStrokeWidthPt(borders.bar);
    strokes.push({
      side: 'bar',
      edge: borders.bar,
      box: {
        x: fragmentX - borders.bar.spacePt - barStroke,
        y: linesTop,
        width: barStroke,
        height: Math.max(linesBottom - linesTop, 0),
      },
    });
  }
  const appliedAfter = complete && includeAfter ? spacing.after : 0;
  const bottom = contentBottom + appliedAfter;
  // Shading fills the FRAME when there is one (a side rule is what makes it a box), and the
  // line area otherwise — the body flow's rule, stated once more for the cell lane.
  const shadingBox =
    shading === undefined
      ? undefined
      : borders.left || borders.right
        ? {
            x: boxLeft,
            y: contentTop,
            width: boxWidth,
            height: Math.max(contentBottom - contentTop, 0),
          }
        : paragraphShadingBox(records, fragmentX, available);
  // The paragraph MARK, on the fragment that finishes the paragraph — the cell lane publishes
  // it for the same reason the body lane does, and until it did, a tracked split or merge
  // inside a `w:tc` drew nothing at all: no pilcrow, no margin rule, no review card.
  //
  // Read only when this fragment will carry it. Placement runs for trial rows and for every
  // continuation, and the projection walks `w:pPr/w:rPr` each time it is asked.
  const showsMarkup = complete && deps.displayMode === 'all-markup';
  const markRevisions = showsMarkup ? paragraphMarkRevisionsOf(paragraph) : [];
  const markFormatRevision = showsMarkup ? paragraphMarkFormatRevisionOf(paragraph) : null;
  const marker =
    lineStart === 0
      ? publishListMarker(
          listItem,
          deps.measurer,
          records[0] ? { y: records[0].box.y, height: records[0].box.height } : undefined,
          originX
        )
      : undefined;

  const fragment = {
    kind: 'paragraph' as const,
    id: `${paragraphId}#f${fragmentIndex}`,
    paragraphId,
    fragmentIndex,
    range: {
      paragraphId,
      start: records[0]!.range.start,
      end: records[records.length - 1]!.range.end,
    },
    props,
    spacing: { before: appliedBefore, after: appliedAfter },
    indent,
    ...(bottomBorderRecord ? { bottomBorder: bottomBorderRecord } : {}),
    ...(strokes.length > 0 ? { borders: strokes } : {}),
    ...(shading === undefined ? {} : { shading }),
    ...(shadingBox === undefined ? {} : { shadingBox }),
    ...(marker ? { marker } : {}),
    ...markRevisionFields(markRevisions, markFormatRevision),
    lines: records,
    box: {
      x: fragmentX,
      y: top,
      width: available,
      height: bottom - top,
    },
  };

  if (deps.inlineDrawingLayout && deps.anchorFrameBase && deps.pageContentClip) {
    const cellBox = Object.freeze({
      x: originX,
      y: top,
      width: cellContentWidth,
      height: Math.max(0, maxBottom - top),
    });
    const paragraphBox = fragment.box;
    const publication = {
      paragraph,
      paragraphId,
      paragraphBox,
      lines: records,
    };
    if (deps.deferAnchoredDrawings) {
      deps.deferAnchoredDrawings({
        ...publication,
        cellOriginX: originX,
        cellContentWidth,
      });
    } else if (deps.collectAnchoredDrawings) {
      deps.collectAnchoredDrawings(
        publishAnchoredDrawingsForParagraph({
          paragraph,
          paragraphId,
          paragraphBox,
          lines: records,
          drawingLayout: deps.inlineDrawingLayout,
          frameBase: deps.anchorFrameBase(),
          columnBox: deps.columnBoxForParagraph?.(paragraphBox) ?? paragraphBox,
          cellBox,
          pageClip: deps.pageContentClip(),
          measurer: deps.measurer,
          ...(deps.layoutTextboxStoryFor ? { layoutTextboxStory: deps.layoutTextboxStoryFor } : {}),
        })
      );
    }
  }

  return {
    fragment,
    bottom,
    spaceAfter: appliedAfter,
    nextLineIndex,
    complete,
    fitted: true,
  };
}

/**
 * Flow blocks within [left, right] from `top`; returns the fragments and the bottom y.
 * No pagination — blocks stack. Used for table cells and for header/footer stories,
 * which is exactly what makes a header break like a cell: same breaker, same records.
 */
export function flowBlocksInBox(
  blocks: readonly OoxmlElement[],
  left: number,
  right: number,
  top: number,
  depth: number,
  deps: TableFlowDeps
): { readonly blocks: BlockFragmentRecord[]; readonly bottom: number } {
  const bounded = flowBlocksInBoxBounded(
    blocks,
    left,
    right,
    top,
    Number.POSITIVE_INFINITY,
    depth,
    deps,
    {
      blockIndex: 0,
      lineIndex: 0,
      previousSpaceAfter: 0,
      paragraphFragmentIndex: 0,
    }
  );
  return { blocks: bounded.blocks, bottom: bounded.bottom };
}

function flowBlocksInBoxBounded(
  blocks: readonly OoxmlElement[],
  left: number,
  right: number,
  top: number,
  maxBottom: number,
  depth: number,
  deps: TableFlowDeps,
  cursor: CellPlaceCursor,
  tableCellStyle?: TableCellStyleFormatting
): {
  readonly blocks: BlockFragmentRecord[];
  readonly bottom: number;
  readonly cursor: CellPlaceCursor;
  readonly complete: boolean;
  readonly fitted: boolean;
  readonly nestedSplitBlocked: boolean;
} {
  const fragments: BlockFragmentRecord[] = [];
  let y = top;
  let previousSpaceAfter = cursor.previousSpaceAfter;
  let blockIndex = cursor.blockIndex;
  let lineIndex = cursor.lineIndex;
  let paragraphFragmentIndex = cursor.paragraphFragmentIndex;
  let fitted = false;
  let nestedSplitBlocked = false;

  while (blockIndex < blocks.length) {
    const block = blocks[blockIndex]!;
    if (block.kind === 'table') {
      if (lineIndex !== 0) {
        // Should not happen — tables are whole blocks.
        lineIndex = 0;
      }
      previousSpaceAfter = 0;
      // Nested tables are atomic across row splits: place wholly or stop before them.
      const nested = emitNestedTable(block, left, right, y, depth + 1, deps);
      if (!nested) {
        blockIndex += 1;
        continue;
      }
      if (nested.bottom > maxBottom + 0.001) {
        // Stop before the nested table. If nothing fitted yet on a fresh band, the caller
        // treats this as an unsplittable overheight once page moves are exhausted.
        nestedSplitBlocked = !fitted;
        break;
      }
      fragments.push(nested.fragment);
      y = nested.bottom;
      fitted = true;
      blockIndex += 1;
      lineIndex = 0;
      continue;
    }
    if (block.kind !== 'paragraph') {
      blockIndex += 1;
      lineIndex = 0;
      continue;
    }

    const placed = placeCellParagraph(
      block,
      left,
      Math.max(1, right - left),
      y,
      deps,
      previousSpaceAfter,
      {
        lineStart: lineIndex,
        fragmentIndex: paragraphFragmentIndex,
        maxBottom,
        includeAfter: true,
        includeBottomBorder: true,
        ...(tableCellStyle ? { tableCellStyle } : {}),
      }
    );
    if (!placed.fitted || !placed.fragment) {
      break;
    }
    fragments.push(placed.fragment);
    y = placed.bottom;
    fitted = true;
    if (placed.complete) {
      previousSpaceAfter = placed.spaceAfter;
      blockIndex += 1;
      lineIndex = 0;
      paragraphFragmentIndex = 0;
    } else {
      // Paragraph continues on the next page.
      return {
        blocks: fragments,
        bottom: y,
        cursor: {
          blockIndex,
          lineIndex: placed.nextLineIndex,
          previousSpaceAfter: 0,
          paragraphFragmentIndex: paragraphFragmentIndex + 1,
        },
        complete: false,
        fitted: true,
        nestedSplitBlocked: false,
      };
    }
  }

  return {
    blocks: fragments,
    bottom: y,
    cursor: {
      blockIndex,
      lineIndex,
      previousSpaceAfter,
      paragraphFragmentIndex,
    },
    complete: blockIndex >= blocks.length,
    fitted,
    nestedSplitBlocked,
  };
}

function contentInsets(
  margins: CellMarginsPt,
  borders: SemanticTableCell['borders']
): {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
} {
  // Border extents shrink the content box (border-box model) so thick rules do not cover text.
  return {
    top: margins.top + borderExtentPt(borders.top),
    right: margins.right + borderExtentPt(borders.right),
    bottom: margins.bottom + borderExtentPt(borders.bottom),
    left: margins.left + borderExtentPt(borders.left),
  };
}

function suppressSplitBorders(
  borders: CellBorderBox,
  omitTop: boolean,
  omitBottom: boolean
): CellBorderBox {
  return {
    top: omitTop ? { state: 'none' } : borders.top,
    left: borders.left,
    bottom: omitBottom ? { state: 'none' } : borders.bottom,
    right: borders.right,
  };
}

/** Clone a structure row with top/bottom borders suppressed for mid-row page cuts. */
export function rowWithSplitBorders(
  row: SemanticTableRow,
  omitTop: boolean,
  omitBottom: boolean
): SemanticTableRow {
  if (!omitTop && !omitBottom) return row;
  return {
    ...row,
    cells: row.cells.map((cell) => ({
      ...cell,
      borders: suppressSplitBorders(cell.borders, omitTop, omitBottom),
    })),
  };
}

/**
 * Lay out one row at `rowTop`: flow every cell, size the row to its tallest cell, emit
 * every cell box at that height. `left` is the table's left edge (page-content-relative),
 * threaded through directly so nested content never needs shifting after the fact.
 * Returns the record and the row's bottom y.
 */
export function layoutRowFragment(
  row: SemanticTableRow,
  cols: readonly number[],
  left: number,
  rowTop: number,
  isHeaderRepeat: boolean,
  depth: number,
  deps: TableFlowDeps,
  cellSpacingPt = 0
): { readonly record: TableRowFragmentRecord; readonly bottom: number } {
  const placed = layoutRowFragmentBounded(
    row,
    cols,
    left,
    rowTop,
    Number.POSITIVE_INFINITY,
    isHeaderRepeat,
    false,
    depth,
    deps,
    initialCellCursors(row),
    cellSpacingPt
  );
  return { record: placed.record, bottom: placed.bottom };
}

export interface LayoutRowBoundedResult {
  readonly record: TableRowFragmentRecord;
  readonly bottom: number;
  /** Remaining cell cursors when the row did not finish; null when complete. */
  readonly remainder: CellPlaceCursor[] | null;
  /** True when at least one cell placed a line or nested block in this fragment. */
  readonly fitted: boolean;
  /**
   * True when a nested table blocked a safe split (would need to cut through nested
   * geometry). Callers must fail closed rather than overflow.
   */
  readonly nestedSplitBlocked: boolean;
}

/**
 * Height-budgeted row layout for pagination. Content stays at or above `rowTop` and at or
 * below `maxBottom`. Cells that cannot place anything leave empty boxes; callers decide
 * whether to move the row, continue splitting, or fail closed.
 *
 * `w:trHeight` (17.4.81):
 * - `auto` — content-sized (no invented floor);
 * - `atLeast` — floor the finished fragment to the authored minimum when it fits the
 *   budget; mid-row page splits stay content-driven so the floor cannot overflow the page;
 * - `exact` — fixed height, content clipped (Word 17.18.37). Overflow is not continued.
 */
export function layoutRowFragmentBounded(
  row: SemanticTableRow,
  cols: readonly number[],
  left: number,
  rowTop: number,
  maxBottom: number,
  isHeaderRepeat: boolean,
  isContinuation: boolean,
  depth: number,
  deps: TableFlowDeps,
  cursors: readonly CellPlaceCursor[],
  cellSpacingPt = 0
): LayoutRowBoundedResult {
  const total = sumCols(cols, 0, cols.length);
  // `w:tblCellSpacing`: each cell gives up half of every gap it shares with a neighbour.
  // `w:tblCellSpacing` (17.4.45) separates ADJACENT cell edges, so each of the two cells
  // sharing a gap gives up half of it. Applied inside the grid slot rather than by widening
  // the table, which keeps every column boundary, border interval and hit box where the
  // resolved grid put it.
  const gap = Number.isFinite(cellSpacingPt) && cellSpacingPt > 0 ? cellSpacingPt / 2 : 0;
  const defaultLineHeight = deps.measurer.lineMetrics(DEFAULT_RUN_STYLE).height;
  const heightRule = row.height;
  const exactHeightPt = heightRule.rule === 'exact' ? heightRule.valuePt : undefined;
  const atLeastHeightPt = heightRule.rule === 'atLeast' ? heightRule.valuePt : undefined;
  const deferredRowAnchors: DeferredRowAnchor[] = [];
  const { rowDeps, flushDeferred } = rowDepsForAnchors(deps, deferredRowAnchors);
  const flowDeps: TableFlowDeps =
    isHeaderRepeat && deps.pageOccurrenceKey
      ? {
          ...rowDeps,
          nextLineId: (paragraphId, start, lineIndex) =>
            rowDeps.nextLineId(paragraphId, start, lineIndex, deps.pageOccurrenceKey!()),
        }
      : rowDeps;
  // Exact rows clip to their authored box; never flow past it even when the page allows more.
  const flowMaxBottom =
    exactHeightPt === undefined
      ? maxBottom
      : Math.min(maxBottom, rowTop + Math.max(0, exactHeightPt));

  interface FlowedCell {
    readonly cell: SemanticTableCell;
    readonly x: number;
    readonly width: number;
    readonly gridColumn: number;
    readonly blocks: readonly BlockFragmentRecord[];
    readonly contentTop: number;
    readonly contentBottom: number;
    readonly insets: { top: number; right: number; bottom: number; left: number };
    readonly nextCursor: CellPlaceCursor;
    readonly complete: boolean;
    readonly fitted: boolean;
    readonly nestedSplitBlocked: boolean;
  }
  const flowed: FlowedCell[] = [];
  let anyFitted = false;
  let anyNestedBlocked = false;
  // Grow from the row top. Empty / vMerge-continue cells contribute one default line plus
  // THEIR authored insets below; fitted cells contribute measured content only. Seeding with
  // `defaultLineHeight + 2 * CELL_PAD` used to force ~20pt rows even when tcMar was tighter
  // and the cell's own line was shorter — nested tables picked that up as blank bottom pad.
  let rowBottom = rowTop;

  for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
    const cell = row.cells[cellIndex]!;
    const cursor = cursors[cellIndex] ?? {
      blockIndex: 0,
      lineIndex: 0,
      previousSpaceAfter: 0,
      paragraphFragmentIndex: 0,
    };
    // The grid column is decided once, at read time, where `w:gridBefore` is known and the
    // row's TOTAL span is bounded (a row of maximum-span cells would otherwise walk millions
    // of grid intervals in the border pass). Never re-derived by accumulating spans here.
    const span = cell.gridSpan;
    const gridColumn = cell.gridColumn;
    const slotX = left + sumCols(cols, 0, gridColumn);
    const slotW = sumCols(cols, gridColumn, Math.min(gridColumn + span, cols.length)) || total;
    // Never let the gap consume the cell: a spacing wider than the column keeps a hairline.
    const inset = Math.min(gap, Math.max((slotW - MIN_CELL_BOX_PT) / 2, 0));
    const cellX = slotX + inset;
    const cellW = Math.max(slotW - 2 * inset, MIN_CELL_BOX_PT);
    const insets = contentInsets(cell.margins, cell.borders);
    const topInset = isContinuation ? borderExtentPt(cell.borders.top) : insets.top;
    const contentTop = rowTop + topInset;
    // Always reserve bottom inset so the fragment never paints into the margin/border band.
    const contentMaxBottom = flowMaxBottom - insets.bottom;

    let blocks: readonly BlockFragmentRecord[] = [];
    let contentBottom = contentTop;
    let nextCursor = cursor;
    let complete = true;
    let fitted = false;
    let nestedSplitBlocked = false;

    if (!cell.vMergeContinue) {
      if (contentMaxBottom < contentTop + 0.001) {
        complete = cursor.blockIndex >= cell.blocks.length;
      } else {
        const flow = flowBlocksInBoxBounded(
          cell.blocks,
          cellX + insets.left,
          cellX + cellW - insets.right,
          contentTop,
          contentMaxBottom,
          depth,
          flowDeps,
          cursor,
          cell.styleFormatting
        );
        blocks = flow.blocks;
        contentBottom = flow.bottom;
        nextCursor = flow.cursor;
        complete = flow.complete;
        fitted = flow.fitted;
        nestedSplitBlocked = flow.nestedSplitBlocked;
        if (fitted) anyFitted = true;
        if (nestedSplitBlocked) anyNestedBlocked = true;
      }
    }

    // Fitted content owns the height (including its final paragraph's spaceAfter). Do not
    // re-floor with defaultLineHeight — that invented bottom pad when the measured line was
    // shorter than the DEFAULT_RUN_STYLE line. Empty / continue cells still need one line.
    const cellBottom = Math.min(
      flowMaxBottom,
      fitted ? contentBottom + insets.bottom : rowTop + topInset + defaultLineHeight + insets.bottom
    );
    if (cellBottom > rowBottom) rowBottom = cellBottom;

    flowed.push({
      cell,
      x: cellX,
      width: cellW,
      gridColumn,
      blocks,
      contentTop,
      contentBottom,
      insets: { ...insets, top: topInset },
      nextCursor,
      complete: cell.vMergeContinue ? true : complete,
      fitted,
      nestedSplitBlocked,
    });
  }

  // Coordinate fragment height: tallest placed content, never past the flow budget.
  rowBottom = Math.min(flowMaxBottom, Math.max(rowBottom, rowTop));
  for (const entry of flowed) {
    const needed = entry.fitted
      ? entry.contentBottom + entry.insets.bottom
      : rowTop + entry.insets.top + defaultLineHeight + entry.insets.bottom;
    if (needed > rowBottom && needed <= flowMaxBottom + 0.001) {
      rowBottom = needed;
    }
  }
  rowBottom = Math.min(flowMaxBottom, rowBottom);

  // Exact: force the authored height (clamped to the page budget) and clip leftover content.
  // atLeast: floor a finished fragment when the minimum fits; never push past maxBottom.
  let clipExact = false;
  if (exactHeightPt !== undefined) {
    const exactBottom = rowTop + exactHeightPt;
    if (exactBottom <= maxBottom + 0.001) {
      rowBottom = exactBottom;
      clipExact = true;
    } else {
      // Exact taller than remaining band — keep content-sized clamp; pagination fails closed.
      rowBottom = Math.min(maxBottom, rowBottom);
    }
  } else if (atLeastHeightPt !== undefined) {
    const minBottom = rowTop + atLeastHeightPt;
    const contentComplete = flowed.every((entry) => entry.complete);
    if (contentComplete && minBottom <= maxBottom + 0.001) {
      if (minBottom > rowBottom) rowBottom = minBottom;
    }
  }
  rowBottom = Math.min(maxBottom, rowBottom);
  const rowHeight = Math.max(0, rowBottom - rowTop);

  const cells: TableCellFragmentRecord[] = flowed.map((entry) => {
    let blocks = entry.blocks;
    // vAlign only when the cell finished on this fragment (no more continuation).
    const cellComplete = clipExact ? true : entry.complete;
    if (
      !entry.cell.vMergeContinue &&
      cellComplete &&
      entry.cell.vAlign !== 'top' &&
      blocks.length > 0
    ) {
      const contentHeight = entry.contentBottom - entry.contentTop;
      const available = rowHeight - entry.insets.top - entry.insets.bottom - contentHeight;
      if (available > 0) {
        const dy = entry.cell.vAlign === 'center' ? available / 2 : available;
        blocks = shiftBlocks(blocks, dy);
      }
    }
    return {
      id: entry.cell.id,
      gridColumn: entry.gridColumn,
      ...(entry.cell.gridColumnId ? { gridColumnId: entry.cell.gridColumnId } : {}),
      gridSpan: entry.cell.gridSpan,
      vMergeContinue: entry.cell.vMergeContinue,
      ...(entry.cell.vMergeContinue ? { paintInert: true as const } : {}),
      rowSpan: 1,
      ...(entry.cell.shading === undefined ? {} : { shading: entry.cell.shading }),
      blocks,
      box: { x: entry.x, y: rowTop, width: entry.width, height: rowHeight },
    };
  });

  // Exact clips: leftover cell content is not continued onto the next page (17.18.37).
  const remainderCursors = clipExact
    ? null
    : flowed.every((entry) => entry.complete)
      ? null
      : flowed.map((entry) => entry.nextCursor);
  const complete = clipExact || flowed.every((entry) => entry.complete);

  flushDeferred(cells, rowTop, rowHeight);

  return {
    record: {
      id: row.id,
      ...(row.revisionKind ? { revisionKind: row.revisionKind } : {}),
      ...(row.revisionId !== undefined ? { revisionId: row.revisionId } : {}),
      ...(row.revisionAuthor !== undefined ? { revisionAuthor: row.revisionAuthor } : {}),
      ...(row.revisionDate !== undefined ? { revisionDate: row.revisionDate } : {}),
      rowIndex: 0,
      isHeaderRepeat,
      ...(isContinuation ? { isContinuation: true as const } : {}),
      cells,
      box: { x: left, y: rowTop, width: total, height: rowHeight },
    },
    bottom: rowBottom,
    remainder: complete ? null : remainderCursors,
    fitted: anyFitted || row.cells.every((cell) => cell.vMergeContinue) || clipExact,
    nestedSplitBlocked: anyNestedBlocked,
  };
}

/**
 * Measure the natural height of a full (unsplit) row without allocating line ids.
 * Used for whole-row preflight before committing placement.
 */
function stripAnchorSinksForProbe(deps: TableFlowDeps): TableFlowDeps {
  return {
    ...deps,
    collectAnchoredDrawings: undefined,
    publishAnchoredDrawings: undefined,
    deferAnchoredDrawings: undefined,
    onAnchorRepublish: undefined,
    onAnchorShift: undefined,
    anchorDeferOnly: true,
  };
}

/**
 * The row's height on its own, with no page position — what the caller compares against a
 * fresh content box to decide whether the row fits where it stands or has to move.
 *
 * The probe places the row at y=0 because that height must not depend on where the row
 * currently sits. Wrap exclusions are the opposite: they are page-content bands, so at y=0
 * a float near the top of the page covers a row that really sits far below it, and every
 * cell paragraph breaks around a picture it never touches. The probe therefore measures
 * free of them — the placing pass runs at the row's true top and applies whichever bands
 * actually cross it.
 */
export function measureRowHeight(
  row: SemanticTableRow,
  cols: readonly number[],
  left: number,
  depth: number,
  deps: TableFlowDeps,
  cellSpacingPt = 0
): number {
  let lineCounter = 0;
  const probeDeps: TableFlowDeps = {
    ...stripAnchorSinksForProbe(deps),
    pageExclusionZones: undefined,
    nextLineId: () => `probe-${lineCounter++}`,
  };
  const placed = layoutRowFragment(row, cols, left, 0, false, depth, probeDeps, cellSpacingPt);
  return placed.record.box.height;
}

/**
 * After all rows of a table fragment are placed: expand vMerge restart boxes, re-apply
 * vAlign over the full span, and publish collapsed border edges.
 */
export function finalizeTableRows(
  rows: readonly TableRowFragmentRecord[],
  structure: SemanticTableStructure,
  sourceRows: readonly SemanticTableRow[],
  ownershipBudget?: TableBorderOwnershipBudget,
  vMergeBudget?: TableVMergeResolveBudget,
  vMergeWork?: TableVMergeResolveWork,
  onAnchorShift?: (paragraphId: string, dy: number) => void,
  anchorDeps?: TableFlowDeps
): TableRowFragmentRecord[] {
  if (rows.length === 0) return [];

  // Map laid-out cells back to authored structure cells (same order within each row).
  const authoredById = new Map<string, SemanticTableCell>();
  for (const row of sourceRows) {
    for (const cell of row.cells) authoredById.set(cell.id, cell);
  }

  // One-pass column-keyed merge spans — O(cells), not O(rows × columns²). These rows are
  // one PAGE FRAGMENT: a merge whose restart was placed on an earlier page is headed here
  // by its continuation copy, which is why that copy comes back keyed in the span map.
  const mergeSpanById = resolveVMergeSpans(rows, vMergeWork, vMergeBudget, {
    pageFragment: true,
  });

  // Expand restart heights and shift content for vAlign over the full span.
  const expanded: TableRowFragmentRecord[] = rows.map((row, rowIndex) => ({
    ...row,
    cells: row.cells.map((cell) => {
      const resolvedSpan = mergeSpanById.get(cell.id);
      if (cell.vMergeContinue && resolvedSpan === undefined) {
        return { ...cell, paintInert: true, rowSpan: 1, borders: {}, blocks: [] };
      }
      // A carried-in continuation paints like the restart it continues: Word draws the
      // merged cell's rules, fill and box on every page the merge crosses. Its content
      // stayed with the restart on the earlier page, so `blocks` is empty either way.
      const carried = cell.vMergeContinue;
      const span = resolvedSpan ?? 1;
      let height = cell.box.height;
      if (span > 1) {
        const last = rows[rowIndex + span - 1]!;
        height = last.box.y + last.box.height - cell.box.y;
      }
      const authored = authoredById.get(cell.id);
      let blocks = cell.blocks;
      if (authored && authored.vAlign !== 'top' && blocks.length > 0) {
        const insets = contentInsets(authored.margins, authored.borders);
        // Content was placed relative to the first row; measure current content band.
        let contentTop = Number.POSITIVE_INFINITY;
        let contentBottom = Number.NEGATIVE_INFINITY;
        for (const block of blocks) {
          contentTop = Math.min(contentTop, block.box.y);
          contentBottom = Math.max(contentBottom, block.box.y + block.box.height);
        }
        if (Number.isFinite(contentTop) && Number.isFinite(contentBottom)) {
          const available = height - insets.top - insets.bottom - (contentBottom - contentTop);
          // Reset any per-row shift by measuring from cell top + inset.
          const desiredTop =
            cell.box.y +
            insets.top +
            (available > 0 ? (authored.vAlign === 'center' ? available / 2 : available) : 0);
          const dy = desiredTop - contentTop;
          if (Math.abs(dy) > 0.001) {
            blocks = shiftBlocks(blocks, dy);
            for (const block of blocks) {
              if (block.kind === 'paragraph') onAnchorShift?.(block.paragraphId, dy);
            }
          }
        }
      }
      const finalizedCellBox = Object.freeze({
        x: cell.box.x,
        y: cell.box.y,
        width: cell.box.width,
        height,
      });
      if (
        authored &&
        anchorDeps &&
        (span > 1 || (authored.vAlign !== 'top' && blocks.length > 0))
      ) {
        republishAnchoredParagraphsInBlocks(blocks, authored.blocks, finalizedCellBox, anchorDeps);
      }
      return {
        ...cell,
        ...(carried ? { vMergeContinue: false, paintInert: false } : {}),
        rowSpan: span,
        blocks,
        box: { ...cell.box, height },
      };
    }),
  }));

  // Border grid from authored structure (same row/cell order as laid-out fragment rows).
  // Header repeats use the same authored header row; match by cell id.
  const gridRows: BorderGridCell[][] = expanded.map((row) =>
    row.cells.map((cell) => {
      const authored = authoredById.get(cell.id);
      return {
        gridColumn: cell.gridColumn,
        gridSpan: cell.gridSpan,
        vMergeContinue: cell.vMergeContinue,
        borders: authored?.borders ?? {
          top: { state: 'omitted' as const },
          left: { state: 'omitted' as const },
          bottom: { state: 'omitted' as const },
          right: { state: 'omitted' as const },
        },
        mergeRowSpan: cell.rowSpan ?? 1,
      };
    })
  );

  const columnCount = structure.columnWidthsPt.length;
  const tableBorders: TableBorderBox = structure.tableBorders;
  const geometry: BorderGridGeometry = {
    columnWidthsPt: structure.columnWidthsPt,
    rowBands: expanded.map((row) => ({ y: row.box.y, height: row.box.height })),
    cellBoxes: expanded.map((row) =>
      row.cells.map((cell) => ({ width: cell.box.width, height: cell.box.height }))
    ),
  };
  const resolved = resolveTableCellBorderGrid(
    gridRows,
    tableBorders,
    columnCount,
    geometry,
    undefined,
    ownershipBudget
  );

  return expanded.map((row, rowIndex) => ({
    ...row,
    cells: row.cells.map((cell, cellIndex) => {
      const borders = resolved[rowIndex]![cellIndex]!;
      if (cell.paintInert || cell.vMergeContinue) {
        return { ...cell, borders: {}, paintInert: true };
      }
      return { ...cell, borders };
    }),
  }));
}

/**
 * A nested table inside a cell: laid out with its own geometry, no pagination, one
 * fragment. Returns null past the nesting ceiling — the cell renders empty rather than
 * recursing without bound.
 */
function emitNestedTable(
  table: OoxmlElement,
  left: number,
  right: number,
  top: number,
  depth: number,
  deps: TableFlowDeps
): { readonly fragment: TableFragmentRecord; readonly bottom: number } | null {
  if (depth >= MAX_TABLE_NESTING) return null;
  const containerWidth = Math.max(1, right - left);
  const structure = readTableStructure(
    table,
    containerWidth,
    depth,
    deps.styleCascade,
    deps.displayMode
  );
  if (!structure || structure.rows.length === 0) return null;
  const nestedDeferred: DeferredRowAnchor[] = [];
  const nestedFlowDeps: TableFlowDeps = {
    ...deps,
    publishAnchoredDrawings: undefined,
    collectAnchoredDrawings: undefined,
    anchorDeferOnly: true,
    deferAnchoredDrawings: (pending) => {
      nestedDeferred.push(pending);
    },
  };
  // A nested table is placed inside its CELL's content box by the same rules a top-level one
  // is placed inside the text column.
  const tableLeft = left + tableOriginX(structure, containerWidth);
  const rawRows: TableRowFragmentRecord[] = [];
  let y = top;
  for (const row of structure.rows) {
    const placed = layoutRowFragment(
      row,
      structure.columnWidthsPt,
      tableLeft,
      y,
      false,
      depth,
      nestedFlowDeps,
      structure.cellSpacingPt
    );
    rawRows.push(placed.record);
    y = placed.bottom;
  }
  const rows = finalizeTableRows(
    rawRows,
    structure,
    structure.rows,
    deps.borderOwnershipBudget,
    deps.vMergeResolveBudget,
    undefined,
    undefined,
    undefined
  );
  for (const pending of nestedDeferred) {
    for (const row of rows) {
      const hostsParagraph = row.cells.some((cell) =>
        cell.blocks.some(
          (block) => block.kind === 'paragraph' && block.paragraphId === pending.paragraphId
        )
      );
      if (!hostsParagraph) continue;
      publishDeferredRowAnchors([pending], row.cells, row.box.y, row.box.height, deps);
      break;
    }
  }
  const width = sumCols(structure.columnWidthsPt, 0, structure.columnWidthsPt.length);
  const rowOrdinals = new Map<string, number>();
  return {
    fragment: annotateTableFragmentGeometry(
      {
        kind: 'table',
        id: `${table.id}#f0`,
        tableId: table.id,
        fragmentIndex: 0,
        rows,
        box: { x: tableLeft, y: top, width, height: y - top },
      },
      structure.columnWidthsPt,
      depth,
      rowOrdinals
    ),
    bottom: y,
  };
}

/** Lay out every row of a structure (no pagination) and finalize merges/borders. */
export function layoutTableFragment(
  structure: SemanticTableStructure,
  left: number,
  top: number,
  fragmentIndex: number,
  tableId: string,
  depth: number,
  deps: TableFlowDeps,
  isHeaderRepeat: (row: SemanticTableRow) => boolean = () => false
): { readonly fragment: TableFragmentRecord; readonly bottom: number } {
  const rawRows: TableRowFragmentRecord[] = [];
  let y = top;
  for (const row of structure.rows) {
    const placed = layoutRowFragment(
      row,
      structure.columnWidthsPt,
      left,
      y,
      isHeaderRepeat(row),
      depth,
      deps,
      structure.cellSpacingPt
    );
    rawRows.push(placed.record);
    y = placed.bottom;
  }
  const rows = finalizeTableRows(
    rawRows,
    structure,
    structure.rows,
    deps.borderOwnershipBudget,
    deps.vMergeResolveBudget
  );
  const width = sumCols(structure.columnWidthsPt, 0, structure.columnWidthsPt.length);
  const rowOrdinals = new Map<string, number>();
  return {
    fragment: annotateTableFragmentGeometry(
      {
        kind: 'table',
        id: `${tableId}#f${fragmentIndex}`,
        tableId,
        fragmentIndex,
        rows,
        box: { x: left, y: top, width, height: y - top },
      },
      structure.columnWidthsPt,
      depth,
      rowOrdinals
    ),
    bottom: y,
  };
}
