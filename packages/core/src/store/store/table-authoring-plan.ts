import { paragraphModelTextOf } from './paragraph-model-text.ts';
// Canonical table reads and host-neutral mutation plans. No browser/editor dependencies.
import { collectStoryParagraphs } from '../package/story-blocks.ts';
import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlPart,
  OoxmlParagraphNode,
} from '../package/ooxml-tree.ts';
import { readEditableTableTopology } from './tree-op-table-topology.ts';
import { wmlAttributeValue, wmlChildNamed } from './tree-op-table-shared.ts';
import { applyTreeOp, type TreeDocOp, type TreeOpEffect } from './tree-ops.ts';
interface AutomationStoryReads {
  readonly part: OoxmlPart;
  readonly root: OoxmlNode;
  rawText(id: string): string | null;
}

export type AutomationTableMutation =
  | { readonly kind: 'values'; readonly values: readonly (readonly string[])[] }
  | {
      readonly kind: 'addRows' | 'addColumns';
      readonly location: 'start' | 'end';
      readonly count: number;
      readonly values?: readonly (readonly string[])[];
    }
  | {
      readonly kind: 'deleteRows' | 'deleteColumns';
      readonly index: number;
      readonly count: number;
    }
  | { readonly kind: 'delete' }
  | { readonly kind: 'properties'; readonly styleId?: string; readonly headerRowCount?: number }
  | {
      readonly kind: 'cell';
      readonly cellId: string;
      readonly value?: string;
      readonly columnWidth?: number;
      readonly shadingColor?: string;
      readonly verticalAlignment?: 'Top' | 'Center' | 'Bottom';
    };
