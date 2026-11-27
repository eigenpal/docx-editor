// `w:tblCellMar` and `w:tcMar` (17.4.42, 17.4.68): the padding inside a table cell.
//
// One unit, because a resolved margin is a four-way per-side fallback and every step of it
// lives here: what Word defaults each side to, how a side is read from a file (both the
// `w:left`/`w:right` and the ISO Strict `w:start`/`w:end` spellings), and how a cell's own
// override merges over the table's. Layout reads the answer; the table structure lane owns
// the order the sources are consulted in.

import { readTwipsMeasure, WML_NAMESPACE_URI } from '@docx-editor.dev/core/store';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';

/** File-local element/attribute lookups, the same two `semantic-table.ts` keeps. */
function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === localName
    )
      return child;
  }
  return undefined;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName
  )?.value;
}

/**
 * The uniform 3 pt (60 twip) inset this lane used to apply on every side.
 *
 * Word's defaults are not uniform — see {@link DEFAULT_CELL_MARGINS} — so nothing resolves
 * against this any more. Kept because it is published.
 */
export const CELL_PAD = 3;

/**
 * Word's default left and right cell margin: 108 twips, which its UI rounds to 0.08".
 *
 * This is what `TableNormal` states, and `TableNormal` is what every Word-authored table
 * ultimately derives from. It is not the fallback for an omitted margin.
 */
const DEFAULT_CELL_MARGIN_SIDE_PT = 108 / 20;

/** Soft ceiling on a single margin side (~22"). */
export const MAX_CELL_MARGIN_PT = 31_680 / 20;

