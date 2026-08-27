// `w:tblCellMar` and `w:tcMar` (17.4.41, 17.4.43): the padding inside a table cell.
//
// One unit, because a resolved margin is a four-way per-side fallback and every step of it
// lives here: what Word defaults each side to, how a side is read from a file (both the
// `w:left`/`w:right` and the ISO Strict `w:start`/`w:end` spellings), and how a cell's own
// override merges over the table's. Layout reads the answer; the table structure lane owns
// the order the sources are consulted in.

import type { OoxmlElement } from '../store/package/ooxml-tree.ts';

/** File-local element/attribute lookups, the same two `semantic-table.ts` keeps. */
function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
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
 * ultimately derives from. The constant is the fallback for a document that ships no
 * default table style at all.
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
 * Word's own default cell padding, for a document whose styles part states none.
 *
 * 0 top, 0 bottom, 108 twips left and right — the values `TableNormal` carries. A uniform
 * 3 pt on all four sides made every row of every table that authored no `w:tblCellMar` 6 pt
 * taller than Word's, and that error compounds down a table until it paginates a page early.
 * A document that DOES ship a default table style resolves against that instead; this is the
 * floor beneath it.
 */
export const DEFAULT_CELL_MARGINS: CellMarginsPt = {
  top: 0,
  right: DEFAULT_CELL_MARGIN_SIDE_PT,
  bottom: 0,
  left: DEFAULT_CELL_MARGIN_SIDE_PT,
};

function twipsSide(node: OoxmlElement | undefined): number | undefined {
  if (!node) return undefined;
  const raw = attributeValue(node, 'w');
  if (raw === undefined || !/^\d{1,9}$/.test(raw)) return undefined;
  const twips = Number(raw);
  if (!Number.isFinite(twips) || twips < 0) return undefined;
  const pt = twips / 20;
  return pt > MAX_CELL_MARGIN_PT ? MAX_CELL_MARGIN_PT : pt;
}

/**
 * Read `tblCellMar` / `tcMar`. Each omitted side stays undefined so callers can fall back
 * per-side (tcMar → tblCellMar → table style → Word's default).
 */
export function readMarginSides(container: OoxmlElement | undefined): Partial<CellMarginsPt> {
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

/** A cell's own `w:tcMar` over the table's per-side defaults. */
export function mergeMargins(
  tableDefaults: CellMarginsPt,
  cellOverride: Partial<CellMarginsPt>
): CellMarginsPt {
  return {
    top: cellOverride.top ?? tableDefaults.top,
    right: cellOverride.right ?? tableDefaults.right,
    bottom: cellOverride.bottom ?? tableDefaults.bottom,
    left: cellOverride.left ?? tableDefaults.left,
  };
}