export interface AutomationTableRead {
  readonly nodeId: string;
  readonly rowIds: readonly string[];
  readonly cellIds: readonly (readonly string[])[];
  readonly values: readonly (readonly string[])[];
  readonly styleId: string;
  readonly headerRowCount: number;
  readonly columnCount: number;
}
export interface AutomationTableCellRead {
  readonly nodeId: string;
  readonly tableId: string;
  readonly value: string;
  readonly columnWidth: number;
  readonly shadingColor: string;
  readonly verticalAlignment: 'Top' | 'Center' | 'Bottom';
  readonly paragraphIds: readonly string[];
}
export function tableNodes(root: OoxmlNode): readonly OoxmlElement[] {
  const out: OoxmlElement[] = [];
  const stack = [root];
  let visited = 0;
  while (stack.length) {
    if (++visited > 100000) throw new Error('table traversal limit');
    const node = stack.pop()!;
    if (node.kind === 'table') {
      out.push(node);
      continue;
    }
    if (node.kind !== 'textValue') stack.push(...[...node.children].reverse());
  }
  return out;
}
function paragraphsOf(cell: OoxmlNode): OoxmlParagraphNode[] {
  const out: OoxmlNode[] = [];
  if (cell.kind !== 'textValue')
    collectStoryParagraphs(cell.kind === 'table' ? [cell] : cell.children, out, 0);
  return out.filter((p): p is OoxmlParagraphNode => p.kind === 'paragraph');
}
function cellText(cell: OoxmlNode): string {
  return paragraphsOf(cell)
    .map((p) => paragraphModelTextOf(p))
    .join('\r');
}
function prop(
  node: OoxmlElement,
  container: string,
  name: string,
  attribute = 'val'
): string | undefined {
  const c = wmlChildNamed(node, container);
  const p = c && wmlChildNamed(c, name);
  return p && wmlAttributeValue(p, attribute);
}
export function tableRead(
  reads: AutomationStoryReads,
  tableId: string
): AutomationTableRead | null {
  const result = readEditableTableTopology(reads.root as OoxmlElement, tableId);
  if (!result.ok) return null;
  const { table, rows, gridColumns } = result.topology;
  let headers = 0;
  for (const { row } of rows) {
    const value = prop(row, 'trPr', 'tblHeader');
    const mark = wmlChildNamed(row, 'trPr');
    if (!mark || !wmlChildNamed(mark, 'tblHeader') || ['0', 'false', 'off'].includes(value ?? ''))
      break;
    headers++;
  }
  return {
    nodeId: tableId,
    rowIds: rows.map(({ row }) => row.id),
    cellIds: rows.map(({ cells }) => cells.map((c) => c.id)),
    values: rows.map(({ cells }) => cells.map(cellText)),
    styleId: prop(table, 'tblPr', 'tblStyle') ?? '',
    headerRowCount: headers,
    columnCount: gridColumns.length || rows[0]?.cells.length || 0,
  };
}
export function tableCellRead(
  reads: AutomationStoryReads,
  tableId: string,
  cellId: string
): AutomationTableCellRead | null {
  const result = readEditableTableTopology(reads.root as OoxmlElement, tableId);
  if (!result.ok) return null;
  for (const { cells } of result.topology.rows) {
    const index = cells.findIndex((c) => c.id === cellId);
    if (index < 0) continue;
    const cell = cells[index]!;
    const grid = result.topology.gridColumns[index];
    const width = prop(cell, 'tcPr', 'tcW', 'w') ?? (grid && wmlAttributeValue(grid, 'w')) ?? '0';
    const align = prop(cell, 'tcPr', 'vAlign');
    return {
      nodeId: cellId,
      tableId,
      value: cellText(cell),
      columnWidth:
        /^\d{1,7}$/.test(width) && Number.isFinite(Number(width)) ? Number(width) / 20 : 0,
      shadingColor: (() => {
        const fill = prop(cell, 'tcPr', 'shd', 'fill');
        return fill && /^[0-9a-fA-F]{6}$/.test(fill) ? `#${fill.toUpperCase()}` : (fill ?? 'auto');
      })(),
      verticalAlignment: align === 'center' ? 'Center' : align === 'bottom' ? 'Bottom' : 'Top',
      paragraphIds: paragraphsOf(cell).map((p) => p.id),
    };
  }
  return null;
}
export type TableMutationPlan =
  | {
      readonly ok: true;
      readonly ops: readonly TreeDocOp[];
      readonly createdRowIds: readonly string[];
      readonly resultPart: OoxmlPart;
      readonly effects: readonly TreeOpEffect[];
    }
  | { readonly ok: false; readonly reason: string };
function matrix(
  value: readonly (readonly string[])[] | undefined,
  rows: number,
  cols: number
): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length !== rows) return false;
  let total = 0;
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== cols) return false;
    for (const cell of row) {
      if (typeof cell !== 'string' || /[\r\n\u0000-\u0008]/.test(cell)) return false;
      total += cell.length;
      if (total > 1_000_000) return false;
    }
  }
  return true;
}

function validMutation(value: AutomationTableMutation): boolean {
  if (!value || typeof value !== 'object') return false;
  const allowed: Record<string, readonly string[]> = {
    values: ['kind', 'values'],
    addRows: ['kind', 'location', 'count', 'values'],
    addColumns: ['kind', 'location', 'count', 'values'],
    deleteRows: ['kind', 'index', 'count'],
    deleteColumns: ['kind', 'index', 'count'],
    delete: ['kind'],
    properties: ['kind', 'styleId', 'headerRowCount'],
    cell: ['kind', 'cellId', 'value', 'columnWidth', 'shadingColor', 'verticalAlignment'],
  };
  if (value.kind === 'values' && !Array.isArray(value.values)) return false;
  const keys = allowed[value.kind];
  if (!keys || !Object.keys(value).every((key) => keys.includes(key))) return false;
  if (value.kind === 'cell')
    return (
      typeof value.cellId === 'string' &&
      (value.value === undefined || typeof value.value === 'string') &&
      (value.columnWidth === undefined ||
        (typeof value.columnWidth === 'number' &&
          Number.isFinite(value.columnWidth) &&
          value.columnWidth > 0)) &&
      (value.shadingColor === undefined || typeof value.shadingColor === 'string') &&
      (value.verticalAlignment === undefined ||
        ['Top', 'Center', 'Bottom'].includes(value.verticalAlignment))
    );
  return true;
}

