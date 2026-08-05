// CT_TblWidth reading, and the reconciliation that turns authored width statements into the
// column grid a table is laid out on.
//
// This is separate from the structural read in `semantic-table.ts` because settling a column
// is not a per-cell read. `w:tblGrid` only seeds the columns, and 17.18.87 settles the rest
// by looking at every cell that covers a column across every row — a whole algorithm with its
// own bounds, reached through a single call once the structural walk has collected the
// claims. Keeping it here leaves that walk a walk, and leaves the width algebra somewhere it
// can be read end to end.
//
// All widths leave here in POINTS — twips are converted once at this boundary, matching
// `geometryOfSection` and `paragraphIndent`.
//
// Every value below is attacker-controlled (a .docx is a zip of XML the author fully
// controls). `resolveColumnWidthsPt` bounds span and column counts before allocation and
// avoids spread over attacker-sized collections — note the claim list it consumes grows with
// the table's CELL count, not its column count, so it must never be spread or passed as
// varargs. Do not relax these limits: hostile inputs can otherwise trigger multi-gigabyte
// allocation attempts or spread-arity failures that vary by JavaScript engine.
//
// Widths resolve to a positive number or not at all. A column that no evidence settles takes
// a bounded share of what is left rather than zero, and no fit may scale a table below one
// point per column — a zero-width column is unrecoverable downstream.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { MAX_TABLE_COLUMNS } from '../store/store/table-constraints.ts';

export { MAX_TABLE_COLUMNS };

/**
 * Soft ceiling on one grid column (~22", Word's widest page). `w:gridCol/@w:w` is the one
 * geometry number a file states that every cell box, row box and border stroke inherits, so
 * it is read and clamped exactly like `twipsSide` reads a margin.
 */
const MAX_COLUMN_WIDTH_PT = 31_680 / 20;

/**
 * `w:tblW` / `w:tcW` / `w:wBefore` (CT_TblWidth, 17.4.63 / 17.4.71 / 17.4.86): a PREFERRED
 * width plus the unit it is stated in. Preferred is the operative word — it is what the
 * producer asked for, not what the table resolved to.
 *
 * `pct` is stated in fiftieths of a percent (5000 = 100%) by Word, and in the `"50%"`
 * string form of `ST_Percentage` by others; both are read. `auto` and `nil` carry no width.
 */
export type PreferredWidthType = 'dxa' | 'pct' | 'auto' | 'nil';

export interface PreferredWidth {
  readonly type: PreferredWidthType;
  /** POINTS for `dxa`, PERCENT (0–100) for `pct`, 0 for `auto`/`nil`. */
  readonly value: number;
}

export const AUTO_PREFERRED_WIDTH: PreferredWidth = Object.freeze({ type: 'auto', value: 0 });

/** Widest a `pct` preference may resolve to, so `w:w="999999"` cannot inflate a table. */
const MAX_PREFERRED_PERCENT = 100;

