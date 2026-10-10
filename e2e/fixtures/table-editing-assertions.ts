/**
 * Canonical readback helpers for table-editing browser acceptance.
 * Assertions use OOXML topology and D9 oracles — not painted table DOM.
 */

import {
  canonicalOoxmlFingerprint,
  diffSemanticDigests,
  readOoxmlPackage,
  readOoxmlPart,
  semanticDigest,
  serializeOoxmlPart,
  type DigestDifference,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../../packages/core/src/store/package/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface TableSnapshot {
  readonly tableId: string;
  readonly rowCount: number;
  readonly columnWidthsTwips: readonly number[];
  readonly cellTexts: readonly string[];
}

export interface BorderSideSnapshot {
  readonly attrs: Record<string, string>;
}

export interface CellDetailSnapshot {
  readonly cellId: string;
  readonly paragraphIds: readonly string[];
  readonly text: string;
  readonly tcWidthTwips: number | null;
  readonly borders: {
    readonly top: BorderSideSnapshot;
    readonly left: BorderSideSnapshot;
    readonly bottom: BorderSideSnapshot;
    readonly right: BorderSideSnapshot;
  };
  readonly fill: Record<string, string> | null;
  readonly tcPrFingerprint: string;
  readonly tcPrDecorationFingerprint: string;
}

export interface RowDetailSnapshot {
  readonly rowId: string;
  readonly cells: readonly CellDetailSnapshot[];
}

export interface DetailedTableSnapshot extends TableSnapshot {
  readonly gridColumnIds: readonly string[];
  readonly rows: readonly RowDetailSnapshot[];
}

export interface TableEditingReadback {
  readonly fingerprint: string;
  readonly digest: ReturnType<typeof semanticDigest>;
  readonly tables: readonly TableSnapshot[];
  readonly outer: TableSnapshot | null;
  readonly inner: TableSnapshot | null;
}

function collectByKind(root: OoxmlNode, kind: OoxmlElement['kind']): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === kind) found.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return found;
}

function wmlChild(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children ?? []) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

function wmlAttr(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attr) => attr.localName === localName)?.value;
}

function paragraphText(cell: OoxmlElement): string {
  const texts: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') {
      texts.push(node.value ?? '');
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const child of cell.children ?? []) {
    if (child.kind === 'paragraph') visit(child);
  }
  return texts.join('');
}

function gridColumnWidthsTwips(table: OoxmlElement): number[] {
  const grid = wmlChild(table, 'tblGrid');
  if (!grid) return [];
  const widths: number[] = [];
  for (const child of grid.children ?? []) {
    if (child.kind !== 'textValue' && child.localName === 'gridCol') {
      widths.push(Number(wmlAttr(child, 'w') ?? '0'));
    }
  }
  return widths;
}

function gridColumnIds(table: OoxmlElement): string[] {
  const grid = wmlChild(table, 'tblGrid');
  if (!grid) return [];
  const ids: string[] = [];
  for (const child of grid.children ?? []) {
    if (child.kind !== 'textValue' && child.localName === 'gridCol') {
      ids.push(child.id);
    }
  }
  return ids;
}

function borderSideSnapshot(
  cell: OoxmlElement,
  side: 'top' | 'left' | 'bottom' | 'right'
): BorderSideSnapshot {
  const tcPr = wmlChild(cell, 'tcPr');
  const tcBorders = tcPr && wmlChild(tcPr, 'tcBorders');
  const sideEl = tcBorders && wmlChild(tcBorders, side);
  if (!sideEl) return { attrs: {} };
  const attrs: Record<string, string> = {};
  for (const attr of sideEl.attributes) {
    if (attr.localName) attrs[attr.localName] = String(attr.value);
  }
  return { attrs };
}

function cellFillSnapshot(cell: OoxmlElement): Record<string, string> | null {
  const tcPr = wmlChild(cell, 'tcPr');
  const shd = tcPr && wmlChild(tcPr, 'shd');
  if (!shd) return null;
  const attrs: Record<string, string> = {};
  for (const attr of shd.attributes) {
    if (attr.localName) attrs[attr.localName] = String(attr.value);
  }
  return Object.keys(attrs).length > 0 ? attrs : null;
}

