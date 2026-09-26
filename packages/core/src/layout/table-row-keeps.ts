// `w:keepNext` on a body table row: the row stays on the page where the next row starts.
//
// A row keeps with the next when the FIRST paragraph of its FIRST cell resolves `w:keepNext`
// (§17.3.1.15) through the cascade: document defaults, table style, paragraph style chain,
// then direct formatting, last value winning. The property on a later paragraph of that
// cell, or in another cell, does nothing. Consecutive kept rows form one group.
//
// The group moves whole: a kept row never splits to leave part of itself behind. It needs
// beside it the opening of what follows: the whole next row when that row cannot split
// (`w:cantSplit`, an exact height), otherwise the first lines of every cell under the cell
// paragraphs' own widow and `w:keepLines` rules; after the last row, the opening of the
// next body paragraph. When the group and that opening do not fit below the content already
// on the page, the group moves to the next page, even when it cannot fit there either.
//
// Header rows keep with the first body row in the same way, and a `w:keepNext` paragraph
// before a table keeps with the header rows and that opening (`tableKeepOpening`).
//
// Limits, each placed by the ordinary row rules instead:
// - The lookahead stops after `MAX_KEEP_NEXT_CHAIN` kept rows. A longer group moves only
//   when those rows alone do not fit.
// - A vertical merge that crosses the group, or a first cell that continues a merge.
// - A first cell that opens with a nested table.
// - Nested tables and positioned (`w:tblpPr`) tables never keep their rows.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import {
  readTableStructure,
  type SemanticTableRow,
  type SemanticTableStructure,
} from './semantic-table.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import { firstRowContentDeps } from './table-fragment-content-insets.ts';
import { propertiesOf } from './paragraph-flow.ts';
import { MAX_KEEP_NEXT_CHAIN, paragraphKeeps } from './pagination-keeps.ts';
import { cascadeParagraphFormatting, type StyleCascadeTable } from './style-cascade.ts';
import { findParagraphProperties } from './style-definition-reader.ts';
import {
  initialCellCursors,
  measureRowHeight,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { probeRowFragmentProgress } from './table-row-progress-probe.ts';

// Rows come from `readTableStructure`, which is memoized per style cascade, so one row
// object always resolves against the same cascade.
const rowKeeps = new WeakMap<SemanticTableRow, boolean>();

/** Whether `row` keeps with the row or paragraph after it. */
export function rowKeepsWithNext(
  row: SemanticTableRow,
  styleCascade: StyleCascadeTable | undefined
): boolean {
  let keeps = rowKeeps.get(row);
  if (keeps === undefined) {
    keeps = resolveRowKeep(row, styleCascade);
    rowKeeps.set(row, keeps);
  }
  return keeps;
}

function resolveRowKeep(row: SemanticTableRow, styleCascade: StyleCascadeTable | undefined) {
  const cell = row.cells[0];
  if (!cell || cell.vMergeContinue) return false;
  const first = cell.blocks[0];
  if (first?.kind !== 'paragraph') return false;
  const pPr = findParagraphProperties(first);
  const props = styleCascade
    ? cascadeParagraphFormatting(styleCascade, pPr, cell.styleFormatting).paragraphProperties
    : propertiesOf(pPr);
  return paragraphKeeps(props).keepNext;
}

/** Row measurements a kept group is priced with. Indices are into the body rows. */
export interface KeptRowSource {
  readonly rows: readonly SemanticTableRow[];
  readonly keepsAt: (index: number) => boolean;
  /** The row's whole height where the group would stand. */
  readonly heightOf: (index: number) => number;
  /** Whether the row must place whole: `w:cantSplit`, an exact height, bottom-to-top text. */
  readonly placesWhole: (index: number) => boolean;
  /** Smallest height that starts every cell of a row that may split. */
  readonly openingOf: (index: number) => number;
  /**
   * Opening of the body content after the table, when the group reaches the last row.
   * `undefined` when nothing follows; `null` when that content cannot be priced.
   */
  readonly following: () => number | null | undefined;
}

/** A priced kept group. */
export interface KeptRowGroup {
  /** Last kept row priced. */
  readonly end: number;
  /** Height of the kept rows, placed whole. */
  readonly kept: number;
  /** Height the group needs beside it: the opening of what follows the kept rows. */
  readonly successor: number;
  /**
   * The group runs past {@link MAX_KEEP_NEXT_CHAIN} rows. Only that many are priced, with
   * no successor, so the height is a lower bound on what the group needs.
   */
  readonly truncated?: true;
}

/**
 * The kept group that starts at `start`, or null when the rule does not apply there.
 *
 * `start` must open the group: it keeps, and the row before it does not. Null for a group
 * whose rows or successor row continue a vertical merge, a kept last row with nothing
 * after the table, and following content that cannot be priced.
 *
 * `room` is the height left where the group would start. A successor row that fits whole
 * in what the kept rows leave of it is priced whole, which skips its opening search and
 * gives the same fit answer. Without `room`, the successor is always priced at its opening.
 */
export function keptRowGroup(
  source: KeptRowSource,
  start: number,
  room = Number.NEGATIVE_INFINITY
): KeptRowGroup | null {
  const { rows } = source;
  if (!source.keepsAt(start) || (start > 0 && source.keepsAt(start - 1))) return null;
  let end = start;
  let truncated = false;
  while (end + 1 < rows.length && source.keepsAt(end + 1)) {
    if (end + 1 - start >= MAX_KEEP_NEXT_CHAIN) {
      truncated = true;
      break;
    }
    end += 1;
  }
  const next = truncated ? end : end + 1;
  for (let index = start; index <= Math.min(next, rows.length - 1); index += 1) {
    if (rows[index]!.cells.some((cell) => cell.vMergeContinue)) return null;
  }
  let kept = 0;
  for (let index = start; index <= end; index += 1) kept += source.heightOf(index);
  if (truncated) return { end, kept, successor: 0, truncated: true };
  let successor: number | null | undefined;
  if (next < rows.length) successor = rowOpening(source, next, room - kept);
  else {
    successor = source.following();
    if (successor === undefined) return null;
  }
  return successor === null ? null : { end, kept, successor };
}

/** Height the row at `index` needs where it starts: whole when it cannot split or fits `room`. */
function rowOpening(source: KeptRowSource, index: number, room: number): number {
  const whole = source.heightOf(index);
  return source.placesWhole(index) || whole <= room + 0.001 ? whole : source.openingOf(index);
}

/**
 * Height the rows from `index` need where they start: their kept group with its successor's
 * opening, or the row's own opening when it does not keep. Undefined past the last row.
 * `room` has the meaning it has for {@link keptRowGroup}.
 */
export function rowsOpening(
  source: KeptRowSource,
  index: number,
  room = Number.NEGATIVE_INFINITY
): number | undefined {
  if (index >= source.rows.length) return undefined;
  const group = keptRowGroup(source, index, room);
  return group ? group.kept + group.successor : rowOpening(source, index, room);
}

/**
 * Smallest height in `[0, whole]` for which `opens` holds, to within 1/65536 of `whole`.
 *
 * `opens` must be monotone: a row that starts every cell in some height starts them in any
 * greater height. Returns `whole` when even that does not open the row.
 */
export function smallestOpening(whole: number, opens: (height: number) => boolean): number {
  if (!(whole > 0) || !opens(whole)) return Math.max(0, whole);
  let low = 0;
  let high = whole;
  for (let step = 0; step < 16; step += 1) {
    const middle = (low + high) / 2;
    if (opens(middle)) high = middle;
    else low = middle;
  }
  return high;
}

/** What {@link tableKeptRowSource} measures with. */
export interface KeptRowMeasure {
  readonly structure: SemanticTableStructure;
  /** The body rows: the table's rows after its repeated header group. */
  readonly rows: readonly SemanticTableRow[];
  readonly left: number;
  readonly deps: TableFlowDeps;
  /** Band of a fresh page: a `w:cantSplit` row taller than this splits anyway. */
  readonly pageHeight: number;
  readonly heightOf: (index: number) => number;
  readonly following: () => number | null | undefined;
}

/**
 * The {@link KeptRowSource} of one table's body rows.
 *
 * A row that may split opens with the smallest height that starts every cell, found with
 * the same side-effect-free probe the repeated-header admission uses. Page wrap zones are
 * left out, so the opening does not depend on where the probe stands.
 */
export function tableKeptRowSource(measure: KeptRowMeasure): KeptRowSource {
  const { structure, rows, left, deps, heightOf } = measure;
  const keepsAt = (index: number): boolean => {
    const row = rows[index];
    return row !== undefined && rowKeepsWithNext(row, deps.styleCascade);
  };
  const probeDeps: TableFlowDeps = {
    ...deps,
    pageExclusionZones: undefined,
    rowAtPageStart: false,
    keepLinesOpening: true,
  };
  return {
    rows,
    keepsAt,
    heightOf,
    placesWhole: (index) => {
      const row = rows[index]!;
      if (row.height.rule === 'exact') return true;
      return row.cantSplit && heightOf(index) <= measure.pageHeight + 0.001;
    },
    openingOf: (index) => {
      const row = rows[index]!;
      return smallestOpening(heightOf(index), (height) =>
        probeRowFragmentProgress(
          row,
          structure.columnWidthsPt,
          left,
          0,
          height,
          false,
          0,
          probeDeps,
          initialCellCursors(row),
          structure.cellSpacingPt,
          { requireEveryCell: true }
        )
      );
    },
    following: measure.following,
  };
}

/** How a body flow reads its tables, for {@link tableEndsKept} and {@link tableKeepOpening}. */
export interface TableKeepFlow {
  readonly width: number;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: RevisionAuthorFilter | undefined;
  readonly compatibilityMode: number | undefined;
}

/** A body flow block: a table is priced, anything else is not. */
type FlowBlock = { readonly kind: string; readonly table?: OoxmlElement } | undefined;

const structureOf = (table: OoxmlElement, at: TableKeepFlow) =>
  readTableStructure(
    table,
    at.width,
    0,
    at.styleCascade,
    at.displayMode,
    at.authorFilter,
    at.compatibilityMode
  );

/** Whether a body table's last row keeps with the body content after the table. */
export function tableEndsKept(block: FlowBlock, at: TableKeepFlow): boolean {
  if (block?.kind !== 'table' || !block.table) return false;
  const structure = structureOf(block.table, at);
  const last = structure?.rows.at(-1);
  return !!last && !structure!.float && rowKeepsWithNext(last, at.styleCascade);
}

interface OpeningMemo {
  readonly at: TableKeepFlow;
  readonly pageHeight: number;
  readonly deps: TableFlowDeps;
  readonly value: number | null;
}
const openings = new WeakMap<OoxmlElement, OpeningMemo>();

/**
 * Height a `w:keepNext` paragraph before `table` needs beside it: the repeated header group,
 * then the opening of the body rows ({@link rowsOpening}). Null for what this cannot price:
 * a positioned table, and a header group that a vertical merge crosses or that is taller
 * than a page.
 *
 * A kept group that runs to the table's end prices only the first body row's own opening:
 * the content after the table is not part of this lookahead.
 */
export function tableKeepOpening(
  block: FlowBlock,
  at: TableKeepFlow,
  pageHeight: number,
  deps: TableFlowDeps
): number | null {
  const table = block?.kind === 'table' ? block.table : undefined;
  if (!table) return null;
  const memo = openings.get(table);
  if (
    memo &&
    memo.pageHeight === pageHeight &&
    memo.deps.measurer === deps.measurer &&
    memo.deps.producer === deps.producer &&
    memo.at.width === at.width &&
    memo.at.styleCascade === at.styleCascade &&
    memo.at.displayMode === at.displayMode &&
    memo.at.authorFilter === at.authorFilter &&
    memo.at.compatibilityMode === at.compatibilityMode
  ) {
    return memo.value;
  }
  const value = measureTableKeepOpening(table, at, pageHeight, deps);
  openings.set(table, { at, pageHeight, deps, value });
  return value;
}

function measureTableKeepOpening(
  table: OoxmlElement,
  at: TableKeepFlow,
  pageHeight: number,
  deps: TableFlowDeps
): number | null {
  const structure = structureOf(table, at);
  if (!structure || structure.float || structure.rows.length === 0) return null;
  const measure = (row: SemanticTableRow, first: boolean): number =>
    measureRowHeight(
      row,
      structure.columnWidthsPt,
      0,
      0,
      first ? firstRowContentDeps(structure, row, deps) : deps,
      structure.cellSpacingPt
    );
  let header = 0;
  let count = 0;
  for (const row of structure.rows) {
    if (!row.isHeader) break;
    if (row.cells.some((cell) => cell.vMergeContinue)) return null;
    header += measure(row, count === 0);
    count += 1;
  }
  if (header > pageHeight + 0.001) return null;
  const rows = structure.rows.slice(count);
  const heights = new Map<number, number>();
  const heightOf = (index: number): number => {
    let height = heights.get(index);
    if (height === undefined) {
      height = measure(rows[index]!, count === 0 && index === 0);
      heights.set(index, height);
    }
    return height;
  };
  const source = tableKeptRowSource({
    structure,
    rows,
    left: 0,
    deps,
    pageHeight,
    heightOf,
    following: () => null,
  });
  return header + (rowsOpening(source, 0) ?? 0);
}

/** A body flow's table keep answers, bound to its revision view and compatibility mode. */
export interface TableKeepDecisions {
  /** {@link tableEndsKept} at the flow's first column width. */
  endsKept(block: FlowBlock): boolean;
  /** {@link tableKeepOpening} at the width of the column being filled. */
  opening(block: FlowBlock, width: number, pageHeight: number, deps: TableFlowDeps): number | null;
}

/** Bind {@link tableEndsKept} and {@link tableKeepOpening} to one body flow. */
export function tableKeepFlow(
  options: {
    readonly displayMode?: RevisionDisplayMode;
    readonly revisionAuthorFilter?: RevisionAuthorFilter;
    readonly compatibilityMode?: number;
  },
  width: number,
  styleCascade: StyleCascadeTable | undefined
): TableKeepDecisions {
  const flow: TableKeepFlow = {
    width,
    styleCascade,
    displayMode: options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE,
    authorFilter: options.revisionAuthorFilter,
    compatibilityMode: options.compatibilityMode,
  };
  return {
    endsKept: (block) => tableEndsKept(block, flow),
    opening: (block, columnWidth, pageHeight, deps) =>
      tableKeepOpening(block, { ...flow, width: columnWidth }, pageHeight, deps),
  };
}