/** Simulate ordered canonical operations privately so newly allocated cells can receive values atomically. */
export function planTableMutation(
  reads: AutomationStoryReads,
  tableId: string,
  mutation: AutomationTableMutation
): TableMutationPlan {
  if (!validMutation(mutation)) return { ok: false, reason: 'invalid-table-mutation' };
  const initial = readEditableTableTopology(reads.root as OoxmlElement, tableId);
  if (!initial.ok) return { ok: false, reason: initial.reason };
  if (initial.topology.hasMerge && mutation.kind !== 'delete' && mutation.kind !== 'properties')
    return { ok: false, reason: 'table-has-merge' };
  let part: OoxmlPart = reads.part;
  const ops: TreeDocOp[] = [];
  const effects: TreeOpEffect[] = [];
  const createdRowIds: string[] = [];
  const apply = (op: TreeDocOp): string | null => {
    const result = applyTreeOp(part, op);
    if (!result.ok) return result.reason;
    part = result.part;
    effects.push(result.effect);
    ops.push(op);
    return null;
  };
  const topo = () => {
    const r = readEditableTableTopology(part.root, tableId);
    return r.ok ? r.topology : null;
  };
  const writeCell = (cell: OoxmlElement, text: string): string | null => {
    const paragraphs = paragraphsOf(cell);
    if (
      paragraphs.length !== 1 ||
      cell.children.some(
        (n) => n.kind !== 'paragraph' && !(n.kind !== 'textValue' && n.localName === 'tcPr')
      )
    )
      return 'unsupported-cell-content';
    const p = paragraphs[0]!;
    const old = paragraphModelTextOf(p);
    if (old === text) return null;
    let error: string | null = null;
    // Insert while the original first run still supplies its formatting. Deleting
    // every original character first would leave no run properties to inherit.
    if (text.length) error = apply({ op: 'insertText', paragraphId: p.id, offset: 0, text });
    if (error) return error;
    if (old.length)
      return apply({
        op: 'deleteText',
        paragraphId: p.id,
        start: text.length,
        end: text.length + old.length,
      });
    return null;
  };
  let error: string | null = null;
  const current = initial.topology;
  const cols = current.gridColumns.length || current.rows[0]?.cells.length || 0;
  if (
    current.gridColumns.length === 0 &&
    (mutation.kind === 'addColumns' ||
      (mutation.kind === 'deleteColumns' && mutation.count !== cols))
  )
    return { ok: false, reason: 'unsupported-table-topology' };
  if (
    mutation.kind !== 'delete' &&
    mutation.kind !== 'properties' &&
    current.rows.some(({ cells }) => cells.length !== cols)
  )
    return { ok: false, reason: 'nonrectangular-table' };
  if (mutation.kind === 'delete') error = apply({ op: 'deleteBlock', blockId: tableId });
  else if (mutation.kind === 'properties')
    error = apply({
      op: 'setTableProperties',
      tableId,
      ...(mutation.styleId === undefined ? {} : { styleId: mutation.styleId }),
      ...(mutation.headerRowCount === undefined ? {} : { headerRowCount: mutation.headerRowCount }),
    });
  else if (mutation.kind === 'values') {
    if (!matrix(mutation.values, current.rows.length, cols))
      return { ok: false, reason: 'invalid-table-values' };
    for (let r = 0; r < current.rows.length && !error; r++)
      for (let c = 0; c < cols && !error; c++)
        error = writeCell(current.rows[r]!.cells[c]!, mutation.values[r]![c]!);
  } else if (mutation.kind === 'cell') {
    const row = current.rows.find(({ cells }) => cells.some((cell) => cell.id === mutation.cellId));
    const index = row?.cells.findIndex((cell) => cell.id === mutation.cellId) ?? -1;
    const cell = row?.cells[index];
    if (!cell) return { ok: false, reason: 'unknown-cell' };
    if (mutation.value !== undefined) {
      if (!matrix([[mutation.value]], 1, 1)) return { ok: false, reason: 'invalid-cell-value' };
      error = writeCell(cell, mutation.value);
    }
    if (!error && mutation.shadingColor !== undefined) {
      const color = mutation.shadingColor.replace(/^#/, '');
      if (color !== 'auto' && !/^[a-fA-F0-9]{6}$/.test(color))
        return { ok: false, reason: 'invalid-color' };
      error = apply({
        op: 'setTableCellFill',
        tableId,
        cellIds: [cell.id],
        color: color === 'auto' ? null : { kind: 'hex', value: color },
      });
    }
    if (!error && mutation.verticalAlignment !== undefined)
      error = apply({
        op: 'setTableCellVerticalAlignment',
        tableId,
        cellIds: [cell.id],
        alignment: mutation.verticalAlignment.toLowerCase() as 'top' | 'center' | 'bottom',
      });
    if (!error && mutation.columnWidth !== undefined) {
      const widths = current.gridColumns.map((c) => Number(wmlAttributeValue(c, 'w') ?? '0'));
      widths[index] = Math.round(mutation.columnWidth * 20);
      error = apply({ op: 'setTableProperties', tableId, columnWidthsTwips: widths });
    }
  } else if (mutation.kind === 'deleteRows' || mutation.kind === 'deleteColumns') {
    const size = mutation.kind === 'deleteRows' ? current.rows.length : cols;
    if (
      !Number.isInteger(mutation.index) ||
      !Number.isInteger(mutation.count) ||
      mutation.index < 0 ||
      mutation.count < 1 ||
      mutation.index + mutation.count > size
    )
      return { ok: false, reason: 'invalid-table-index' };
    if (mutation.count === size) error = apply({ op: 'deleteBlock', blockId: tableId });
    else
      for (let i = mutation.index + mutation.count - 1; i >= mutation.index && !error; i--)
        error =
          mutation.kind === 'deleteRows'
            ? apply({ op: 'deleteTableRow', tableId, rowId: current.rows[i]!.row.id })
            : apply({ op: 'deleteTableColumn', tableId, gridColumnId: current.gridColumns[i]!.id });
  } else if (mutation.kind === 'addRows' || mutation.kind === 'addColumns') {
    if (
      !Number.isInteger(mutation.count) ||
      mutation.count < 1 ||
      mutation.count > 1000 ||
      !['start', 'end'].includes(mutation.location)
    )
      return { ok: false, reason: 'invalid-table-count' };
    const isRows = mutation.kind === 'addRows';
    if (
      !matrix(
        mutation.values,
        isRows ? mutation.count : current.rows.length,
        isRows ? cols : mutation.count
      )
    )
      return { ok: false, reason: 'invalid-table-values' };
    const oldRows = new Set(current.rows.map(({ row }) => row.id));
    for (let i = 0; i < mutation.count && !error; i++) {
      const t = topo()!;
      const first = mutation.location === 'start';
      error = isRows
        ? apply({
            op: 'insertTableRow',
            tableId,
            rowId: t.rows[first ? 0 : t.rows.length - 1]!.row.id,
            where: first ? 'above' : 'below',
          })
        : apply({
            op: 'insertTableColumn',
            tableId,
            gridColumnId: t.gridColumns[first ? 0 : t.gridColumns.length - 1]!.id,
            where: first ? 'left' : 'right',
          });
    }
    if (!error) {
      const t = topo()!;
      createdRowIds.push(
        ...t.rows.filter(({ row }) => !oldRows.has(row.id)).map(({ row }) => row.id)
      );
      if (mutation.values)
        for (let r = 0; r < mutation.values.length && !error; r++)
          for (let c = 0; c < mutation.values[r]!.length && !error; c++) {
            const ri = isRows && mutation.location === 'end' ? current.rows.length + r : r;
            const ci = !isRows && mutation.location === 'end' ? cols + c : c;
            error = writeCell(t.rows[ri]!.cells[ci]!, mutation.values[r]![c]!);
          }
    }
  }
  return error
    ? { ok: false, reason: error }
    : { ok: true, ops, createdRowIds, resultPart: part, effects };
}

/** Insert beside a range endpoint, splitting its paragraph when needed. */
export function planInsertTable(
  reads: AutomationStoryReads,
  paragraphId: string,
  offset: number,
  rowCount: number,
  columnCount: number,
  values?: readonly (readonly string[])[]
):
  | {
      readonly ok: true;
      readonly ops: readonly TreeDocOp[];
      readonly tableId: string;
      readonly splitParagraphId?: string;
      readonly resultPart: OoxmlPart;
      readonly effects: readonly TreeOpEffect[];
    }
  | { readonly ok: false; readonly reason: string } {
  if (
    !Number.isInteger(rowCount) ||
    !Number.isInteger(columnCount) ||
    rowCount < 1 ||
    columnCount < 1 ||
    rowCount > 1000 ||
    columnCount > 63 ||
    rowCount * columnCount > 10000 ||
    !matrix(values, rowCount, columnCount)
  )
    return { ok: false, reason: 'invalid-table-dimensions' };
  const length = reads.rawText(paragraphId)?.length;
  if (length === undefined || !Number.isInteger(offset) || offset < 0 || offset > length)
    return { ok: false, reason: 'invalid-offset' };
  if (tableNodes(reads.root).some((table) => paragraphsOf(table).some((p) => p.id === paragraphId)))
    return { ok: false, reason: 'nested-table-authoring' };
  const existing = new Set(tableNodes(reads.root).map((node) => node.id));
  let part = reads.part;
  const ops: TreeDocOp[] = [];
  const effects: TreeOpEffect[] = [];
  let anchor = paragraphId;
  let splitParagraphId: string | undefined;
  if (offset > 0) {
    const op: TreeDocOp = { op: 'splitParagraph', paragraphId, offset };
    const result = applyTreeOp(part, op);
    if (!result.ok) return { ok: false, reason: result.reason };
    part = result.part;
    effects.push(result.effect);
    ops.push(op);
    const created = result.effect.created.find((id) => {
      const stack: OoxmlNode[] = [part.root];
      while (stack.length) {
        const n = stack.pop()!;
        if (n.id === id) return n.kind === 'paragraph';
        if (n.kind !== 'textValue') stack.push(...n.children);
      }
      return false;
    });
    if (!created) return { ok: false, reason: 'missing-insert-anchor' };
    anchor = created;
    splitParagraphId = created;
  }
  const op: TreeDocOp = {
    op: 'insertTable',
    beforeParagraphId: anchor,
    rows: rowCount,
    cols: columnCount,
    columnWidthTwips: Math.max(120, Math.floor(9360 / columnCount)),
  };
  const result = applyTreeOp(part, op);
  if (!result.ok) return { ok: false, reason: result.reason };
  part = result.part;
  effects.push(result.effect);
  ops.push(op);
  const table = tableNodes(part.root).find((n) => !existing.has(n.id));
  if (!table) return { ok: false, reason: 'missing-inserted-table' };
  if (values) {
    const seeded = planTableMutation({ ...reads, part, root: part.root }, table.id, {
      kind: 'values',
      values,
    });
    if (!seeded.ok) return seeded;
    ops.push(...seeded.ops);
    part = seeded.resultPart;
    effects.push(...seeded.effects);
  }
  return {
    ok: true,
    ops,
    tableId: table.id,
    resultPart: part,
    effects,
    ...(splitParagraphId ? { splitParagraphId } : {}),
  };
}