function cellWidthTwips(cell: OoxmlElement): number | null {
  const tcPr = wmlChild(cell, 'tcPr');
  const tcW = tcPr && wmlChild(tcPr, 'tcW');
  if (!tcW) return null;
  const w = wmlAttr(tcW, 'w');
  return w === undefined ? null : Number(w);
}

function cloneNode(node: OoxmlNode): OoxmlNode {
  if (node.kind === 'textValue') {
    return { kind: 'textValue', id: node.id, value: node.value };
  }
  return {
    ...node,
    attributes: [...node.attributes],
    namespaceBindings: [...node.namespaceBindings],
    children: node.children?.map(cloneNode),
  } as OoxmlNode;
}

function cloneElement(node: OoxmlElement): OoxmlElement {
  return cloneNode(node) as OoxmlElement;
}

function tcPrDecorationFingerprint(cell: OoxmlElement): string {
  const tcPr = wmlChild(cell, 'tcPr');
  if (!tcPr) return '';
  const decorationChildren = (tcPr.children ?? []).filter(
    (child) => child.kind === 'textValue' || child.localName !== 'tcW'
  );
  const decorationRoot = cloneElement({
    ...tcPr,
    children: decorationChildren,
  } as OoxmlElement);
  return serializeOoxmlPart({
    id: 'fragment/tcPr-decoration',
    name: 'fragment/tcPr-decoration',
    contentType: 'application/xml',
    root: decorationRoot,
  }).replace(/\s+/g, '');
}

function tcPrFingerprint(cell: OoxmlElement): string {
  const tcPr = wmlChild(cell, 'tcPr');
  if (!tcPr) return '';
  return serializeOoxmlPart({
    id: 'fragment/tcPr',
    name: 'fragment/tcPr',
    contentType: 'application/xml',
    root: tcPr,
  }).replace(/\s+/g, '');
}

export function tableSnapshot(table: OoxmlElement): TableSnapshot {
  const rows = table.children.filter((child) => child.kind === 'tableRow');
  const cellTexts: string[] = [];
  for (const row of rows) {
    if (row.kind !== 'tableRow') continue;
    for (const cell of row.children) {
      if (cell.kind !== 'tableCell') continue;
      cellTexts.push(paragraphText(cell));
    }
  }
  return {
    tableId: table.id,
    rowCount: rows.length,
    columnWidthsTwips: gridColumnWidthsTwips(table),
    cellTexts,
  };
}

