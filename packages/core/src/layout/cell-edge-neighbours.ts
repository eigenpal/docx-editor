// `w:contextualSpacing` (17.3.1.9) at the edges of a table cell. The property compares a
// paragraph with the paragraph before and after it in document order, and a cell edge does
// not stop that walk:
//
// - the first paragraph of a cell compares with the last paragraph of the cell before it in
//   the row (its cell end mark);
// - the first paragraph of a row's first cell compares with the end mark of the row above
//   (17.4.78 `w:tr`), which is in the paragraph style named "Normal": the default paragraph
//   style (17.7.4.17 `w:default`) of most documents; see `row-end-mark-style.ts`;
// - in the first row of a table, it compares with the block before the table: a paragraph, or
//   the end mark of the last row of a table (17.4.37 `w:tbl`). A table that opens a cell
//   continues the walk before that cell. A table that opens a story has no block before it,
//   and nothing matches;
// - the last paragraph of a cell compares with the first paragraph of the next cell, and in
//   the row's last cell with the row end mark;
// - a cell that opens with a nested table gives the first paragraph of that table.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { neighbourBlockStyle, type TableEdgeFlow } from './contextual-paragraph-spacing.ts';
import { rowEndMarkStyle } from './row-end-mark-style.ts';
import { extendedFlowKey } from './flow-key-intern.ts';
import type { SemanticTableCell, SemanticTableRow } from './semantic-table.ts';
import type { PreparedBlock } from './section-prepass-types.ts';
import type { StyleCascadeTable, TableCellStyleFormatting } from './style-cascade.ts';
import { tableOpening } from './table-opening.ts';

/** What a cell edge or a table edge compares with; `style: undefined` never matches. */
export interface EdgeNeighbour {
  readonly style: string | null | undefined;
}

/** What one cell-edge block compares with, on each side that is a cell edge. */
export interface CellEdgeNeighbours {
  readonly previous?: EdgeNeighbour;
  readonly next?: EdgeNeighbour;
}

const NONE: EdgeNeighbour = { style: undefined };

/**
 * The style of the block before a body table: a paragraph as the prepass resolved it, or the
 * end mark of the last row of a table with a row in the view.
 */
function leadOf(
  previous: PreparedBlock | undefined,
  styles: StyleCascadeTable | undefined
): string | null | undefined {
  if (previous?.kind === 'table') {
    return openingOf(previous).rowId === undefined ? undefined : rowEndMarkStyle(styles);
  }
  return previous?.kind === 'paragraph' ? previous.styleId : undefined;
}

/** Where a prepared table starts, as the prepass read it in the view of the flow. */
function openingOf(entry: Extract<PreparedBlock, { kind: 'table' }>) {
  return entry.opening ?? tableOpening(entry.table);
}

/** Each body table's first row id, mapped to the block before the table. */
export function tableTopLeads(
  prepared: readonly PreparedBlock[],
  styles: StyleCascadeTable | undefined
): ReadonlyMap<string, EdgeNeighbour> {
  const leads = new Map<string, EdgeNeighbour>();
  prepared.forEach((entry, index) => {
    const id = entry.kind === 'table' ? openingOf(entry).rowId : undefined;
    if (id !== undefined) leads.set(id, { style: leadOf(prepared[index - 1], styles) });
  });
  return leads;
}

/**
 * Flow keys that carry each body table's lead style, so an edit that restyles the paragraph
 * before a table re-places the table whose first row reads it.
 */
export function tableLeadFlowKeys(
  keys: string[],
  prepared: readonly PreparedBlock[],
  styles: StyleCascadeTable | undefined
): string[] {
  let flow = keys;
  prepared.forEach((entry, index) => {
    if (entry.kind !== 'table' || flow[index] === undefined) return;
    const style = leadOf(prepared[index - 1], styles);
    if (flow === keys) flow = [...keys];
    flow[index] = extendedFlowKey(flow[index]!, '~tl~', style === undefined ? '-' : `=${style}`);
  });
  return flow;
}

