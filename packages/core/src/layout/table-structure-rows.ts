// The per-row passes of a table structure read (`semantic-table.ts`): each row's grid plan and
// its resolved cells.
//
// Both passes are pure functions of the row node and a few facts about its place. The tree is
// persistent, so a row an edit leaves alone keeps its node, and each pass returns that row's
// earlier result by identity. A row edit then resolves only the rows it changes and the rows
// whose place changed: a new header block, a new last row, a row band that moved, or a merge
// that now reaches them. Later passes can compare rows by identity (`table-row-range.ts`).

import {
  flattenContentControls,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { hiddenRowCollapses } from './table-hidden-row.ts';
import { readConditionalCellBorders } from './conditional-cell-borders.ts';
import {
  revisionCellMetadata,
  wmlRevisionChild,
  wmlRevisionAttribute,
} from './revision-cell-shading.ts';
import {
  readFlag,
  readGridSkip,
  readGridSpan,
  readRowHeight,
  exactRowHeightWithBottomMargin,
  readVMerge,
} from './table-row-properties.ts';
import {
  revisionNodeIncluded,
  revisionNodeProjectionMode,
  type RevisionAttribution,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import { mergedFlowBlocks } from './story-roots.ts';
import type {
  TableCellStyleFormatting,
  CascadedTableFormatting as TableFormatting,
} from './style-cascade.ts';
import { mergeCellBorders, mergeCellDiagonalBorders } from './table-border-cascade.ts';
import {
  EMPTY_CELL_BORDER_BOX,
  readCellBorders,
  rowExceptionBorders,
  type TableBorderBox,
} from './table-borders.ts';
import {
  AUTO_PREFERRED_WIDTH,
  MAX_TABLE_COLUMNS,
  readPreferredWidth,
  type CellWidthClaim,
  type PreferredWidth,
} from './table-widths.ts';
import {
  mergeMargins,
  raiseRowTopMargins,
  readMarginSides,
  rowExceptionMargins,
  type CellMarginsPt,
} from './table-cell-margins.ts';
import { readCellTextDirection } from './table-cell-text-direction.ts';
import { readStatedCellVerticalAlign } from './table-cell-vertical-align.ts';
import {
  conditionalLeadingMarginGrowthPt,
  rowStyleCellMargins,
  styleCellVerticalAlign,
} from './table-style-cell-properties.ts';
import { tableRowIsHeader } from './table-row-header-style.ts';
import { cellIgnoresEndMark, cellNoWrap } from './table-cell-hide-mark.ts';
import { rowExceptionAlignment } from './legacy-row-placement.ts';
import { conditionalTypesFor, type TableLook } from './table-conditional-formats.ts';
import { cellShading } from './table-cell-shading.ts';
import { wmlChildNamed as childNamed } from '../store/store/tree-op-table-shared.ts';
import type { SemanticTableCell, SemanticTableRow } from './semantic-table.ts';

const LAST_GRID_COLUMN = MAX_TABLE_COLUMNS - 1;

let reuse = true;

/**
 * @internal Run `read` with every row resolved again, as the first read of a table does. Tests
 * compare a read that reuses rows with one that does not.
 */
export function withoutTableRowReuse<T>(read: () => T): T {
  const before = reuse;
  reuse = false;
  try {
    return read();
  } finally {
    reuse = before;
  }
}

let counts: { reusedRows: number; windows: number } | null = null;

/** @internal Counts rows a read took from an earlier one, and windowed passes, for tests. */
export function tableRowReuseTestRecorder(): {
  readonly reusedRows: number;
  readonly windows: number;
  dispose(): void;
} {
  const own = { reusedRows: 0, windows: 0 };
  counts = own;
  return {
    get reusedRows() {
      return own.reusedRows;
    },
    get windows() {
      return own.windows;
    },
    dispose() {
      if (counts === own) counts = null;
    },
  };
}

/** @internal Count one windowed pass (`table-row-range.ts`). */
export function noteRowWindow(): void {
  if (counts) counts.windows += 1;
}

/** @internal Whether a structure read may return rows from an earlier read. */
export function tableRowReuseEnabled(): boolean {
  return reuse;
}

/**
 * Tables with fewer rows read whole each time. Reading 100 rows takes about 2 ms, and keeping
 * their rows would hold a second copy of every short table in a long document.
 */
let reusedTableRows = 100;

/** @internal Reuse the rows of tables from `rows` rows up, for tests of short tables. */
export function reuseTableRowsFromForTests(rows: number): () => void {
  const before = reusedTableRows;
  reusedTableRows = rows;
  return () => {
    reusedTableRows = before;
  };
}

/** Run `read` with rows reused and kept only when the table has `rows` rows or more. */
export function withTableRowReuseFor<T>(rows: number, read: () => T): T {
  return rows >= reusedTableRows ? read() : withoutTableRowReuse(read);
}

/** One authored row's place in the grid, read before any conditional format applies. */
export interface TableRowPlan {
  readonly node: OoxmlElement;
  readonly revision: OoxmlElement | undefined;
  readonly changeSites: readonly RevisionAttribution[] | undefined;
  /** The row's cells with any `CT_SdtCell` wrapper unwrapped, so both passes see one list. */
  readonly cells: readonly OoxmlNode[];
  readonly properties: OoxmlElement | undefined;
  readonly starts: readonly number[];
  readonly spans: readonly number[];
  readonly preferred: readonly PreferredWidth[];
  readonly gridColumns: number;
  /** Where the row's last cell ends, before `w:gridAfter`. */
  readonly cellEnd: number;
  /** The width claims of the row's skipped columns and cells, in grid order. */
  readonly claims: readonly CellWidthClaim[];
}

interface PlanMemo {
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: RevisionAuthorFilter | undefined;
  /** Null when the view omits the row. */
  readonly plan: TableRowPlan | null;
}
const plans = new WeakMap<OoxmlNode, PlanMemo>();

/** The grid plan of `rowNode`, or null when the view omits the row. */
export function planTableRow(
  rowNode: OoxmlElement,
  displayMode: RevisionDisplayMode,
  authorFilter: RevisionAuthorFilter | undefined
): TableRowPlan | null {
  const known = reuse ? plans.get(rowNode) : undefined;
  if (known && known.displayMode === displayMode && known.authorFilter === authorFilter)
    return known.plan;
  const plan = readRowPlan(rowNode, displayMode, authorFilter);
  if (reuse) plans.set(rowNode, { displayMode, authorFilter, plan });
  return plan;
}

function readRowPlan(
  rowNode: OoxmlElement,
  displayMode: RevisionDisplayMode,
  authorFilter: RevisionAuthorFilter | undefined
): TableRowPlan | null {
  const properties = wmlRevisionChild(rowNode, 'trPr');
  const authoredRevision = properties
    ? (wmlRevisionChild(properties, 'ins') ?? wmlRevisionChild(properties, 'del'))
    : undefined;
  const revisionKind = authoredRevision?.localName;
  const revisionAuthor = authoredRevision
    ? (wmlRevisionAttribute(authoredRevision, 'author') ?? '')
    : undefined;
  const projectedMode =
    authoredRevision && revisionAuthor !== undefined && authorFilter
      ? revisionNodeProjectionMode(authorFilter, authoredRevision.id, revisionAuthor, displayMode)
      : displayMode;
  if (
    (projectedMode === 'proposed' && revisionKind === 'del') ||
    (projectedMode === 'original' && revisionKind === 'ins') ||
    hiddenRowCollapses(rowNode, properties, projectedMode, authorFilter)
  )
    return null;
  const revision = projectedMode === 'all-markup' ? authoredRevision : undefined;
  // A resolved view that KEEPS a tracked row (an accepted insertion) still owes the reader
  // a change bar beside it, unless the reviewer filter hides the decision.
  const changeSites =
    authoredRevision &&
    projectedMode !== 'all-markup' &&
    revisionAuthor !== undefined &&
    (!authorFilter || revisionNodeIncluded(authorFilter, authoredRevision.id, revisionAuthor))
      ? [
          {
            kind: revisionKind === 'ins' ? ('insert' as const) : ('delete' as const),
            id: wmlRevisionAttribute(authoredRevision, 'id') ?? '',
            author: revisionAuthor,
            ...(wmlRevisionAttribute(authoredRevision, 'date') === undefined
              ? {}
              : { date: wmlRevisionAttribute(authoredRevision, 'date')! }),
            nodeId: authoredRevision.id,
          },
        ]
      : undefined;
  const starts: number[] = [];
  const spans: number[] = [];
  const preferred: PreferredWidth[] = [];
  const claims: CellWidthClaim[] = [];
  const gridBefore = Math.min(readGridSkip(properties, 'gridBefore'), LAST_GRID_COLUMN);
  // 17.18.87: "the initial number of grid units before the row starts is skipped. The
  // width of the skipped grid columns is set using the wBefore property." Without this the
  // skipped band is a column nothing states, and it absorbs the leftover as a phantom
  // gutter wider than the cells it precedes.
  if (gridBefore > 0) {
    claims.push({
      start: 0,
      span: gridBefore,
      preferred: readPreferredWidth(properties && childNamed(properties, 'wBefore')),
    });
  }
  let cursor = gridBefore;
  const rowCells = flattenContentControls(rowNode.children);
  for (const cellNode of rowCells) {
    if (cellNode.kind !== 'tableCell') continue;
    const cellPr = childNamed(cellNode, 'tcPr');
    const start = Math.min(cursor, LAST_GRID_COLUMN);
    const span = Math.min(
      readGridSpan(cellPr),
      MAX_TABLE_COLUMNS - start // ≥ 1: `start` never exceeds the last column
    );
    const width = readPreferredWidth(cellPr && childNamed(cellPr, 'tcW'));
    starts.push(start);
    spans.push(span);
    preferred.push(width);
    claims.push({ start, span, preferred: width });
    cursor = start + span;
  }
  const gridAfter = readGridSkip(properties, 'gridAfter');
  const gridColumns = Math.min(cursor + gridAfter, MAX_TABLE_COLUMNS);
  // 17.4.85, the trailing counterpart of `w:wBefore`.
  if (gridAfter > 0 && cursor < MAX_TABLE_COLUMNS) {
    claims.push({
      start: cursor,
      span: Math.min(gridAfter, MAX_TABLE_COLUMNS - cursor),
      preferred: readPreferredWidth(properties && childNamed(properties, 'wAfter')),
    });
  }
  return {
    node: rowNode,
    revision,
    changeSites,
    cells: rowCells,
    properties,
    starts,
    spans,
    preferred,
    gridColumns,
    cellEnd: cursor,
    claims,
  };
}

/**
 * What every row of one table resolves against. Contexts equal but for the row count share
 * one object: the count decides only which row is last, which each row keys on itself.
 */
export interface TableRowContext {
  readonly tableStyle: TableFormatting;
  readonly look: TableLook;
  readonly lead: number;
  /** The authored `w:gridCol` id of each grid column, where there is one. */
  readonly gridColumnIds: readonly (string | undefined)[];
  readonly styleColumns: number;
  readonly bodyRows: number;
  readonly headerRows: number;
  readonly tableBorders: TableBorderBox;
  readonly defaultMargins: CellMarginsPt;
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: RevisionAuthorFilter | undefined;
}

/** Condition sets resolve to one formatting object each (`semantic-table.ts`). */
export type StyleFormattingFor = (conditions: readonly string[]) => TableCellStyleFormatting;

// Per table, under its stable properties node, so tables never evict each other's context.
// A table without one (each row edit gives it a new node) finds its context by table style.
// Both hold nothing past the document that made them.
const tableContexts = new WeakMap<object, TableRowContext[]>();
const styleContexts = new WeakMap<object, TableRowContext[]>();
/** Contexts kept per table: a view switch (display mode, reviewer filter) and back. */
const CONTEXTS_PER_TABLE = 2;
/** Contexts kept per table style for tables without a properties node. */
const CONTEXTS_PER_STYLE = 16;

function sameContext(a: TableRowContext, b: TableRowContext): boolean {
  return (
    a.tableStyle === b.tableStyle &&
    a.lead === b.lead &&
    a.styleColumns === b.styleColumns &&
    a.headerRows === b.headerRows &&
    a.displayMode === b.displayMode &&
    a.authorFilter === b.authorFilter &&
    JSON.stringify([a.look, a.gridColumnIds, a.tableBorders, a.defaultMargins]) ===
      JSON.stringify([b.look, b.gridColumnIds, b.tableBorders, b.defaultMargins])
  );
}

/** `context`, or an equal one in `memo` under `key`, kept most recent first. */
function sharedIn(
  memo: WeakMap<object, TableRowContext[]>,
  key: object,
  context: TableRowContext,
  limit: number
): TableRowContext {
  const known = memo.get(key) ?? [];
  const at = known.findIndex((entry) => sameContext(entry, context));
  const shared = at < 0 ? context : known[at]!;
  if (at !== 0) memo.set(key, [shared, ...known.filter((_, i) => i !== at)].slice(0, limit));
  return shared;
}

/**
 * `context`, or an equal one an earlier read of the table made, so rows can key on its
 * identity. `owner` is the table's properties node, when it has one.
 */
function sharedContext(context: TableRowContext, owner: object | undefined): TableRowContext {
  if (!reuse) return context;
  return owner
    ? sharedIn(tableContexts, owner, context, CONTEXTS_PER_TABLE)
    : sharedIn(styleContexts, context.tableStyle, context, CONTEXTS_PER_STYLE);
}

interface ResolvedRow {
  readonly row: SemanticTableRow;
  /** Grid columns of cells that state `w:vMerge`: a merge below can continue them. */
  readonly merged: readonly number[];
  /** Grid columns of cells that continue a merge above. */
  readonly continues: readonly number[];
}

interface RowMemo extends ResolvedRow {
  readonly context: TableRowContext;
  readonly place: string;
  readonly mergedAbove: string;
}
const resolvedRows = new WeakMap<OoxmlNode, RowMemo[]>();

/**
 * The conditions a row's index decides, as a key: whether it is in the header block, the
 * last row, and which row band it takes.
 */
function placeKey(context: TableRowContext, rowIndex: number): string {
  const { look, headerRows, bodyRows } = context;
  const header = rowIndex < headerRows;
  const last = look.lastRow && rowIndex === bodyRows - 1;
  const band = look.rowBanding && !header ? (rowIndex - headerRows) % 2 : 0;
  return `${header ? 'h' : ''}${last ? 'l' : ''}${band}`;
}

/**
 * Resolve every row of a table: the rows a read before resolved alike come back by identity.
 * Then mark the heads of vertical merges, which the row below decides.
 */
export function resolveTableRows(
  input: TableRowContext,
  rowPlans: readonly TableRowPlan[],
  rowConditionsFor: (rowIndex: number) => readonly string[],
  styleFormattingFor: StyleFormattingFor,
  owner?: object
): SemanticTableRow[] {
  const context = sharedContext(input, owner);
  const resolved: ResolvedRow[] = [];
  let mergedAbove: readonly number[] = [];
  for (let rowIndex = 0; rowIndex < rowPlans.length; rowIndex += 1) {
    const plan = rowPlans[rowIndex]!;
    const place = placeKey(input, rowIndex);
    const aboveKey = mergedAbove.join(',');
    const memos = reuse ? resolvedRows.get(plan.node) : undefined;
    let row: ResolvedRow | undefined = memos?.find(
      (memo) => memo.context === context && memo.place === place && memo.mergedAbove === aboveKey
    );
    if (row && counts) counts.reusedRows += 1;
    if (!row) {
      row = resolveRow(
        input,
        plan,
        rowIndex,
        rowConditionsFor(rowIndex),
        mergedAbove,
        styleFormattingFor
      );
      if (reuse) {
        const memo: RowMemo = { ...row, context, place, mergedAbove: aboveKey };
        resolvedRows.set(plan.node, [memo, ...(memos ?? []).slice(0, 3)]);
      }
    }
    resolved.push(row);
    mergedAbove = row.merged;
  }
  return resolved.map((entry, rowIndex) => {
    const below = resolved[rowIndex + 1];
    return below && below.continues.length > 0
      ? withMergeHeads(entry.row, below.continues)
      : entry.row;
  });
}

const headed = new WeakMap<
  SemanticTableRow,
  { readonly key: string; readonly row: SemanticTableRow }
>();

/** `row` with the first cell at each of `columns` heading a vertical merge, when it can. */
function withMergeHeads(row: SemanticTableRow, columns: readonly number[]): SemanticTableRow {
  const key = columns.join(',');
  const known = reuse ? headed.get(row) : undefined;
  if (known?.key === key) return known.row;
  let cells: SemanticTableCell[] | undefined;
  for (const column of columns) {
    const current = cells ?? row.cells;
    const at = current.findIndex((cell) => cell.gridColumn === column);
    const head = current[at];
    if (!head || head.vMergeContinue || head.headsVerticalMerge) continue;
    cells ??= [...row.cells];
    cells[at] = { ...head, headsVerticalMerge: true };
  }
  const result = cells ? { ...row, cells } : row;
  if (reuse) headed.set(row, { key, row: result });
  return result;
}

function resolveRow(
  context: TableRowContext,
  plan: TableRowPlan,
  rowIndex: number,
  rowConditions: readonly string[],
  mergedAbove: readonly number[],
  styleFormattingFor: StyleFormattingFor
): ResolvedRow {
  const { tableStyle, look, lead, headerRows, bodyRows, styleColumns } = context;
  const { displayMode, authorFilter } = context;
  const rowNode = plan.node;
  const rowProperties = plan.properties;
  const isHeader = tableRowIsHeader(tableStyle, rowConditions, rowProperties);
  const rowTableBorders = rowExceptionBorders(rowNode, context.tableBorders);
  const rowMargins = rowExceptionMargins(rowNode, context.defaultMargins);
  let cellIndex = 0;
  const cells: SemanticTableCell[] = [];
  const merged: number[] = [];
  const continues: number[] = [];
  const cellConditions = plan.starts.map((gridColumn, index) =>
    conditionalTypesFor({
      look,
      rowIndex,
      rowCount: bodyRows,
      headerRows,
      gridColumn: gridColumn + lead,
      gridSpan: plan.spans[index]!,
      columnCount: styleColumns,
    })
  );
  // The style's cell margins hold for the row, so they resolve before any one cell does.
  const styleMargins = rowStyleCellMargins(tableStyle, cellConditions);
  const rowCellMargins = mergeMargins(rowMargins, styleMargins);
  for (const cellNode of plan.cells) {
    if (cellNode.kind !== 'tableCell') continue;
    const cellProperties = childNamed(cellNode, 'tcPr');
    const gridColumn = plan.starts[cellIndex]!;
    const gridSpan = plan.spans[cellIndex]!;
    // Read alongside its siblings, before `cellIndex` moves on — the plan loop and this
    // one skip the same non-cell children, and the indices must stay in lockstep.
    const preferredWidth = plan.preferred[cellIndex] ?? AUTO_PREFERRED_WIDTH;
    const conditions = cellConditions[cellIndex]!;
    cellIndex += 1;
    let conditionalBorders = EMPTY_CELL_BORDER_BOX;
    // Whole-table tcPr and basedOn layers contribute diagonals before conditions.
    for (const node of tableStyle.tableCellPropertyNodes ?? []) {
      conditionalBorders = mergeCellDiagonalBorders(conditionalBorders, readCellBorders(node));
    }
    for (const conditionType of conditions) {
      const format = tableStyle.conditional.get(conditionType);
      if (!format) continue;
      const conditionTcPr = childNamed(format, 'tcPr');
      conditionalBorders = mergeCellBorders(
        conditionalBorders,
        readConditionalCellBorders(
          conditionTcPr,
          tableStyle.conditionalStyleLayers?.get(conditionType)
        )
      );
    }
    const shading = cellShading(tableStyle, conditions, cellProperties);
    // The cell's own `w:tcMar` (17.4.68) over the style's cell margins (17.7.6.8, 17.7.6.9),
    // side by side. Both are cell-level: a side either states without a width falls to the
    // table-level margin, not to the other.
    const ownMargins = cellProperties && childNamed(cellProperties, 'tcMar');
    const cellMargins = ownMargins
      ? mergeMargins(rowMargins, { ...styleMargins, ...readMarginSides(ownMargins) })
      : rowCellMargins;
    // Content controls inside a cell flatten transparently — same rule as body
    // `storyBlocks`. Without this a `w:sdt` wrapping the cell's paragraphs leaves the
    // cell empty in layout while the tree still holds the text.
    // Through the shared collector: a cell is a story like any other, so a tracked mark
    // merges inside it and a paragraph a revision removed leaves no blank line behind.
    const blocks = mergedFlowBlocks(cellNode.children, displayMode, authorFilter);
    const ownBorders = cellProperties ? readCellBorders(cellProperties) : EMPTY_CELL_BORDER_BOX;
    const vMerge = readVMerge(cellProperties);
    if (vMerge !== 'none') merged.push(gridColumn);
    const continuesAbove = vMerge === 'continue' && mergedAbove.includes(gridColumn);
    if (continuesAbove) continues.push(gridColumn);
    const gridColumnId = context.gridColumnIds[gridColumn];
    cells.push({
      id: cellNode.id,
      ...revisionCellMetadata(cellProperties, displayMode, authorFilter, plan.revision),
      gridSpan,
      gridColumn,
      ...(gridColumnId ? { gridColumnId } : {}),
      vMergeContinue: continuesAbove,
      ...(vMerge === 'restart' ? { restartsVerticalMerge: true as const } : {}),
      hideEndMark: cellIgnoresEndMark(tableStyle, conditions, cellProperties),
      ...(cellNoWrap(tableStyle, conditions, cellProperties) ? { noWrap: true as const } : {}),
      vAlign:
        readStatedCellVerticalAlign(cellProperties) ??
        styleCellVerticalAlign(tableStyle, conditions) ??
        'top',
      textDirection: readCellTextDirection(cellProperties),
      margins: cellMargins,
      borders: mergeCellBorders(conditionalBorders, ownBorders),
      ...(rowTableBorders ? { rowTableBorders } : {}),
      ...(shading === undefined ? {} : { shading }),
      preferredWidth,
      styleFormatting: styleFormattingFor(conditions),
      blocks,
    });
  }
  raiseRowTopMargins(cells);
  // A first cell with a left margin of its own does not take the style's.
  const firstCell = plan.cells.find((node) => node.kind === 'tableCell');
  const firstProperties = firstCell && childNamed(firstCell, 'tcPr');
  const firstOwnMargins = firstProperties && childNamed(firstProperties, 'tcMar');
  const leadingGrowth =
    firstOwnMargins && readMarginSides(firstOwnMargins).left !== undefined
      ? 0
      : conditionalLeadingMarginGrowthPt(tableStyle, rowMargins, styleMargins);
  const rowRevision = plan.revision;
  const rowRevisionKind = rowRevision
    ? rowRevision.localName === 'ins'
      ? ('insert' as const)
      : ('delete' as const)
    : undefined;
  const rowRevisionId = rowRevision && wmlRevisionAttribute(rowRevision, 'id');
  const rowRevisionAuthor = rowRevision && wmlRevisionAttribute(rowRevision, 'author');
  const rowRevisionDate = rowRevision && wmlRevisionAttribute(rowRevision, 'date');
  const row: SemanticTableRow = {
    id: rowNode.id,
    ...(rowRevisionKind ? { revisionKind: rowRevisionKind } : {}),
    ...(rowRevisionId !== undefined ? { revisionId: rowRevisionId } : {}),
    ...(rowRevisionAuthor !== undefined ? { revisionAuthor: rowRevisionAuthor } : {}),
    ...(rowRevisionDate !== undefined ? { revisionDate: rowRevisionDate } : {}),
    ...(plan.changeSites ? { changeSites: plan.changeSites } : {}),
    isHeader,
    cantSplit: readFlag(rowProperties, 'cantSplit'),
    ...rowExceptionAlignment(rowNode),
    ...(leadingGrowth > 0 ? { conditionalLeadingMarginPt: leadingGrowth } : {}),
    height: exactRowHeightWithBottomMargin(readRowHeight(rowProperties), cells),
    cells,
  };
  return { row, merged, continues };
}
