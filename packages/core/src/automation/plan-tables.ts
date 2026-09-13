// Table protocol dispatch. Handles never expose canonical node identities.
import { findNode } from '../store/package/ooxml-edit.ts';
import { indexStyles, stylesPartOf } from '../store/package/ooxml-indexes.ts';
import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';
import type { AutomationOperation } from './operations.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import type { AutomationErrorCode, AutomationHandle, AutomationValue } from './protocol.ts';
import type { PlannedOperation } from './plan.ts';
import { resolveSpanRef, storyOfSpanRef } from './spans.ts';
import {
  tableNodes,
  tableRead,
  tableCellRead,
  planInsertTable,
  planTableMutation,
  type AutomationTableMutation,
} from './tables.ts';

export interface TablePlannerContext {
  readonly handles: AutomationHandleTable;
  readonly reads: AutomationPackageReads;
  /** Pin story writes and reserve externally planned paragraph creation for commit reconciliation. */
  readonly admitWrite: (
    reads: AutomationStoryReads,
    expectedNewParagraphs: number,
    affectedParagraphIds: readonly string[]
  ) => PlannedOperation | null;
}
const refuse = (code: AutomationErrorCode, detail: string): PlannedOperation => ({
  ok: false,
  error: { code, message: detail, detail },
});
const query = (value: AutomationValue): PlannedOperation => ({ ok: true, kind: 'query', value });
const TABLE_OPS = new Set([
  'getTables',
  'getTable',
  'getTableRows',
  'getTableCells',
  'getTableCell',
  'getTableCellProperties',
  'getTableCellBody',
  'updateTable',
  'updateTableCell',
  'insertTable',
]);
function paragraphs(root: OoxmlNode): Set<string> {
  const out = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === 'paragraph') out.add(node.id);
    if (node.kind !== 'textValue') stack.push(...node.children);
  }
  return out;
}
function countNew(before: OoxmlNode, after: OoxmlNode): number {
  const old = paragraphs(before);
  return [...paragraphs(after)].filter((id) => !old.has(id)).length;
}
function parentTable(root: OoxmlNode, nodeId: string): OoxmlElement | undefined {
  const stack: { node: OoxmlNode; table?: OoxmlElement }[] = [{ node: root }];
  while (stack.length) {
    const { node, table } = stack.pop()!;
    if (node.id === nodeId) return table;
    if (node.kind === 'textValue') continue;
    const parent = node.kind === 'table' ? node : table;
    for (const child of node.children) stack.push({ node: child, table: parent });
  }
  return undefined;
}
function styles(reads: AutomationPackageReads) {
  const part = reads.package && stylesPartOf(reads.package);
  return part ? [...indexStyles(part).values()].filter((s) => s.type === 'table') : [];
}