/** The flow dependencies {@link withNestedTableLead} reads and replaces. */
interface NestedLeadDeps extends TableEdgeFlow {
  readonly tableTopLeads?: ReadonlyMap<string, EdgeNeighbour>;
  readonly cellEdges?: ReadonlyMap<string, CellEdgeNeighbours>;
}

const nestedDeps = new WeakMap<
  object,
  Map<string, { readonly style: EdgeNeighbour['style']; readonly deps: object }>
>();

/**
 * `deps` for the table `blocks[index]` of a cell or story flow, with what its first row
 * compares with: the block before it, or, for a table that opens a cell, what that cell
 * compares with. A table that opens a story has nothing before it.
 */
export function withNestedTableLead<T extends NestedLeadDeps>(
  deps: T,
  blocks: readonly OoxmlElement[],
  index: number,
  inTableCell: boolean,
  cellStyle?: TableCellStyleFormatting
): T {
  const table = blocks[index]!;
  const id = tableOpening(table, deps).rowId;
  if (id === undefined) return deps;
  const lead: EdgeNeighbour =
    index > 0
      ? { style: neighbourBlockStyle(blocks[index - 1], -1, deps, cellStyle) }
      : ((inTableCell ? deps.cellEdges?.get(table.id)?.previous : undefined) ?? NONE);
  // One object per table and lead, so readers that key on the deps identity keep their state.
  let known = nestedDeps.get(deps);
  if (!known) nestedDeps.set(deps, (known = new Map()));
  const cached = known.get(id);
  if (cached && cached.style === lead.style) return cached.deps as T;
  const nested = { ...deps, tableTopLeads: new Map([[id, lead]]) };
  known.set(id, { style: lead.style, deps: nested });
  return nested;
}

const memo = new WeakMap<
  SemanticTableRow,
  {
    readonly styles: StyleCascadeTable | undefined;
    readonly displayMode: TableEdgeFlow['displayMode'];
    readonly authorFilter: TableEdgeFlow['revisionAuthorFilter'];
    readonly lead: EdgeNeighbour | undefined;
    readonly edges: ReadonlyMap<string, CellEdgeNeighbours>;
  }
>();

/**
 * The cell-edge blocks of one row, by block id. `lead` is what the first row of a table
 * compares with ({@link tableTopLeads}, {@link withNestedTableLead}); a later row has none.
 */
export function cellEdgeNeighbours(
  row: SemanticTableRow,
  flow: TableEdgeFlow | undefined,
  lead: EdgeNeighbour | undefined
): ReadonlyMap<string, CellEdgeNeighbours> {
  const cached = memo.get(row);
  const styles = flow?.styleCascade;
  if (
    cached &&
    cached.styles === styles &&
    cached.displayMode === flow?.displayMode &&
    cached.authorFilter === flow?.revisionAuthorFilter &&
    (cached.lead === undefined) === (lead === undefined) &&
    cached.lead?.style === lead?.style
  ) {
    return cached.edges;
  }
  const rowEnd: EdgeNeighbour = { style: rowEndMarkStyle(styles) };
  // The cell before ends at its last block, and the cell after opens at its first block.
  const styleOf = (cell: SemanticTableCell, side: -1 | 1): EdgeNeighbour => ({
    style: neighbourBlockStyle(
      side < 0 ? cell.blocks.at(-1) : cell.blocks[0],
      side,
      flow,
      cell.styleFormatting
    ),
  });
  const edges = new Map<string, CellEdgeNeighbours>();
  row.cells.forEach((cell, index) => {
    const before = index > 0 ? styleOf(row.cells[index - 1]!, -1) : (lead ?? rowEnd);
    const after = index < row.cells.length - 1 ? styleOf(row.cells[index + 1]!, 1) : rowEnd;
    // A nested table that opens the cell reads `previous` for its own first row.
    const first = cell.blocks[0];
    const last = cell.blocks.at(-1);
    if (first) edges.set(first.id, { previous: before });
    if (last) edges.set(last.id, { ...edges.get(last.id), next: after });
  });
  memo.set(row, {
    styles,
    displayMode: flow?.displayMode,
    authorFilter: flow?.revisionAuthorFilter,
    lead,
    edges,
  });
  return edges;
}
