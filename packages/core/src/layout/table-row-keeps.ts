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
// A row that starts a new page (`w:pageBreakBefore`) ends the group and needs no room beside
// it, as a page break ends a paragraph keep chain. In Word 2013 and later layout, the kept
// rows before that row go to the new page with it: the break starts the page before them.
// Before Word 2013, header rows do not keep with the body rows.
//
// Header rows keep with the first body row in the same way, and a `w:keepNext` paragraph
// before a table keeps with the header rows and that opening (`tableKeepOpening`). When
// every body row keeps, the paragraph keeps through them with what follows the table.
//
// Limits, each placed by the ordinary row rules instead:
// - The lookahead stops after `MAX_KEEP_NEXT_CHAIN` kept rows. A longer group moves only
//   when those rows alone do not fit.
// - A vertical merge that crosses the group, or a first cell that continues a merge.
// - A keep chain reads through the kept rows of one table only (`followingKeepOpening`).
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
import { MAX_KEEP_NEXT_CHAIN, paragraphKeeps, type TableKeepOpening } from './pagination-keeps.ts';
import { cascadeParagraphFormatting, type StyleCascadeTable } from './style-cascade.ts';
import { findParagraphProperties } from './style-definition-reader.ts';
import {
  initialCellCursors,
  measureRowHeight,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { probeRowFragmentProgress } from './table-row-progress-probe.ts';
import { rowBreaksPageBefore } from './table-row-page-break.ts';
import { planHeaderGroup } from './table-header-vmerge.ts';
import { isWord2013OrLaterMode } from './document-compatibility-mode.ts';

// Rows come from `readTableStructure`, which is memoized per style cascade, so one row
// object always resolves against the same cascade.
const rowKeeps = new WeakMap<SemanticTableRow, boolean>();
const rowBreaks = new WeakMap<SemanticTableRow, boolean>();

/** {@link rowBreaksPageBefore}, memoized per row as {@link rowKeepsWithNext} is. */
function rowBreaksPage(row: SemanticTableRow, styleCascade: StyleCascadeTable | undefined) {
  let breaks = rowBreaks.get(row);
  if (breaks === undefined) {
    breaks = rowBreaksPageBefore(row, styleCascade);
    rowBreaks.set(row, breaks);
  }
  return breaks;
}

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
  /** The row starts a new page (`w:pageBreakBefore`). */
  readonly breaksAt: (index: number) => boolean;
  /** The row's whole height where the group would stand. */
  readonly heightOf: (index: number) => number;
  /** Whether the row must place whole: `w:cantSplit`, an exact height, bottom-to-top text. */
  readonly placesWhole: (index: number) => boolean;
  /** Smallest height that starts every cell of a row that may split. */
  readonly openingOf: (index: number) => number;
  /** Whether `height` starts every cell of a row that may split: one probe, no search. */
  readonly opensWithin: (index: number, height: number) => boolean;
  /**
   * Opening of the body content after the table, when the group reaches the last row, with
   * `room` left beside it. `undefined` when nothing follows; `null` when it cannot be priced.
   */
  readonly following: (room: number) => number | null | undefined;
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
  /**
   * The row after the group starts a new page, so the group needs no successor height. In
   * Word 2013 and later layout, that page break starts the page before the group instead.
   */
  readonly breaksAfter?: true;
}

/**
 * The kept group that starts at `start`, or null when the rule does not apply there.
 *
 * `start` must open the group: it keeps, and the row before it does not keep or it starts a
 * new page. Null for a group whose rows or successor row continue a vertical merge, a kept
 * last row with nothing after the table, and following content that cannot be priced.
 * A successor row that starts a new page ends the group with no successor height.
 *
 * `room` is the height left where the group would start. A successor row is then priced
 * only as exactly as the fit against what the kept rows leave of `room` needs: whole when it
 * fits whole there, that space when one probe starts every cell in it, otherwise whole.
 * Without `room`, the successor is priced at its smallest opening, found by a search.
 * The content after the table is priced for what the kept rows leave of `room`.
 */
