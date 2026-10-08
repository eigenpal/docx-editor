// Moving an ordinary table row to new column widths without laying its cells out again.
//
// When AutoFit widths change, most rows hold one paragraph per cell, each a single line that
// still fits. Such a row keeps every vertical measurement: its line, spacing, insets and end
// mark do not depend on width. Only x and width change, and those come from the line the
// placement measured, aligned again by the same code a fresh placement runs.
//
// Placement records that measured line beside the paragraph fragment, keyed by the fragment's
// range object. That object is created once per placement and survives vertical shifts, row
// finalize and this reuse, so the record never outlives the fragments that share it.
//
// A cell reuses its line only when a fresh placement would take the same break:
// - the same paragraph node, layout inputs (apart from `available`), and break-key inputs
//   apart from width, so the break cache would answer from an entry with that line;
// - a line that holds at the new width under the break cache's own width-transfer rule, or
//   an empty line with no placement ties;
// - no list item, right-to-left text, page wrap zones, merges, or paragraph furniture that
//   is drawn from the line box (borders, shading, markers, mark revisions).
// Anything else returns null, and the row is laid out normally.

import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import {
  cellAvailableWidth,
  cellParagraphBreakInputs,
  cellParagraphInputs,
  memoizedCellParagraphBreakInputs,
  memoizedCellParagraphInputs,
} from './cell-paragraph-inputs.ts';
import { cellBreakKeyPartsMatch, type CellBreakKeyParts } from './cell-break-key.ts';
import { alignCellLine } from './cell-line-alignment.ts';
import { rowsClearOutOfCellFloats } from './cell-anchor-layout.ts';
import { directionalListFirstLineShift } from './list-marker.ts';
import {
  LINE_HOLD_TOLERANCE_PT,
  lineTiedToPlacement,
  tokenLineHoldsAtWidth,
} from './paragraph-cache-width-reuse.ts';
import { lineContentX, type PendingLine } from './pending-line.ts';
import type { SemanticTableRow } from './semantic-table.ts';
import { MIN_CELL_BOX_PT, sumCols, type TableFlowDeps } from './semantic-table-layout.ts';
import type { ParagraphLayoutInputs } from './style-cascade.ts';
import { sharedCellContentInsets } from './cell-content-insets-memo.ts';
import { cellFlowBox } from './table-cell-text-direction.ts';
import type {
  LineRecord,
  ParagraphFragmentRecord,
  TableCellFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';

interface CellLine {
  /** The break-cache key placement read its line from; the entry holds the line itself. */
  readonly key: string;
  readonly paragraph: OoxmlElement;
  readonly inputs: ParagraphLayoutInputs;
  readonly properties: readonly OoxmlProperty[];
  readonly parts: CellBreakKeyParts;
  /** Identities of the measurer, style cascade and author filter; see `identityOf`. */
  readonly measurer: number;
  readonly styleCascade: number;
  readonly compatibilityMode: TableFlowDeps['compatibilityMode'];
  readonly displayMode: TableFlowDeps['displayMode'];
  readonly revisionAuthorFilter: number;
}

/** Per row: the identities every cell of it compares, read once. */
interface MoveContext {
  readonly deps: TableFlowDeps;
  readonly cache: NonNullable<TableFlowDeps['cache']>;
  readonly measurer: number;
  readonly styleCascade: number;
  readonly revisionAuthorFilter: number;
  readonly cols: readonly number[];
  readonly geometry: ColumnGeometry;
  readonly left: number;
}

let movedRowsObserver: { moved: number; fieldScans: number } | null = null;

/**
 * @internal Counts rows moved without placement, and placed blocks a move had to scan for
 * unmovable fields, for tests that must see the reuse.
 */
export function movedRowsTestRecorder(): {
  readonly moved: number;
  readonly fieldScans: number;
  dispose(): void;
} {
  const observer = { moved: 0, fieldScans: 0 };
  movedRowsObserver = observer;
  return {
    get moved() {
      return observer.moved;
    },
    get fieldScans() {
      return observer.fieldScans;
    },
    dispose() {
      if (movedRowsObserver === observer) movedRowsObserver = null;
    },
  };
}

/**
 * A number per measurer, style cascade or author filter object. A record compares these instead
 * of holding the objects: a measurer reaches its font caches and, through them, whatever a layout
 * pass left on the stack, so a record that outlives its layout must not keep one alive.
 */
const identities = new WeakMap<object, number>();
let nextIdentity = 1;
function identityOf(value: object | undefined): number {
  if (value === undefined) return 0;
  let known = identities.get(value);
  if (known === undefined) identities.set(value, (known = nextIdentity++));
  return known;
}

/** Keyed by a placed paragraph fragment's `range` object; see the module comment. */
const cellLines = new WeakMap<object, CellLine>();

/** Paragraph fragment fields that do not depend on the line box's x or width. */
const MOVABLE_FIELDS = new Set([
  'kind',
  'id',
  'paragraphEnd',
  'paragraphId',
  'fragmentIndex',
  'range',
  'props',
  'styleId',
  'outlineLevel',
  'alignment',
  'spacing',
  'indent',
  'tabStops',
  'lines',
  'emptyParagraphStyle',
  'paragraphMarkSizePt',
  'box',
]);

/** True when `line` gives the same break at `available` as wherever it was measured. */
function lineHolds(line: PendingLine, available: number): boolean {
  if (line.spans.length > 0) return tokenLineHoldsAtWidth(line, available);
  return (
    !lineTiedToPlacement(line) &&
    line.width + Math.max(0, line.firstLineOffset ?? 0) <= available + LINE_HOLD_TOLERANCE_PT
  );
}

/**
 * Record the break-cache entry a complete, single-line cell paragraph was placed from. Called
 * by cell placement only for a paragraph that starts on this fragment, outside page wrap
 * zones, with no list item and left-to-right text. Nothing is recorded without a cache.
 */
export function rememberCellLine(
  fragment: ParagraphFragmentRecord,
  paragraph: OoxmlElement,
  lines: readonly PendingLine[],
  inputs: ParagraphLayoutInputs,
  properties: readonly OoxmlProperty[],
  parts: CellBreakKeyParts,
  deps: TableFlowDeps,
  key: string | undefined
): void {
  const pending = lines[0];
  const line = fragment.lines[0];
  if (key === undefined || !deps.cache || lines.length !== 1 || !pending || !line) return;
  if (fragment.lines.length !== 1 || !placedFrom(line, pending)) return;
  if (!onlyMovableFields(fragment)) return;
  // The first move after a full layout reads this very fragment; its keys never change.
  movableBlocks.add(fragment);
  cellLines.set(fragment.range, {
    key,
    paragraph,
    inputs,
    properties,
    parts,
    measurer: identityOf(deps.measurer),
    styleCascade: identityOf(deps.styleCascade),
    compatibilityMode: deps.compatibilityMode,
    displayMode: deps.displayMode,
    revisionAuthorFilter: identityOf(deps.revisionAuthorFilter),
  });
}

/** `line` was placed whole from `pending`: no merge remap, no collapse, no placement ties. */
function placedFrom(line: LineRecord, pending: PendingLine): boolean {
  return (
    line.range.start === pending.start &&
    line.range.end === pending.end &&
    line.box.height === pending.height &&
    !lineTiedToPlacement(pending)
  );
}

function sameProperties(a: readonly OoxmlProperty[], b: readonly OoxmlProperty[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index]!;
    const y = b[index]!;
    if (x === y) continue;
    if (x.localName !== y.localName) return false;
    const left = x.attributes;
    const right = y.attributes;
    if (left === right) continue;
    if (!left || !right) return false;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    for (const key of keys) if (left[key] !== right[key]) return false;
  }
  return true;
}