function paragraphTextFromNode(node: OoxmlNode): string {
  const texts: string[] = [];
  const visit = (current: OoxmlNode): void => {
    if (current.kind === 'textValue') {
      texts.push(current.value ?? '');
      return;
    }
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return texts.join('');
}

export function detailedTableSnapshot(table: OoxmlElement): DetailedTableSnapshot {
  const base = tableSnapshot(table);
  const rows: RowDetailSnapshot[] = [];
  for (const child of table.children) {
    if (child.kind !== 'tableRow') continue;
    const cells: CellDetailSnapshot[] = [];
    for (const cellNode of child.children) {
      if (cellNode.kind !== 'tableCell') continue;
      const paragraphIds: string[] = [];
      let text = '';
      for (const para of cellNode.children ?? []) {
        if (para.kind !== 'paragraph') continue;
        paragraphIds.push(para.id);
        text = paragraphTextFromNode(para);
      }
      cells.push({
        cellId: cellNode.id,
        paragraphIds,
        text,
        tcWidthTwips: cellWidthTwips(cellNode),
        borders: {
          top: borderSideSnapshot(cellNode, 'top'),
          left: borderSideSnapshot(cellNode, 'left'),
          bottom: borderSideSnapshot(cellNode, 'bottom'),
          right: borderSideSnapshot(cellNode, 'right'),
        },
        fill: cellFillSnapshot(cellNode),
        tcPrFingerprint: tcPrFingerprint(cellNode),
        tcPrDecorationFingerprint: tcPrDecorationFingerprint(cellNode),
      });
    }
    rows.push({ rowId: child.id, cells });
  }
  return { ...base, gridColumnIds: gridColumnIds(table), rows };
}

const INNER_ISOLATION_SENTINEL: OoxmlElement = {
  kind: 'generic',
  id: '__inner_isolation_sentinel__',
  namespaceUri: W,
  localName: 'tbl',
  attributes: [],
  namespaceBindings: [],
  children: [
    {
      kind: 'generic',
      id: '__inner_isolation_sentinel_grid__',
      namespaceUri: W,
      localName: 'tblGrid',
      attributes: [],
      namespaceBindings: [],
      children: [
        {
          kind: 'generic',
          id: '__inner_isolation_sentinel_col__',
          namespaceUri: W,
          localName: 'gridCol',
          attributes: [{ kind: 'genericExtension', localName: 'w', namespaceUri: W, value: '1' }],
          namespaceBindings: [],
          children: [],
        },
      ],
    },
  ],
};

function findNestedTableInHost(host: OoxmlElement, innerMarker: string): OoxmlElement | null {
  if (host.kind === 'table') {
    const snap = tableSnapshot(host);
    if (snap.cellTexts.some((text) => text.includes(innerMarker))) return host;
  }
  for (const child of host.children ?? []) {
    if (child.kind === 'textValue') continue;
    const found = findNestedTableInHost(child, innerMarker);
    if (found) return found;
  }
  return null;
}

function replaceNodeById(
  root: OoxmlElement,
  targetId: string,
  replacement: OoxmlElement
): OoxmlElement | null {
  if (root.id === targetId) return cloneElement(replacement);
  if (!root.children) return null;
  let replaced = false;
  const children = root.children.map((child) => {
    if (child.kind === 'textValue') return child;
    if (child.id === targetId) {
      replaced = true;
      return cloneNode(replacement);
    }
    const updated = replaceNodeById(child, targetId, replacement);
    if (updated) {
      replaced = true;
      return updated;
    }
    return child;
  });
  if (!replaced) return null;
  return cloneElement({ ...root, children } as OoxmlElement);
}

/** Canonical fingerprint of the outer host table with the nested inner subtree replaced by a sentinel. */
export function outerTableIsolationFingerprint(part: OoxmlPart, innerMarker = 'INNER-NW'): string {
  const outer = findTableByMarker(part, 'OUTER-TR');
  if (!outer) throw new Error('outer table missing');
  const cloned = cloneElement(outer);
  const inner = findNestedTableInHost(cloned, innerMarker);
  if (!inner) throw new Error('inner table missing in outer host');
  const isolated = replaceNodeById(cloned, inner.id, INNER_ISOLATION_SENTINEL);
  if (!isolated) throw new Error('failed to replace inner table with sentinel');
  return canonicalOoxmlFingerprint(isolated);
}

export function outerTableIsolationEqual(
  before: OoxmlPart,
  after: OoxmlPart,
  innerMarker = 'INNER-NW'
): boolean {
  return (
    outerTableIsolationFingerprint(before, innerMarker) ===
    outerTableIsolationFingerprint(after, innerMarker)
  );
}

function findTableByMarker(part: OoxmlPart, marker: string): OoxmlElement | undefined {
  return collectByKind(part.root, 'table').find((table) =>
    tableSnapshot(table).cellTexts.some((text) => text.includes(marker))
  );
}

export function readTableEditingPackage(bytes: Uint8Array): OoxmlPart {
  const opened = readOoxmlPackage(bytes, {});
  if (!opened.ok) throw new Error(`${opened.reason}: ${opened.detail ?? ''}`);
  const document = opened.package.parts.get(opened.package.mainDocumentPart);
  if (!document) throw new Error('word/document.xml missing');
  return document;
}

export function readTableEditingReadbackFromPart(part: OoxmlPart): TableEditingReadback {
  const tables = collectByKind(part.root, 'table').map(tableSnapshot);
  const outerTable = findTableByMarker(part, 'OUTER-TR');
  const innerTable = findTableByMarker(part, 'INNER-NW');
  return {
    fingerprint: canonicalOoxmlFingerprint(part),
    digest: semanticDigest([part]),
    tables,
    outer: outerTable ? tableSnapshot(outerTable) : null,
    inner: innerTable ? tableSnapshot(innerTable) : null,
  };
}

export function readTableEditingReadback(bytes: Uint8Array): TableEditingReadback {
  return readTableEditingReadbackFromPart(readTableEditingPackage(bytes));
}

export function reopenPart(part: OoxmlPart): OoxmlPart {
  const serialized = serializeOoxmlPart(part);
  const reopened = readOoxmlPart(serialized, {
    name: part.name,
    contentType: part.contentType,
  });
  if (!reopened.ok) throw new Error(reopened.reason);
  return reopened.part;
}

export function saveReopenDigestDiff(before: OoxmlPart, after: OoxmlPart): DigestDifference[] {
  return diffSemanticDigests(semanticDigest([before]), semanticDigest([after]));
}

export function cellBorderAttrs(
  part: OoxmlPart,
  cellId: string,
  side: 'top' | 'left' | 'bottom' | 'right'
): Record<string, string> {
  const cell = collectByKind(part.root, 'tableCell').find((candidate) => candidate.id === cellId);
  if (!cell) throw new Error(`cell missing: ${cellId}`);
  const tcPr = wmlChild(cell, 'tcPr');
  const tcBorders = tcPr && wmlChild(tcPr, 'tcBorders');
  const sideEl = tcBorders && wmlChild(tcBorders, side);
  if (!sideEl) return {};
  const out: Record<string, string> = {};
  for (const attr of sideEl.attributes) {
    if (attr.localName) out[attr.localName] = String(attr.value);
  }
  return out;
}

export function cellFill(part: OoxmlPart, cellId: string): string | undefined {
  const cell = collectByKind(part.root, 'tableCell').find((candidate) => candidate.id === cellId);
  if (!cell) return undefined;
  const tcPr = wmlChild(cell, 'tcPr');
  const shd = tcPr && wmlChild(tcPr, 'shd');
  return shd?.attributes.find((attr) => attr.localName === 'fill')?.value;
}

export function findInnerTable(part: OoxmlPart): OoxmlElement {
  const table = findTableByMarker(part, 'INNER-NW');
  if (!table) throw new Error('inner table missing');
  return table;
}

export function findOuterTable(part: OoxmlPart): OoxmlElement {
  const table = findTableByMarker(part, 'OUTER-TR');
  if (!table) throw new Error('outer table missing');
  return table;
}

export function findMergedTable(part: OoxmlPart): OoxmlElement {
  const table = findTableByMarker(part, 'MERGED-ONLY');
  if (!table) throw new Error('merged table missing');
  return table;
}

export function findTallInnerTable(part: OoxmlPart): OoxmlElement {
  const table = findTableByMarker(part, 'TALL-1-A');
  if (!table) throw new Error('tall inner table missing');
  return table;
}

export function firstCellId(table: OoxmlElement): string {
  const row = table.children.find((child) => child.kind === 'tableRow');
  if (!row || row.kind !== 'tableRow') throw new Error('row missing');
  const cell = row.children.find((child) => child.kind === 'tableCell');
  if (!cell || cell.kind !== 'tableCell') throw new Error('cell missing');
  return cell.id;
}

export interface TableBorderSpec {
  readonly val: string;
  readonly sz: string;
  readonly color: string;
}

function borderAttrsMatch(attrs: Record<string, string>, expected: TableBorderSpec): boolean {
  return attrs.val === expected.val && attrs.sz === expected.sz && attrs.color === expected.color;
}

function cellAtGrid(snapshot: DetailedTableSnapshot, row: number, col: number): CellDetailSnapshot {
  const cell = snapshot.rows[row]?.cells[col];
  if (!cell) throw new Error(`cell missing at ${row},${col}`);
  return cell;
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export interface TableSelectionRect {
  readonly rowFrom: number;
  readonly rowTo: number;
  readonly colFrom: number;
  readonly colTo: number;
}

export interface CellDecorationSnapshot {
  readonly borders: CellDetailSnapshot['borders'];
  readonly fill: CellDetailSnapshot['fill'];
  readonly tcPrDecorationFingerprint: string;
  readonly tcWidthTwips: number | null;
}

export function allInnerCellIds(snapshot: DetailedTableSnapshot): readonly string[] {
  const ids: string[] = [];
  for (const row of snapshot.rows) {
    for (const cell of row.cells) ids.push(cell.cellId);
  }
  return ids;
}

export function cellDecorationSnapshot(cell: CellDetailSnapshot): CellDecorationSnapshot {
  return {
    borders: cell.borders,
    fill: cell.fill,
    tcPrDecorationFingerprint: cell.tcPrDecorationFingerprint,
    tcWidthTwips: cell.tcWidthTwips,
  };
}

function decorationSnapshotsEqual(
  a: CellDecorationSnapshot,
  b: CellDecorationSnapshot,
  options?: { ignoreWidth?: boolean }
): boolean {
  if (JSON.stringify(a.borders) !== JSON.stringify(b.borders)) return false;
  if (JSON.stringify(a.fill) !== JSON.stringify(b.fill)) return false;
  if (a.tcPrDecorationFingerprint !== b.tcPrDecorationFingerprint) return false;
  if (!options?.ignoreWidth && a.tcWidthTwips !== b.tcWidthTwips) return false;
  return true;
}

function normalizeSelection(selection: TableSelectionRect): TableSelectionRect {
  return {
    rowFrom: Math.min(selection.rowFrom, selection.rowTo),
    rowTo: Math.max(selection.rowFrom, selection.rowTo),
    colFrom: Math.min(selection.colFrom, selection.colTo),
    colTo: Math.max(selection.colFrom, selection.colTo),
  };
}

function cellIsInSelection(row: number, col: number, selection: TableSelectionRect): boolean {
  return (
    row >= selection.rowFrom &&
    row <= selection.rowTo &&
    col >= selection.colFrom &&
    col <= selection.colTo
  );
}

/** Selected/unselected ID partition must be disjoint, exhaustive, strict subset, unselected non-empty. */
export function assertSelectionIdPartition(
  snapshot: DetailedTableSnapshot,
  selection: TableSelectionRect,
  selectedCellIds: readonly string[]
): void {
  const normalized = normalizeSelection(selection);
  const allIds = allInnerCellIds(snapshot);
  const selectedFromGrid = cellIdsInSelectionRectangle(snapshot, normalized);
  const selectedSet = new Set(selectedCellIds);
  const gridSet = new Set(selectedFromGrid);

  assertTrue(selectedSet.size === gridSet.size, 'selected IDs must match grid rectangle');
  for (const id of selectedFromGrid) {
    assertTrue(selectedSet.has(id), `selected grid cell missing from selection IDs: ${id}`);
  }

  const unselectedIds = allIds.filter((id) => !selectedSet.has(id));
  assertTrue(unselectedIds.length > 0, 'unselected cell set must be non-empty');
  assertTrue(
    selectedSet.size + unselectedIds.length === allIds.length,
    'selected/unselected must partition all inner cells'
  );
  assertTrue(
    selectedSet.size < allIds.length,
    'selection must be a strict subset of inner table cells'
  );

  for (const id of selectedSet) {
    assertTrue(!unselectedIds.includes(id), `selected ID appears in unselected set: ${id}`);
  }
}

function assertSelectedCellFormatting(
  editedCell: CellDetailSnapshot,
  baselineCell: CellDetailSnapshot,
  row: number,
  col: number,
  selection: TableSelectionRect,
  border: TableBorderSpec,
  fillHex: string
): void {
  assertTrue(editedCell.fill?.fill === fillHex, `fill mismatch on selected ${editedCell.cellId}`);
  const sides: Array<'top' | 'left' | 'bottom' | 'right'> = ['top', 'left', 'bottom', 'right'];
  for (const side of sides) {
    const isInsideHorizontal =
      side === 'bottom' ? row < selection.rowTo : side === 'top' ? row > selection.rowFrom : false;
    const isInsideVertical =
      side === 'right' ? col < selection.colTo : side === 'left' ? col > selection.colFrom : false;
    const expectsBorder = isInsideHorizontal || isInsideVertical;
    const editedAttrs = editedCell.borders[side].attrs;
    const baselineAttrs = baselineCell.borders[side].attrs;
    if (expectsBorder) {
      assertTrue(
        borderAttrsMatch(editedAttrs, border),
        `inside border mismatch on selected ${editedCell.cellId}.${side}: ${JSON.stringify(editedAttrs)}`
      );
    } else {
      assertTrue(
        JSON.stringify(editedAttrs) === JSON.stringify(baselineAttrs),
        `selection-edge border drift on selected ${editedCell.cellId}.${side}`
      );
    }
  }
}

/**
 * Formatting oracle: selected rectangle gets inside-border/fill projection; every unselected cell
 * matches its pre-format decoration snapshot exactly (no formatting leakage).
 */
export function assertTableFormattingOracle(
  edited: DetailedTableSnapshot,
  baseline: DetailedTableSnapshot,
  selection: TableSelectionRect,
  border: TableBorderSpec,
  fillHex: string,
  options?: { allowUnselectedWidthDrift?: boolean }
): void {
  const normalized = normalizeSelection(selection);
  assertTrue(
    edited.rowCount === baseline.rowCount,
    'edited inner rowCount must match pre-format baseline'
  );
  assertTrue(
    edited.columnWidthsTwips.length === baseline.columnWidthsTwips.length,
    'edited inner column count must match pre-format baseline'
  );

  for (let row = 0; row < baseline.rows.length; row += 1) {
    const baselineRow = baseline.rows[row]!;
    const editedRow = edited.rows[row];
    assertTrue(!!editedRow, `edited row missing at index ${row}`);
    assertTrue(
      editedRow!.cells.length === baselineRow.cells.length,
      `cell count drift at row ${row}`
    );

    for (let col = 0; col < baselineRow.cells.length; col += 1) {
      const baselineCell = baselineRow.cells[col]!;
      const editedCell = editedRow!.cells[col]!;
      if (cellIsInSelection(row, col, normalized)) {
        assertSelectedCellFormatting(
          editedCell,
          baselineCell,
          row,
          col,
          normalized,
          border,
          fillHex
        );
      } else {
        assertTrue(
          decorationSnapshotsEqual(
            cellDecorationSnapshot(editedCell),
            cellDecorationSnapshot(baselineCell),
            { ignoreWidth: options?.allowUnselectedWidthDrift }
          ),
          `formatting leakage on unselected cell at ${row},${col} (${baselineCell.cellId})`
        );
      }
    }
  }
}

/** Assert inside-facing edges in a rectangle selection match spec; unrelated edges match baseline. */
export function assertInsideBorderOracle(
  edited: DetailedTableSnapshot,
  baseline: DetailedTableSnapshot,
  selection: {
    readonly rowFrom: number;
    readonly rowTo: number;
    readonly colFrom: number;
    readonly colTo: number;
  },
  border: TableBorderSpec,
  fillHex: string
): void {
  const rowFrom = Math.min(selection.rowFrom, selection.rowTo);
  const rowTo = Math.max(selection.rowFrom, selection.rowTo);
  const colFrom = Math.min(selection.colFrom, selection.colTo);
  const colTo = Math.max(selection.colFrom, selection.colTo);

  for (let row = rowFrom; row <= rowTo; row += 1) {
    for (let col = colFrom; col <= colTo; col += 1) {
      const editedCell = cellAtGrid(edited, row, col);
      assertTrue(editedCell.fill?.fill === fillHex, `fill mismatch on ${editedCell.cellId}`);
      const baselineCell = cellAtGrid(baseline, row, col);

      const sides: Array<'top' | 'left' | 'bottom' | 'right'> = ['top', 'left', 'bottom', 'right'];
      for (const side of sides) {
        const isInsideHorizontal =
          side === 'bottom' ? row < rowTo : side === 'top' ? row > rowFrom : false;
        const isInsideVertical =
          side === 'right' ? col < colTo : side === 'left' ? col > colFrom : false;
        const expectsBorder = isInsideHorizontal || isInsideVertical;
        const editedAttrs = editedCell.borders[side].attrs;
        const baselineAttrs = baselineCell.borders[side].attrs;
        if (expectsBorder) {
          assertTrue(
            borderAttrsMatch(editedAttrs, border),
            `inside border mismatch on ${editedCell.cellId}.${side}: ${JSON.stringify(editedAttrs)}`
          );
        } else {
          assertTrue(
            JSON.stringify(editedAttrs) === JSON.stringify(baselineAttrs),
            `baseline border drift on ${editedCell.cellId}.${side}: ${JSON.stringify(editedAttrs)} vs ${JSON.stringify(baselineAttrs)}`
          );
        }
      }
    }
  }
}

/** Grid positions for cell IDs in row-major table order (no vMerge in fixture selection). */
export function gridPositionsForCellIds(
  snapshot: DetailedTableSnapshot,
  cellIds: readonly string[]
): Array<{ row: number; col: number; cellId: string }> {
  const positions: Array<{ row: number; col: number; cellId: string }> = [];
  for (let row = 0; row < snapshot.rows.length; row += 1) {
    for (let col = 0; col < snapshot.rows[row]!.cells.length; col += 1) {
      const cell = snapshot.rows[row]!.cells[col]!;
      if (cellIds.includes(cell.cellId)) {
        positions.push({ row, col, cellId: cell.cellId });
      }
    }
  }
  return positions;
}

export function detailedTopologyContentEqual(
  a: DetailedTableSnapshot,
  b: DetailedTableSnapshot
): boolean {
  if (a.rowCount !== b.rowCount) return false;
  if (a.columnWidthsTwips.length !== b.columnWidthsTwips.length) return false;
  for (let index = 0; index < a.columnWidthsTwips.length; index += 1) {
    if (a.columnWidthsTwips[index] !== b.columnWidthsTwips[index]) return false;
  }
  if (a.rows.length !== b.rows.length) return false;
  for (let row = 0; row < a.rows.length; row += 1) {
    const aRow = a.rows[row]!;
    const bRow = b.rows[row]!;
    if (aRow.cells.length !== bRow.cells.length) return false;
    for (let col = 0; col < aRow.cells.length; col += 1) {
      const ac = aRow.cells[col]!;
      const bc = bRow.cells[col]!;
      if (ac.text !== bc.text) return false;
      if (ac.tcWidthTwips !== bc.tcWidthTwips) return false;
      if (JSON.stringify(ac.borders) !== JSON.stringify(bc.borders)) return false;
      if (JSON.stringify(ac.fill) !== JSON.stringify(bc.fill)) return false;
      if (ac.tcPrDecorationFingerprint !== bc.tcPrDecorationFingerprint) return false;
    }
  }
  return true;
}

/** Every inner cell decoration matches the pre-format baseline (post-undo restore). */
export function assertAllInnerCellsMatchPreFormat(
  edited: DetailedTableSnapshot,
  baseline: DetailedTableSnapshot,
  options?: { ignoreWidth?: boolean }
): void {
  assertTrue(edited.rowCount === baseline.rowCount, 'rowCount mismatch vs pre-format baseline');
  for (let row = 0; row < baseline.rows.length; row += 1) {
    const baselineRow = baseline.rows[row]!;
    const editedRow = edited.rows[row];
    assertTrue(!!editedRow, `edited row missing at ${row}`);
    for (let col = 0; col < baselineRow.cells.length; col += 1) {
      assertTrue(
        decorationSnapshotsEqual(
          cellDecorationSnapshot(editedRow!.cells[col]!),
          cellDecorationSnapshot(baselineRow.cells[col]!),
          options
        ),
        `cell decoration mismatch at ${row},${col} vs pre-format baseline`
      );
    }
  }
}

export function cellIdsInSelectionRectangle(
  snapshot: DetailedTableSnapshot,
  selection: {
    readonly rowFrom: number;
    readonly rowTo: number;
    readonly colFrom: number;
    readonly colTo: number;
  }
): string[] {
  const rowFrom = Math.min(selection.rowFrom, selection.rowTo);
  const rowTo = Math.max(selection.rowFrom, selection.rowTo);
  const colFrom = Math.min(selection.colFrom, selection.colTo);
  const colTo = Math.max(selection.colFrom, selection.colTo);
  const ids: string[] = [];
  for (let row = rowFrom; row <= rowTo; row += 1) {
    for (let col = colFrom; col <= colTo; col += 1) {
      ids.push(cellAtGrid(snapshot, row, col).cellId);
    }
  }
  return ids;
}