/** Points per unit for `ST_UniversalMeasure`'s suffixes (`pi` is a synonym for `pc`). */
const MEASURE_UNIT_PT: Readonly<Record<string, number>> = Object.freeze({
  mm: 72 / 25.4,
  cm: 72 / 2.54,
  in: 72,
  pt: 1,
  pc: 12,
  pi: 12,
});

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
 * Bounded reader for `ST_MeasurementOrPercent` — the union `w:w` actually admits. Word
 * writes the plain twips form, but `ST_UniversalMeasure` (`2.5in`, `72pt`) and
 * `ST_Percentage` (`33.3%`, the form 17.4.71's own example uses) are equally valid, and
 * dropping them silently loses geometry a conformant producer stated.
 *
 * Every branch is anchored with a bounded quantifier: these run over attacker-controlled
 * attribute values and must not backtrack.
 */
function readMeasurementOrPercent(
  raw: string
):
  | { readonly kind: 'length'; readonly pt: number }
  | { readonly kind: 'percent'; readonly percent: number }
  | null {
  if (/^\d{1,9}$/.test(raw)) {
    const pt = Number(raw) / 20;
    return Number.isFinite(pt) ? { kind: 'length', pt } : null;
  }
  const percent = /^(\d{1,7}(?:\.\d{1,4})?)%$/.exec(raw);
  if (percent) {
    const value = Number(percent[1]);
    return Number.isFinite(value) ? { kind: 'percent', percent: value } : null;
  }
  const universal = /^(\d{1,9}(?:\.\d{1,4})?)(mm|cm|in|pt|pc|pi)$/.exec(raw);
  if (universal) {
    const pt = Number(universal[1]) * MEASURE_UNIT_PT[universal[2]!]!;
    return Number.isFinite(pt) ? { kind: 'length', pt } : null;
  }
  return null;
}

/**
 * Read a CT_TblWidth element, clamped exactly like `twipsSide`: every number here is
 * attacker-controlled and feeds cell box geometry.
 *
 * An absent `w:type` is `dxa` per 17.4.87 (the schema declares no default, the prose does).
 * An unrecognised type is NOT read as `dxa` — every sibling reader rejects a value it does
 * not recognise rather than reinterpreting it, and reading `w:type="Pct"` as an absolute
 * measurement turns a 100% table into a 250pt one.
 *
 * 17.4.87 also settles the conflict case: where the type and the measurement `w:w` actually
 * states contradict each other, the measurement wins and the type is ignored.
 */
export function readPreferredWidth(node: OoxmlElement | undefined): PreferredWidth {
  if (!node) return AUTO_PREFERRED_WIDTH;
  const rawType = attributeValue(node, 'type');
  if (rawType !== undefined && rawType !== 'pct' && rawType !== 'dxa') {
    return rawType === 'nil' ? { type: 'nil', value: 0 } : AUTO_PREFERRED_WIDTH;
  }

  const raw = attributeValue(node, 'w');
  if (raw === undefined) return AUTO_PREFERRED_WIDTH;
  const measure = readMeasurementOrPercent(raw);
  if (!measure) return AUTO_PREFERRED_WIDTH;

  // A bare number carries no unit of its own, so the type decides how to read it. A stated
  // `%` or `in` DOES carry one, and 17.4.87 says that statement overrides the type.
  const bare = /^\d{1,9}$/.test(raw);
  if (measure.kind === 'percent' || (bare && rawType === 'pct')) {
    const percent = measure.kind === 'percent' ? measure.percent : Number(raw) / 50;
    if (!Number.isFinite(percent) || percent <= 0) return AUTO_PREFERRED_WIDTH;
    return { type: 'pct', value: Math.min(percent, MAX_PREFERRED_PERCENT) };
  }
  if (!Number.isFinite(measure.pt) || measure.pt <= 0) return AUTO_PREFERRED_WIDTH;
  return { type: 'dxa', value: Math.min(measure.pt, MAX_COLUMN_WIDTH_PT) };
}

/** A CT_TblWidth read down to points, for the `dxa` geometry the placement reads use. */
export function preferredLengthPt(
  node: OoxmlElement | undefined,
  limit: number
): number | undefined {
  if (!node) return undefined;
  const width = readPreferredWidth(node);
  if (width.type !== 'dxa') return undefined;
  return Math.min(width.value, limit);
}

/** Declared `w:gridCol` elements, bounded before anything is allocated from them. */
export function gridColumnElements(table: OoxmlElement): readonly OoxmlElement[] {
  const grid = childNamed(table, 'tblGrid');
  if (!grid) return [];
  const cols: OoxmlElement[] = [];
  for (const child of grid.children) {
    if (child.kind !== 'textValue' && child.localName === 'gridCol') {
      cols.push(child);
      if (cols.length >= MAX_TABLE_COLUMNS) break;
    }
  }
  return cols;
}

/**
 * The INITIAL width of each grid column, or undefined for a column `w:tblGrid` does not
 * settle. 17.4.48 calls these the table's "default widths" and 17.4.16 is explicit that they
 * "determine the initial width of each grid column, which can then be overridden by ... the
 * preferred widths of specific cells" — so this is a seed, not the answer.
 *
 * Values are clamped exactly like `twipsSide`: `w="999999999"` otherwise becomes a
 * ~50,000,000pt column that every cell box and border stroke inherits. A column at or past
 * that ceiling is not geometry anyone authored — `MAX_COLUMN_WIDTH_PT` is wider than any
 * legal page — so it is dropped to undefined rather than kept as a 22-inch column that then
 * has to be exempted from every later fit. One unreadable column costs that column only; the
 * rest of the authored grid survives.
 */
function gridColumnWidthsPt(cols: readonly OoxmlElement[]): readonly (number | undefined)[] {
  const widths: (number | undefined)[] = [];
  for (const col of cols) {
    const raw = attributeValue(col, 'w');
    const measure = raw === undefined ? null : readMeasurementOrPercent(raw);
    if (!measure || measure.kind !== 'length' || !Number.isFinite(measure.pt) || measure.pt <= 0) {
      widths.push(undefined);
      continue;
    }
    widths.push(measure.pt > MAX_COLUMN_WIDTH_PT ? undefined : measure.pt);
  }
  return widths;
}

/** One cell's grid footprint and stated width preference. */
export interface CellWidthClaim {
  readonly start: number;
  readonly span: number;
  readonly preferred: PreferredWidth;
}

/** Floor for a column nothing states, so a resolved grid never contains a zero column. */
const MIN_DERIVED_COLUMN_PT = 1;

/** Rounding slack when comparing a resolved table width against the content box. */
const WIDTH_EPSILON_PT = 0.001;

/**
 * Lay the authored `w:tcW` preferences over the seed grid.
 *
 * 17.18.87 describes exactly this reconciliation: a cell's `tcW` sets the width of the grid
 * columns its `gridSpan` covers, and "for each subsequent row ... each grid column is
 * adjusted to be the MAXIMUM value of the requested widths (if the widths do not agree)".
 * So a later row asking for more wins, and a narrower footprint is authoritative over a
 * spanning one — a span states the total across its columns, not any one column's width.
 *
 * Claims are applied narrowest-span-first so single-column statements land before the spans
 * that contain them; a span then distributes only the width its settled columns have not
 * already accounted for.
 */
function applyWidthClaims(
  seed: readonly (number | undefined)[],
  claims: readonly CellWidthClaim[],
  columnCount: number,
  tableWidthPt: number
): (number | undefined)[] {
  const settled: (number | undefined)[] = [];
  for (let index = 0; index < columnCount; index += 1) settled.push(seed[index]);

  // `.filter` already returns a fresh array, so this never mutates the caller's claims and
  // needs no spread — `claims` grows with the table's cell count and is attacker-sized.
  const ordered = claims
    .filter(
      (claim) =>
        claim.start < columnCount &&
        (claim.preferred.type === 'dxa' || (claim.preferred.type === 'pct' && tableWidthPt > 0))
    )
    .sort((a, b) => a.span - b.span);

  for (const claim of ordered) {
    const last = Math.min(claim.start + claim.span, columnCount);
    if (last <= claim.start) continue;
    // 17.4.71: a `pct` cell width is relative to the overall width of the TABLE.
    const stated =
      claim.preferred.type === 'pct'
        ? (tableWidthPt * claim.preferred.value) / 100
        : claim.preferred.value;
    if (!Number.isFinite(stated) || stated <= 0) continue;

    if (last - claim.start === 1) {
      // A single-column claim states that column outright; maximum wins across rows.
      const current = settled[claim.start];
      settled[claim.start] = current === undefined ? stated : Math.max(current, stated);
      continue;
    }
    // A span only gets to state the columns nothing narrower has settled, and only with
    // whatever of its total those settled columns leave over.
    const open: number[] = [];
    let remaining = stated;
    for (let index = claim.start; index < last; index += 1) {
      const current = settled[index];
      if (current === undefined) open.push(index);
      else remaining -= current;
    }
    if (open.length === 0 || remaining <= 0) continue;
    const each = remaining / open.length;
    for (const index of open) settled[index] = each;
  }
  return settled;
}

/**
 * The table's resolved column widths, in points.
 *
 * `w:tblGrid` seeds the columns, the authored `w:tcW`/`w:wBefore` preferences are laid over
 * it (see {@link applyWidthClaims}), and anything still unstated shares what the content
 * width has left. Columns never resolve to zero.
 *
 * Fit is then applied per 17.18.87. The table's total is measured against `w:tblW`, and
 * "if at any stage, the preferred width requested for the cells exceeds the preferred width
 * of the table, then each grid column is proportionally reduced in size to fit" — that
 * reduction belongs to BOTH layout algorithms, so a fixed table is still held to a stated
 * `w:tblW`. What is autofit-only is the PAGE clamp: 17.18.87 ends the autofit override chain
 * with "override the preferred table width until the table reaches the page width", and says
 * nothing of the sort for fixed. A fixed table with no `w:tblW` therefore renders past the
 * right margin, which is what Word does; an autofit table never exceeds the text column.
 *
 * A `pct` table width is a two-way instruction — it is Word's "AutoFit to Window", so a
 * table narrower than its stated percentage is stretched up to it as well as shrunk down.
 * An absolute or absent width only ever shrinks: a narrow autofit table is already showing
 * what Word shows, and stretching it would invent geometry no one authored.
 */
export function resolveColumnWidthsPt(input: {
  readonly gridCols: readonly OoxmlElement[];
  readonly claims: readonly CellWidthClaim[];
  readonly columnCount: number;
  readonly contentWidthPt: number;
  readonly tableWidth: PreferredWidth;
  readonly layoutFixed: boolean;
}): readonly number[] {
  const { columnCount, tableWidth } = input;
  // A caller with a degenerate or non-finite content box has told us nothing about the page.
  // The authored grid is still perfectly good evidence on its own, so resolve from it and
  // skip the page clamp rather than scaling the table down to a sliver of a width that was
  // never a real measurement.
  const hasPage = Number.isFinite(input.contentWidthPt) && input.contentWidthPt > 0;
  const available = hasPage ? input.contentWidthPt : MIN_DERIVED_COLUMN_PT;

  // 17.4.63: a `pct` TABLE width is relative to the page's text extents, unlike `tcW`'s
  // basis, which is the table itself.
  const statedTableWidth =
    tableWidth.type === 'dxa'
      ? tableWidth.value
      : tableWidth.type === 'pct'
        ? (available * tableWidth.value) / 100
        : 0;

  const seed = gridColumnWidthsPt(input.gridCols);
  const settled = applyWidthClaims(seed, input.claims, columnCount, statedTableWidth);

  let stated = 0;
  let unsettled = 0;
  for (const width of settled) {
    if (width === undefined) unsettled += 1;
    else stated += width;
  }
  const resolved: number[] = [];
  if (unsettled > 0) {
    // Nothing states these columns. Give them what the content width has left over, capped
    // at the mean of the stated columns so a `w:gridBefore` band or one unstated column
    // cannot swallow the whole page, and floored so none collapses.
    const mean =
      stated > 0 ? stated / Math.max(columnCount - unsettled, 1) : available / columnCount;
    const leftover = Math.max(available - stated, 0) / unsettled;
    const each = Math.max(Math.min(leftover, mean), MIN_DERIVED_COLUMN_PT);
    for (const width of settled) resolved.push(width ?? each);
  } else {
    for (const width of settled) resolved.push(width!);
  }

  const total = resolved.reduce((sum, width) => sum + width, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return new Array<number>(columnCount).fill(available / columnCount);
  }

  // Never let a stated width crush the table to nothing. `w:tblW w:w="1"` is a hostile
  // instruction rather than a layout request, and a nested table inside a degenerate cell
  // would otherwise be scaled below the hairline `preferredColumnWidthsPt` guarantees. The
  // floor wins over the clamp: overflowing a 3pt cell is recoverable, a zero-width column is
  // not.
  const floor = columnCount * MIN_DERIVED_COLUMN_PT;
  const pageCap = input.layoutFixed || !hasPage ? Number.POSITIVE_INFINITY : available;
  const target = Math.max(
    statedTableWidth > 0 ? Math.min(statedTableWidth, pageCap) : Math.min(total, pageCap),
    floor
  );

  // Only a `pct` table width stretches a narrow table up to its target.
  const stretches = tableWidth.type === 'pct' && statedTableWidth > 0;
  if (total <= target + WIDTH_EPSILON_PT && !stretches) return resolved;
  if (Math.abs(total - target) <= WIDTH_EPSILON_PT) return resolved;
  const scale = target / total;
  return resolved.map((width) => width * scale);
}