function sameInputsExceptWidth(a: ParagraphLayoutInputs, b: ParagraphLayoutInputs): boolean {
  if (a === b) return true;
  // Key loops without key arrays: this runs for every moved cell.
  let count = 0;
  for (const key in a) {
    count += 1;
    if (
      key !== 'available' &&
      a[key as keyof ParagraphLayoutInputs] !== b[key as keyof ParagraphLayoutInputs]
    )
      return false;
  }
  for (const _key in b) count -= 1;
  return count === 0;
}

function onlyMovableFields(block: ParagraphFragmentRecord): boolean {
  if (movableBlocks.has(block)) return true;
  for (const field in block) if (!MOVABLE_FIELDS.has(field)) return false;
  return true;
}

/**
 * Blocks known to hold only movable fields: fragments `rememberCellLine` checked, and blocks
 * built from one with the same keys (`withLines`, a move). Records are never mutated, so the
 * answer holds for the object; any other copy, such as a vertical shift, is checked again.
 */
const movableBlocks = new WeakSet<ParagraphFragmentRecord>();

/**
 * Check a derived copy while placement still owns it, when its source was movable.
 * The copy is checked independently: added paragraph furniture must still refuse reuse.
 * This avoids repeating the check when a later width change reads the placed copy.
 */
export function rememberMovableCopy(
  source: ParagraphFragmentRecord,
  copy: ParagraphFragmentRecord
): ParagraphFragmentRecord {
  if (movableBlocks.has(source) && onlyMovableFields(copy)) movableBlocks.add(copy);
  return copy;
}