/** Resolved cell padding in points, after the table default and any per-cell override. */
export interface CellMarginsPt {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Traditional default table-style padding: 0 vertical, 108 twips horizontal.
 *
 * Kept as a published constant. Authored styles can supply these values; omitted
 * margins instead resolve to a 10-twip horizontal application fallback.
 */
export const DEFAULT_CELL_MARGINS: CellMarginsPt = {
  top: 0,
  right: DEFAULT_CELL_MARGIN_SIDE_PT,
  bottom: 0,
  left: DEFAULT_CELL_MARGIN_SIDE_PT,
};

/**
 * The sides a `w:tblCellMar` or `w:tcMar` states. A side is a width in points, or `null` when
 * its `w:type` gives it no width. An omitted side has no key.
 */
export type StatedMarginSides = { readonly [Side in keyof CellMarginsPt]?: number | null };

/**
 * The cell margin of a side that no table property and no table style states: no vertical
 * padding and 10 twips on the left and the right.
 */
export const OMITTED_CELL_MARGINS: CellMarginsPt = { top: 0, right: 0.5, bottom: 0, left: 0.5 };

/** `ST_TblWidth` (17.18.90) values that give a cell margin side no width. */
const WIDTHLESS_SIDE_TYPES = new Set(['nil', 'auto', 'pct']);

function twipsSide(node: OoxmlElement | undefined): number | null | undefined {
  if (!node) return undefined;
  // A `nil`, `auto` or `pct` side (`ST_TblWidth`, 17.18.90) has no width in twentieths of a
  // point, and its `w:w` is not read. 17.4.35 has `pct` and `auto` ignored for a margin.
  // 17.18.90 words `nil` as a zero width, but a `nil` side pads like the other two in
  // rendered documents: a cell with a `nil` side inside a table with 300-twip margins keeps
  // the 300 twips. The side is still stated, so it replaces what a weaker source of the
  // same level states for it (`mergeTableMargins`, `mergeMargins`).
  const type = attributeValue(node, 'type');
  if (type !== undefined && WIDTHLESS_SIDE_TYPES.has(type)) return null;
  const raw = attributeValue(node, 'w');
  const twips = readTwipsMeasure(raw);
  if (twips === null) return undefined;
  // A negative margin (`ST_MeasurementOrPercent`, §17.18.107) states a side of no padding: it
  // pads like 0 and still replaces the table style's margin for that side.
  if (twips < 0) return 0;
  const pt = twips / 20;
  return pt > MAX_CELL_MARGIN_PT ? MAX_CELL_MARGIN_PT : pt;
}

/**
 * Read `tblCellMar` / `tcMar`. Each omitted side stays undefined so callers can fall back
 * per-side (tcMar → tblCellMar → table style → the omitted-margin default). A side stated
 * without a width reads as `null`.
 */
export function readMarginSides(container: OoxmlElement | undefined): StatedMarginSides {
  if (!container) return {};
  // `w:start`/`w:end` are the direction-relative spellings, and the ISO Strict `CT_TcMar` /
  // `CT_TblCellMar` declare only those. Reading `w:left`/`w:right` alone put the text of a
  // Strict-authored cell at the fallback pad instead of its authored inset.
  const top = twipsSide(childNamed(container, 'top'));
  const left = twipsSide(childNamed(container, 'left') ?? childNamed(container, 'start'));
  const bottom = twipsSide(childNamed(container, 'bottom'));
  const right = twipsSide(childNamed(container, 'right') ?? childNamed(container, 'end'));
  return {
    ...(top === undefined ? {} : { top }),
    ...(left === undefined ? {} : { left }),
    ...(bottom === undefined ? {} : { bottom }),
    ...(right === undefined ? {} : { right }),
  };
}

/**
 * Give every cell of one row the row's largest top margin, in place.
 *
 * A row lays out its content below one top padding: a cell whose own `w:tcMar` top is
 * smaller still starts its text where the cell with the largest top margin does (0, 100
 * and 300 twips against 300 twips, with and without paragraph spacing, measured). Bottom
 * margins stay per cell.
 */
export function raiseRowTopMargins<Cell extends { readonly margins: CellMarginsPt }>(
  cells: Cell[]
): void {
  let top = 0;
  for (const cell of cells) top = Math.max(top, cell.margins.top);
  for (const [index, cell] of cells.entries())
    if (cell.margins.top < top) cells[index] = { ...cell, margins: { ...cell.margins, top } };
}

/**
 * One row's cell-margin defaults: its `w:tblPrEx/w:tblCellMar` exception (17.4.60, 17.4.41)
 * over the table's, side by side. A cell's own `w:tcMar` still merges over the result.
 * Returns `tableDefaults` by identity when the row states no margin exception.
 */
export function rowExceptionMargins(
  row: OoxmlElement,
  tableDefaults: CellMarginsPt
): CellMarginsPt {
  const exception = childNamed(row, 'tblPrEx');
  const box = exception && childNamed(exception, 'tblCellMar');
  return box ? mergeTableMargins(tableDefaults, readMarginSides(box)) : tableDefaults;
}

/**
 * A `w:tblCellMar` (17.4.42, 17.4.41) over the table-level margins a weaker source gave.
 * A side stated without a width takes the omitted-margin default, not the weaker source's
 * width: a table's own `auto` side over a style's 300 twips renders without the 300 twips.
 * The inheritance of 17.4.42 is for an omitted `w:tblCellMar`, and this side is not omitted.
 */
export function mergeTableMargins(
  tableDefaults: CellMarginsPt,
  stated: StatedMarginSides
): CellMarginsPt {
  const side = (name: keyof CellMarginsPt): number => {
    const width = stated[name];
    return width === null ? OMITTED_CELL_MARGINS[name] : (width ?? tableDefaults[name]);
  };
  return { top: side('top'), right: side('right'), bottom: side('bottom'), left: side('left') };
}

/**
 * Cell-level margins (`w:tcMar`, 17.4.68) over the table-level margins. A side the cell level
 * omits, or states without a width, takes the table-level margin.
 */
export function mergeMargins(
  tableDefaults: CellMarginsPt,
  cellOverride: StatedMarginSides
): CellMarginsPt {
  return {
    top: cellOverride.top ?? tableDefaults.top,
    right: cellOverride.right ?? tableDefaults.right,
    bottom: cellOverride.bottom ?? tableDefaults.bottom,
    left: cellOverride.left ?? tableDefaults.left,
  };
}