export function keptRowGroup(
  source: KeptRowSource,
  start: number,
  room = Number.NEGATIVE_INFINITY
): KeptRowGroup | null {
  const { rows } = source;
  if (!source.keepsAt(start)) return null;
  if (start > 0 && source.keepsAt(start - 1) && !source.breaksAt(start)) return null;
  let end = start;
  let truncated = false;
  while (end + 1 < rows.length && source.keepsAt(end + 1) && !source.breaksAt(end + 1)) {
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
  if (next < rows.length) {
    if (source.breaksAt(next)) return { end, kept, successor: 0, breaksAfter: true };
    successor = rowOpening(source, next, room - kept);
  } else {
    successor = source.following(room - kept);
    if (successor === undefined) return null;
  }
  return successor === null ? null : { end, kept, successor };
}

/**
 * Height the row at `index` needs where it starts, as {@link keptRowGroup} prices a successor:
 * exact without `room`, and with `room` exact only in whether it fits there.
 */
function rowOpening(source: KeptRowSource, index: number, room: number): number {
  const whole = source.heightOf(index);
  if (source.placesWhole(index) || whole <= room + 0.001) return whole;
  if (room === Number.NEGATIVE_INFINITY) return source.openingOf(index);
  return room > 0.001 && source.opensWithin(index, room + 0.001) ? room : whole;
}

/**
 * Height the rows from `index` need where they start: their kept group with its successor's
 * opening, or the row's own opening when it does not keep. Undefined past the last row, and
 * 0 for a row that starts a new page. `room` has the meaning it has for {@link keptRowGroup}.
 */
export function rowsOpening(
  source: KeptRowSource,
  index: number,
  room = Number.NEGATIVE_INFINITY
): number | undefined {
  if (index >= source.rows.length) return undefined;
  if (source.breaksAt(index)) return 0;
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
  readonly following: (room: number) => number | null | undefined;
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
  const opensWithin = (index: number, height: number): boolean => {
    const row = rows[index]!;
    return probeRowFragmentProgress(
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
    );
  };
  return {
    rows,
    keepsAt,
    breaksAt: (index) => rowBreaksPage(rows[index]!, deps.styleCascade),
    heightOf,
    placesWhole: (index) => {
      const row = rows[index]!;
      if (row.height.rule === 'exact') return true;
      return row.cantSplit && heightOf(index) <= measure.pageHeight + 0.001;
    },
    openingOf: (index) => smallestOpening(heightOf(index), (height) => opensWithin(index, height)),
    opensWithin,
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
type FlowBlock =
  | {
      readonly kind: string;
      readonly table?: OoxmlElement;
      readonly keeps?: { readonly keepNext: boolean };
    }
  | undefined;

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
  readonly value: TableKeepOpening | null;
}
const openings = new WeakMap<OoxmlElement, OpeningMemo>();

/**
 * What a `w:keepNext` paragraph before `table` needs beside it: the header rows, planned as
 * placement plans them (`planHeaderGroup`), then the opening of the body rows
 * ({@link rowsOpening}). Null for a positioned table and a header group taller than a page.
 *
 * When the kept rows run from the first body row to the table's end, `throughHeight` is the
 * header and those rows: the chain goes on with the content after the table. A first row that
 * starts a new page ends the chain before the table (`breaksPage`). Kept first rows that go
 * to such a page with the row after them take the chain there too (`startsPage`, Word 2013 and
 * later). Before Word 2013 the chain ends at the header rows of a table that has them.
 */
export function tableKeepOpening(
  block: FlowBlock,
  at: TableKeepFlow,
  pageHeight: number,
  deps: TableFlowDeps
): TableKeepOpening | null {
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
): TableKeepOpening | null {
  const structure = structureOf(table, at);
  if (!structure || structure.float || structure.rows.length === 0) return null;
  if (rowBreaksPage(structure.rows[0]!, at.styleCascade)) return { breaksPage: true, height: 0 };
  const measure = (row: SemanticTableRow, rowDeps: TableFlowDeps): number =>
    measureRowHeight(row, structure.columnWidthsPt, 0, 0, rowDeps, structure.cellSpacingPt);
  const headerRows: SemanticTableRow[] = [];
  for (const row of structure.rows) {
    if (!row.isHeader) break;
    headerRows.push(row);
  }
  const header = planHeaderGroup(
    structure,
    headerRows,
    () => 0,
    0,
    deps,
    (row, _top, rowDeps) => measure(row, rowDeps)
  ).heightPt;
  if (header > pageHeight + 0.001) return null;
  // Before Word 2013, header rows do not keep with the body rows, so the chain ends there.
  const laterLayout = isWord2013OrLaterMode(at.compatibilityMode);
  if (headerRows.length > 0 && !laterLayout) return { height: header };
  const rows = structure.rows.slice(headerRows.length);
  const heights = new Map<number, number>();
  const heightOf = (index: number): number => {
    let height = heights.get(index);
    if (height === undefined) {
      const first = headerRows.length === 0 && index === 0;
      height = measure(rows[index]!, first ? firstRowContentDeps(structure, rows[0]!, deps) : deps);
      heights.set(index, height);
    }
    return height;
  };
  let reachesEnd = false;
  const source = tableKeptRowSource({
    structure,
    rows,
    left: 0,
    deps,
    pageHeight,
    heightOf,
    // Priced without what follows the table; a group that reaches it reports `throughHeight`.
    following: () => {
      reachesEnd = true;
      return null;
    },
  });
  const height = header + (rowsOpening(source, 0) ?? 0);
  // From Word 2013 on, kept first rows go to the page a following row's break starts.
  if (laterLayout && headerRows.length === 0 && keptRowGroup(source, 0)?.breaksAfter) {
    return { startsPage: true, height };
  }
  if (!reachesEnd) return { height };
  // `following` is read only when the first group reaches the end, so this group is priced.
  const group = keptRowGroup({ ...source, following: () => 0 }, 0);
  return group ? { height, throughHeight: header + group.kept } : { height };
}

/** A body flow's table keep answers, bound to its revision view and compatibility mode. */
export interface TableKeepDecisions {
  /** {@link tableEndsKept} at the flow's first column width. */
  endsKept(block: FlowBlock): boolean;
  /** Whether `block` is a paragraph that keeps with the table after it. */
  keptBefore(block: FlowBlock): boolean;
  /** {@link tableKeepOpening} at the width of the column being filled. */
  opening(
    block: FlowBlock,
    width: number,
    pageHeight: number,
    deps: TableFlowDeps
  ): TableKeepOpening | null;
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
    keptBefore: (block) => block?.kind === 'paragraph' && !!block.keeps?.keepNext,
    opening: (block, columnWidth, pageHeight, deps) =>
      tableKeepOpening(block, { ...flow, width: columnWidth }, pageHeight, deps),
  };
}