/**
 * `block` with new `lines`, keeping what is known about its fields. Every paragraph fragment
 * owns `lines`, so the copy has exactly the keys of `block`.
 */
export function withLines(
  block: ParagraphFragmentRecord,
  lines: ParagraphFragmentRecord['lines']
): ParagraphFragmentRecord {
  const copy = { ...block, lines };
  if (movableBlocks.has(block)) movableBlocks.add(copy);
  return copy;
}

interface ColumnGeometry {
  readonly lefts: readonly number[];
  readonly widths: readonly number[];
  readonly total: number;
}

/**
 * Cell left edges and single-column widths for one column-width array, computed by the
 * same `sumCols` calls row placement makes, so every value is bit-identical to placement's.
 */
const columnGeometry = new WeakMap<readonly number[], ColumnGeometry>();
function columnGeometryOf(cols: readonly number[]): ColumnGeometry {
  let known = columnGeometry.get(cols);
  if (!known) {
    known = {
      lefts: cols.map((_, index) => sumCols(cols, 0, index)),
      widths: cols.map((_, index) => sumCols(cols, index, index + 1)),
      total: sumCols(cols, 0, cols.length),
    };
    columnGeometry.set(cols, known);
  }
  return known;
}

/** The cell at new widths, or null when a fresh placement could differ. */
function moveCell(
  cell: SemanticTableRow['cells'][number],
  placed: TableCellFragmentRecord,
  context: MoveContext
): TableCellFragmentRecord | null {
  const { deps, cache, cols, geometry } = context;
  const paragraph = cell.blocks[0];
  const block = placed.blocks[0];
  if (
    cell.blocks.length !== 1 ||
    placed.blocks.length !== 1 ||
    paragraph?.kind !== 'paragraph' ||
    block?.kind !== 'paragraph' ||
    block.paragraphId !== paragraph.id ||
    deps.listItems?.has(paragraph.id)
  )
    return null;
  if (movedRowsObserver && !movableBlocks.has(block)) movedRowsObserver.fieldScans += 1;
  if (!onlyMovableFields(block)) return null;
  const known = cellLines.get(block.range);
  if (
    !known ||
    known.paragraph !== paragraph ||
    known.measurer !== context.measurer ||
    known.styleCascade !== context.styleCascade ||
    known.compatibilityMode !== deps.compatibilityMode ||
    known.displayMode !== deps.displayMode ||
    known.revisionAuthorFilter !== context.revisionAuthorFilter
  )
    return null;
  // Cell and content boxes exactly as row placement derives them, cell spacing excluded.
  const { gridColumn, gridSpan } = cell;
  const single = gridSpan === 1 && gridColumn < cols.length;
  const x = context.left + (single ? geometry.lefts[gridColumn]! : sumCols(cols, 0, gridColumn));
  const width = Math.max(
    (single
      ? geometry.widths[gridColumn]!
      : sumCols(cols, gridColumn, Math.min(gridColumn + gridSpan, cols.length))) || geometry.total,
    MIN_CELL_BOX_PT
  );
  const insets = deps.cellContentInsets?.get(cell.id) ?? sharedCellContentInsets(cell, true);
  const { flowLeft, flowRight } = cellFlowBox(false, x, width, 0, 0, insets);
  const contentWidth = Math.max(1, flowRight - flowLeft);
  // A move reads the memo without replacing it: only `available` depends on width.
  const inputs =
    memoizedCellParagraphInputs(
      paragraph,
      deps.styleCascade,
      undefined,
      cell.styleFormatting,
      deps.paragraphLineUnitPt
    ) ??
    cellParagraphInputs(
      paragraph,
      contentWidth,
      deps.styleCascade,
      undefined,
      cell.styleFormatting,
      deps.paragraphLineUnitPt
    );
  if (!sameInputsExceptWidth(inputs, known.inputs)) return null;
  const { indent } = inputs;
  const available = cellAvailableWidth(inputs, contentWidth);
  const hostedListToken = deps.hostedStory?.hostedListTokenForParagraph?.(paragraph) ?? '';
  const refToken = deps.refFields?.tokenForParagraph(paragraph.id) ?? '';
  const { tabStops, properties } =
    memoizedCellParagraphBreakInputs(
      paragraph,
      inputs,
      deps.defaultTabStopPt,
      undefined,
      hostedListToken,
      refToken
    ) ??
    cellParagraphBreakInputs(paragraph, inputs, deps.defaultTabStopPt, {
      listToken: undefined,
      hostedListToken,
      refToken,
    });
  if (
    !cellBreakKeyPartsMatch(
      paragraph,
      deps,
      known.parts.inTableCell,
      known.parts.cellEndMark,
      rowsClearOutOfCellFloats(deps, paragraph.id),
      known.parts
    ) ||
    !sameProperties(properties, known.properties)
  )
    return null;
  // The entry placement read: every key input but width matches, so a fresh placement at this
  // width takes the same line whenever the cache's own width transfer accepts it.
  const lines = cache.get(known.key);
  const old = block.lines[0]!;
  const pending = lines?.length === 1 ? lines[0]! : undefined;
  if (!pending || !placedFrom(old, pending) || !lineHolds(pending, available)) return null;
  const firstLineOffset = directionalListFirstLineShift(
    undefined,
    indent,
    deps.measurer,
    tabStops,
    available,
    false
  );
  const lineIndent = flowLeft + indent.left + firstLineOffset;
  const lineWidth = Math.max(1, available - firstLineOffset);
  const content = alignCellLine(
    pending,
    paragraph.id,
    flowLeft,
    old.box.y,
    [],
    lineIndent,
    lineWidth,
    true,
    {
      measurer: deps.measurer,
      styleCascade: deps.styleCascade,
      props: inputs.props,
      alignment: inputs.alignment,
      rtl: false,
      inTableCell: known.parts.inTableCell,
    }
  );
  const spans = content.spans;
  // Alignment moves spans along x only; anything else is not this line any more.
  if (spans.length !== old.spans.length) return null;
  for (let index = 0; index < spans.length; index += 1)
    if (spans[index]!.box.y !== old.spans[index]!.box.y) return null;
  const line = {
    ...old,
    spans,
    contentX: lineContentX(spans, [], lineIndent + content.offset),
    box: { ...old.box, x: flowLeft + indent.left, width: available },
  };
  const moved: ParagraphFragmentRecord = {
    ...block,
    lines: [line],
    box: { ...block.box, x: flowLeft + indent.left, width: available },
  };
  movableBlocks.add(moved);
  deps.onCellBreakKey?.(known.key);
  // Row finalize resolves `borders` again in the same key position.
  return { ...placed, blocks: [moved], box: { ...placed.box, x, width } };
}

