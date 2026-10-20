// Which of a table style's conditional formats apply to one cell: `w:tblLook`, `w:cnfStyle`
// and the layering order of the result.
import type { OoxmlElement } from '@docx-editor.dev/core/store';

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
 * `w:tblLook` (17.4.56): which conditional formats of the table style are live.
 *
 * Word writes both the modern attributes (`w:firstRow="1"`) and the legacy `w:val`
 * bitmask, and older producers write only the bitmask. Both are read; an attribute wins
 * where the two disagree, because that is the newer statement.
 */
export interface TableLook {
  readonly firstRow: boolean;
  readonly lastRow: boolean;
  readonly firstColumn: boolean;
  readonly lastColumn: boolean;
  readonly rowBanding: boolean;
  readonly columnBanding: boolean;
}

/**
 * No `w:tblLook` at all says exactly what an empty `<w:tblLook/>` says. `noHBand`/`noVBand`
 * are NEGATIVE flags and the legacy bitmask defaults to `0000`, so 17.4.56's default is to
 * apply row and column banding but neither the first/last row nor the first/last column
 * format. Reading the absent element as "nothing is live" made the same semantic state
 * render two different ways depending on whether the producer wrote the empty tag.
 */
const DEFAULT_TABLE_LOOK: TableLook = Object.freeze({
  firstRow: false,
  lastRow: false,
  firstColumn: false,
  lastColumn: false,
  rowBanding: true,
  columnBanding: true,
});