export function planTableOperation(
  operation: AutomationOperation,
  context: TablePlannerContext
): PlannedOperation | null {
  if (!TABLE_OPS.has(operation.op)) return null;
  const { handles, reads: packages } = context;
  if (operation.op === 'getTables' || operation.op === 'insertTable') {
    const scope = operation.op === 'getTables' ? operation.scope : operation.span;
    const story = storyOfSpanRef(scope, handles, packages);
    if (!story.ok) return refuse(story.code, story.detail);
    const resolved = resolveSpanRef(scope, handles, packages);
    if (!resolved.ok) return refuse(resolved.code, resolved.detail);
    const reads = story.value;
    if (operation.op === 'getTables') {
      const span = resolved.value;
      const listed = tableNodes(reads.root).filter((table) => {
        if ('body' in scope) return true;
        if (!span) return false;
        const ids = [...paragraphs(table)].sort((a, b) => reads.indexOf(a) - reads.indexOf(b));
        const first = ids[0],
          last = ids[ids.length - 1];
        if (!first || !last) return false;
        return reads.indexOf(first) >= span.start.index && reads.indexOf(last) <= span.end.index;
      });
      return query({
        kind: 'handles',
        handles: listed.map((t) => handles.table(t.id, reads.story)),
      });
    }
    if (!resolved.value) return refuse('invalid-offset', 'empty-table-insertion-range');
    if (!['Before', 'After'].includes(operation.location))
      return refuse('unsupported-content', 'table-insertion-location');
    const point = operation.location === 'Before' ? resolved.value.start : resolved.value.end;
    const planned = planInsertTable(
      reads,
      point.paragraphId,
      point.offset,
      operation.rowCount,
      operation.columnCount,
      operation.values
    );
    if (!planned.ok) return refuse('unsupported-content', planned.reason);
    const admission = context.admitWrite(
      reads,
      countNew(reads.part.root, planned.resultPart.root),
      [point.paragraphId]
    );
    if (admission) return admission;
    const before = new Set(tableNodes(reads.root).map((t) => t.id));
    return {
      ok: true,
      kind: 'command',
      story: reads.story,
      ops: [
        {
          op: 'authorTable',
          action: {
            kind: 'insert',
            paragraphId: point.paragraphId,
            offset: point.offset,
            rowCount: operation.rowCount,
            columnCount: operation.columnCount,
            ...(operation.values ? { values: operation.values } : {}),
          },
        },
      ],
      answer: (post) => {
        const current = post.story(reads.story);
        const table = current && tableNodes(current.root).find((t) => !before.has(t.id));
        return table
          ? { kind: 'handle', handle: handles.table(table.id, reads.story) }
          : { kind: 'applied' };
      },
    };
  }
  // Every remaining operation names an existing table, row, or cell.
  const named: 'table' | 'tableRow' | 'tableCell' =
    operation.op === 'getTableCells' ? 'tableRow' : 'cell' in operation ? 'tableCell' : 'table';
  const handle: AutomationHandle =
    operation.op === 'getTableCells'
      ? operation.row
      : 'cell' in operation
        ? operation.cell
        : 'table' in operation
          ? operation.table
          : ({ kind: 'document', ref: '' } as AutomationHandle);
  const target = handles.resolve(handle, named);
  if (!target || !('nodeId' in target) || !('story' in target))
    return refuse('invalid-handle', 'unknown-table-object');
  const reads = packages.story(target.story);
  if (!reads) return refuse('invalid-handle', 'missing-table-story');
  const node = findNode(reads.part, target.nodeId);
  if (!node || node.kind !== named) return refuse('invalid-handle', 'deleted-table-object');
  const table = named === 'table' ? node : parentTable(reads.root, target.nodeId);
  if (!table) return refuse('invalid-handle', 'missing-parent-table');
  const data = tableRead(reads, table.id);
  if (!data) return refuse('unsupported-content', 'unsupported-table-topology');
  switch (operation.op) {
    case 'getTable':
      return query({
        kind: 'table',
        table: {
          values: data.values,
          headerRowCount: data.headerRowCount,
          rowCount: data.rowIds.length,
          columnCount: data.columnCount,
          style: styles(packages).find((s) => s.styleId === data.styleId)?.name ?? '',
        },
      });
    case 'getTableRows':
      return query({
        kind: 'handles',
        handles: data.rowIds.map((id) => handles.tableRow(id, reads.story)),
      });
    case 'getTableCells': {
      const index = data.rowIds.indexOf(target.nodeId);
      return query({
        kind: 'handles',
        handles: (data.cellIds[index] ?? []).map((id) => handles.tableCell(id, reads.story)),
      });
    }
    case 'getTableCell': {
      if (!Number.isInteger(operation.rowIndex) || !Number.isInteger(operation.cellIndex))
        return refuse('invalid-offset', 'invalid-cell-index');
      const id = data.cellIds[operation.rowIndex]?.[operation.cellIndex];
      return id
        ? query({ kind: 'handle', handle: handles.tableCell(id, reads.story) })
        : refuse('invalid-handle', 'cell-not-found');
    }
    case 'getTableCellBody':
      return query({ kind: 'handle', handle: handles.body(reads.story, target.nodeId) });
    case 'getTableCellProperties': {
      const cell = tableCellRead(reads, table.id, target.nodeId);
      return cell
        ? query({
            kind: 'tableCell',
            cell: {
              value: cell.value,
              columnWidth: cell.columnWidth,
              shadingColor: cell.shadingColor,
              verticalAlignment: cell.verticalAlignment,
            },
          })
        : refuse('invalid-handle', 'cell-not-found');
    }
    case 'updateTable':
    case 'updateTableCell': {
      let mutation: AutomationTableMutation =
        operation.op === 'updateTable'
          ? operation.mutation
          : { ...operation.properties, kind: 'cell', cellId: target.nodeId };
      if (mutation.kind === 'properties' && mutation.styleId !== undefined) {
        const wanted = mutation.styleId;
        if (typeof wanted !== 'string' || wanted.trim().length === 0)
          return refuse('unsupported-content', 'invalid-table-style-name');
        const style = styles(packages).find(
          (s) => s.name?.trim().toLowerCase() === wanted.trim().toLowerCase()
        );
        if (!style) return refuse('unsupported-content', 'table-style-not-defined');
        mutation = { ...mutation, styleId: style.styleId };
      }
      const planned = planTableMutation(reads, table.id, mutation);
      if (!planned.ok) return refuse('unsupported-content', planned.reason);
      const admission = context.admitWrite(
        reads,
        countNew(reads.part.root, planned.resultPart.root),
        mutation.kind === 'values'
          ? [...paragraphs(table)]
          : mutation.kind === 'cell' && mutation.value !== undefined
            ? [...paragraphs(node)]
            : []
      );
      if (admission) return admission;
      const oldRows = new Set(data.rowIds);
      return {
        ok: true,
        kind: 'command',
        story: reads.story,
        ops: [{ op: 'authorTable', action: { kind: 'existing', tableId: table.id, mutation } }],
        answer: (post) => {
          if (mutation.kind !== 'addRows') return { kind: 'applied' };
          const current = post.story(reads.story);
          const updated = current && tableRead(current, table.id);
          return {
            kind: 'handles',
            handles: (updated?.rowIds ?? [])
              .filter((id) => !oldRows.has(id))
              .map((id) => handles.tableRow(id, reads.story)),
          };
        },
      };
    }
    default:
      return refuse('unsupported-content', 'unknown-table-operation');
  }
}