/**
 * `placed` (a finalized row of the previous layout) at new column widths and table origin,
 * or null when any cell needs a fresh placement. Vertical geometry is the placed row's.
 */
export function moveRowToWidths(
  row: SemanticTableRow,
  placed: TableRowFragmentRecord,
  cols: readonly number[],
  left: number,
  deps: TableFlowDeps
): TableRowFragmentRecord | null {
  if (
    row.isHeader ||
    placed.isHeaderRepeat ||
    placed.isContinuation ||
    placed.hasContinuation ||
    row.cells.length !== placed.cells.length ||
    !deps.cache
  )
    return null;
  const geometry = columnGeometryOf(cols);
  const context: MoveContext = {
    deps,
    cache: deps.cache,
    measurer: identityOf(deps.measurer),
    styleCascade: identityOf(deps.styleCascade),
    revisionAuthorFilter: identityOf(deps.revisionAuthorFilter),
    cols,
    geometry,
    left,
  };
  const cells: TableCellFragmentRecord[] = [];
  for (let index = 0; index < row.cells.length; index += 1) {
    const cell = row.cells[index]!;
    const before = placed.cells[index]!;
    if (
      cell.id !== before.id ||
      cell.vMergeContinue ||
      cell.textDirection !== 'horizontal' ||
      before.rowSpan !== 1 ||
      before.paintInert
    )
      return null;
    const moved = moveCell(cell, before, context);
    if (!moved) return null;
    cells.push(moved);
  }
  if (movedRowsObserver) movedRowsObserver.moved += 1;
  return { ...placed, cells, box: { ...placed.box, x: left, width: geometry.total } };
}