function onOff(node: OoxmlElement, name: string): boolean | undefined {
  const raw = attributeValue(node, name);
  if (raw === undefined) return undefined;
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

/**
 * `w:tblLook` is read from the TABLE's own `w:tblPr` only, never cascaded from the style it
 * names. The schema admits `w:tblLook` inside a table style's `w:tblPr`, but the look is
 * Word's per-table "Table Style Options" checkbox set — a property of this table's use of
 * the style, not of the style — and Word writes one on every table it creates.
 */
export function readTableLook(tblPr: OoxmlElement | undefined): TableLook {
  const look = tblPr && childNamed(tblPr, 'tblLook');
  if (!look) return DEFAULT_TABLE_LOOK;
  // The legacy bitmask: 0x0020 firstRow, 0x0040 lastRow, 0x0080 firstColumn,
  // 0x0100 lastColumn, 0x0200 NO row banding, 0x0400 NO column banding.
  const rawVal = attributeValue(look, 'val');
  const mask = rawVal && /^[0-9A-Fa-f]{1,4}$/.test(rawVal) ? Number.parseInt(rawVal, 16) : 0;
  return {
    firstRow: onOff(look, 'firstRow') ?? (mask & 0x0020) !== 0,
    lastRow: onOff(look, 'lastRow') ?? (mask & 0x0040) !== 0,
    firstColumn: onOff(look, 'firstColumn') ?? (mask & 0x0080) !== 0,
    lastColumn: onOff(look, 'lastColumn') ?? (mask & 0x0100) !== 0,
    rowBanding:
      onOff(look, 'noHBand') === undefined ? (mask & 0x0200) === 0 : !onOff(look, 'noHBand'),
    columnBanding:
      onOff(look, 'noVBand') === undefined ? (mask & 0x0400) === 0 : !onOff(look, 'noVBand'),
  };
}

/** Bit positions of `w:cnfStyle/@w:val` (17.4.7 row, 17.4.8 cell), most significant first. */
const CNF_BITS = [
  'firstRow',
  'lastRow',
  'firstCol',
  'lastCol',
  'band1Vert',
  'band2Vert',
  'band1Horz',
  'band2Horz',
  'nwCell',
  'neCell',
  'swCell',
  'seCell',
] as const;

/** The same twelve conditions as named `w:cnfStyle` attributes (CT_Cnf), in bit order. */
const CNF_ATTRIBUTES = [
  'firstRow',
  'lastRow',
  'firstColumn',
  'lastColumn',
  'oddVBand',
  'evenVBand',
  'oddHBand',
  'evenHBand',
  'firstRowFirstColumn',
  'firstRowLastColumn',
  'lastRowFirstColumn',
  'lastRowLastColumn',
] as const;

/**
 * `w:cnfStyle`: the producer stating which conditions a row or cell is under.
 *
 * Read like `w:tblLook`, from both encodings — the legacy `w:val` bitmask and the named
 * attributes, which are all a strict-conformant producer writes.
 */
function readCnfStyle(container: OoxmlElement | undefined, into: Set<string>): void {
  const cnf = container && childNamed(container, 'cnfStyle');
  if (!cnf) return;
  const raw = attributeValue(cnf, 'val');
  if (raw && /^[01]{1,12}$/.test(raw)) {
    for (let index = 0; index < raw.length && index < CNF_BITS.length; index += 1) {
      if (raw[index] === '1') into.add(CNF_BITS[index]!);
    }
  }
  for (let index = 0; index < CNF_ATTRIBUTES.length; index += 1) {
    if (onOff(cnf, CNF_ATTRIBUTES[index]!) === true) into.add(CNF_BITS[index]!);
  }
}

/**
 * Word layers a table style's conditional formats weakest first: the whole table, then the
 * bands, then first/last column, then first/last row, then the four corners (17.7.6). Both
 * the derived and the stated conditions emit through this one order — `w:cnfStyle` lists
 * its conditions in BIT order, which puts the bands last and let a banding fill overwrite
 * the shading of a styled header row.
 */
const CONDITION_PRECEDENCE = [
  'band1Vert',
  'band2Vert',
  'band1Horz',
  'band2Horz',
  'firstCol',
  'lastCol',
  'firstRow',
  'lastRow',
  'nwCell',
  'neCell',
  'swCell',
  'seCell',
] as const;

/**
 * Which of the style's conditional formats apply to one cell, weakest first.
 *
 * A `w:cnfStyle` is added to the derivation rather than replacing it: it is a cache the
 * producer wrote, and a row that states "I am the header" is still in whichever column and
 * band the grid puts it in. Structural conditions key on the GRID COLUMN the cell occupies,
 * so a `gridSpan` or a `w:gridBefore` earlier in the row cannot shift them.
 */
export function conditionalTypesFor(input: {
  readonly look: TableLook;
  readonly rowIndex: number;
  readonly rowCount: number;
  readonly gridColumn: number;
  readonly gridSpan: number;
  readonly columnCount: number;
  readonly rowProperties: OoxmlElement | undefined;
  readonly cellProperties: OoxmlElement | undefined;
}): readonly string[] {
  const active = new Set<string>();
  readCnfStyle(input.rowProperties, active);
  readCnfStyle(input.cellProperties, active);

  const { look, rowIndex, rowCount, gridColumn, gridSpan, columnCount } = input;
  const isFirstRow = active.has('firstRow') || (look.firstRow && rowIndex === 0);
  const isLastRow = active.has('lastRow') || (look.lastRow && rowIndex === rowCount - 1);
  const isFirstColumn = active.has('firstCol') || (look.firstColumn && gridColumn === 0);
  const isLastColumn =
    active.has('lastCol') || (look.lastColumn && gridColumn + gridSpan >= columnCount);

  const statedVBand = active.has('band1Vert') || active.has('band2Vert');
  if (!statedVBand && look.columnBanding && !isFirstColumn && !isLastColumn) {
    const band = gridColumn - (look.firstColumn ? 1 : 0);
    active.add(band % 2 === 0 ? 'band1Vert' : 'band2Vert');
  }
  const statedHBand = active.has('band1Horz') || active.has('band2Horz');
  if (!statedHBand && look.rowBanding && !isFirstRow && !isLastRow) {
    const band = rowIndex - (look.firstRow ? 1 : 0);
    active.add(band % 2 === 0 ? 'band1Horz' : 'band2Horz');
  }
  if (isFirstColumn) active.add('firstCol');
  if (isLastColumn) active.add('lastCol');
  if (isFirstRow) active.add('firstRow');
  if (isLastRow) active.add('lastRow');
  if (isFirstRow && isFirstColumn) active.add('nwCell');
  if (isFirstRow && isLastColumn) active.add('neCell');
  if (isLastRow && isFirstColumn) active.add('swCell');
  if (isLastRow && isLastColumn) active.add('seCell');

  const ordered: string[] = [];
  for (const condition of CONDITION_PRECEDENCE) if (active.has(condition)) ordered.push(condition);
  return ordered;
}
