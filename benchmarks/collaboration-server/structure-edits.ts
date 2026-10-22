/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Edits of document structure beyond text: lists, links, images, tables, page breaks,
 * content controls, and notes.
 *
 * Like text edits, they address nodes by document position, not by id: the kth element of
 * a name, optionally inside another addressed element. A replay then binds them to whatever
 * ids that replica holds, so a shrunk action list stays meaningful.
 */
import type { OoxmlNode, TreeDocOp } from '@docx-editor.dev/core/store';
import { elements, textOf } from './scenario-tree.ts';

export type StructureEditKind =
  | 'list'
  | 'listLevel'
  | 'link'
  | 'unlink'
  | 'resizeImage'
  | 'moveImage'
  | 'deleteImage'
  | 'wrapImage'
  | 'insertTable'
  | 'insertColumn'
  | 'deleteColumn'
  | 'cellFill'
  | 'mergeCells'
  | 'splitCell'
  | 'pageBreak'
  | 'control'
  | 'footnote'
  | 'comment';

export const STRUCTURE_WEIGHTS: Record<StructureEditKind, number> = {
  list: 3,
  listLevel: 2,
  link: 2,
  unlink: 1,
  resizeImage: 2,
  moveImage: 1,
  deleteImage: 1,
  wrapImage: 1,
  insertTable: 1,
  insertColumn: 1,
  deleteColumn: 1,
  cellFill: 1,
  // Off by default, so adding them left every existing seed's edits unchanged; the
  // `tableCells` shape turns them on.
  mergeCells: 0,
  splitCell: 0,
  pageBreak: 1,
  control: 1,
  footnote: 1,
  comment: 1,
};

/** One id an op needs: the `index`th `localName` element, inside target `within` if given. */
export interface NodeTarget {
  readonly field: string;
  readonly localName: string;
  readonly index: number;
  readonly within?: number;
  /** The op takes a list of ids. */
  readonly array?: boolean;
  /**
   * Count only elements with these attribute values; a missing attribute matches `''`. A
   * tracked change's site is addressed among its own identity's sites, and a content wrapper
   * only while it holds text: a replica can merge an empty wrapper into its neighbour where a
   * solo store keeps it, which shifts a count over every wrapper. Markers hold no text and
   * always count.
   */
  readonly identity?: Readonly<Record<string, string>>;
}

const CONTENT_WRAPPERS = new Set(['ins', 'del', 'moveFrom', 'moveTo']);

/** The elements a target counts. */
export function targetElements(scope: OoxmlNode, target: NodeTarget): OoxmlNode[] {
  const all = elements(scope, target.localName);
  const identity = target.identity;
  if (!identity) return all;
  return all.filter(
    (node) =>
      node.kind !== 'textValue' &&
      Object.entries(identity).every(
        ([name, value]) =>
          (node.attributes.find((attribute) => attribute.localName === name)?.value ?? '') === value
      ) &&
      (!CONTENT_WRAPPERS.has(node.localName) ||
        node.children.length === 0 ||
        textOf(node, '').length > 0)
  );
}

export interface NodeAddressed {
  readonly kind: 'node';
  readonly op: TreeDocOp;
  readonly targets: readonly NodeTarget[];
}

/** An op with every target bound to this replica's ids, or null when one is missing. */
export function bindNodeIds(root: OoxmlNode, addressed: NodeAddressed): TreeDocOp | null {
  const bound: OoxmlNode[] = [];
  const op = { ...addressed.op } as Record<string, unknown>;
  // Array fields collect every target that names them, in target order.
  const collected = new Map<string, string[]>();
  for (const target of addressed.targets) {
    const scope = target.within === undefined ? root : bound[target.within];
    if (!scope) return null;
    const node = targetElements(scope, target)[target.index];
    if (!node) return null;
    bound.push(node);
    if (target.array) {
      const ids = collected.get(target.field) ?? [];
      ids.push(node.id);
      collected.set(target.field, ids);
      op[target.field] = [...ids];
    } else op[target.field] = node.id;
  }
  return op as unknown as TreeDocOp;
}

/** The paragraph-level part of a structure edit; `null` op means the kind needs no paragraph. */
export interface StructureContext {
  readonly root: OoxmlNode;
  readonly random: () => number;
  readonly offset: number;
  readonly length: number;
  readonly span: number;
  /** The nearest offset at or before `at` that is not inside a surrogate pair. */
  readonly boundary: (at: number) => number;
  /** The nearest offset at or after `at` that is not inside a surrogate pair. */
  readonly endBoundary: (at: number) => number;
}

/**
 * Plan one structure edit. A paragraph op comes back with an empty `paragraphId` for the
 * caller to address; a node op names its targets.
 */
export function planStructureEdit(
  kind: StructureEditKind,
  context: StructureContext
): { readonly paragraphOp: Record<string, unknown> } | NodeAddressed | null {
  const { root, random, offset, length, span, boundary, endBoundary } = context;
  const pickOf = (localName: string, within?: OoxmlNode): number | null => {
    const count = elements(within ?? root, localName).length;
    return count === 0 ? null : Math.floor(random() * count);
  };
  const node = (op: Record<string, unknown>, targets: NodeTarget[]): NodeAddressed => ({
    kind: 'node',
    op: op as unknown as TreeDocOp,
    targets,
  });
  switch (kind) {
    case 'list':
      return {
        paragraphOp: {
          op: 'setListNumbering',
          numId: random() < 0.25 ? null : String(1 + Math.floor(random() * 7)),
          level: Math.floor(random() * 3),
        },
      };
    case 'listLevel':
      return { paragraphOp: { op: 'setListLevel', level: Math.floor(random() * 4) } };
    case 'link': {
      if (length === 0) return null;
      const start = boundary(Math.min(offset, length - 1));
      return {
        paragraphOp: {
          op: 'insertHyperlink',
          start,
          end: endBoundary(Math.min(length, start + span)),
          anchor: '_fuzz',
        },
      };
    }
    case 'unlink': {
      const link = pickOf('hyperlink');
      return link === null
        ? null
        : node({ op: 'removeHyperlink', linkId: '' }, [
            { field: 'linkId', localName: 'hyperlink', index: link },
          ]);
    }
    case 'resizeImage':
    case 'moveImage':
    case 'deleteImage':
    case 'wrapImage': {
      const drawing = pickOf('drawing');
      if (drawing === null) return null;
      const target = [{ field: 'drawingNodeId', localName: 'drawing', index: drawing }];
      if (kind === 'deleteImage') return node({ op: 'deleteDrawing', drawingNodeId: '' }, target);
      if (kind === 'wrapImage') {
        const wraps = ['inline', 'square', 'tight', 'topAndBottom', 'behind', 'inFront'];
        return node(
          {
            op: 'setDrawingWrap',
            drawingNodeId: '',
            wrap: wraps[Math.floor(random() * wraps.length)],
          },
          target
        );
      }
      if (kind === 'resizeImage') {
        return node(
          {
            op: 'resizeDrawing',
            drawingNodeId: '',
            extentEmu: {
              cx: 200_000 + Math.floor(random() * 3_000_000),
              cy: 200_000 + Math.floor(random() * 2_000_000),
            },
          },
          target
        );
      }
      return node(
        {
          op: 'positionDrawing',
          drawingNodeId: '',
          position: {
            horizontalEmu: Math.floor(random() * 4_000_000),
            verticalEmu: Math.floor(random() * 4_000_000),
          },
        },
        target
      );
    }
    case 'insertTable':
      return {
        paragraphOp: {
          op: 'insertTable',
          beforeParagraphId: '',
          rows: 1 + Math.floor(random() * 3),
          cols: 1 + Math.floor(random() * 3),
          columnWidthTwips: 2_000,
        },
      };
    case 'insertColumn':
    case 'deleteColumn':
    case 'cellFill':
    case 'mergeCells':
    case 'splitCell': {
      const tables = elements(root, 'tbl');
      if (tables.length === 0) return null;
      const table = Math.floor(random() * tables.length);
      const within = tables[table]!;
      if (kind === 'mergeCells' || kind === 'splitCell')
        return planCellStructure(kind, table, within, random);
      if (kind === 'cellFill') {
        const cell = pickOf('tc', within);
        return cell === null
          ? null
          : node(
              {
                op: 'setTableCellFill',
                tableId: '',
                cellIds: [],
                color:
                  random() < 0.3
                    ? null
                    : { kind: 'hex', value: random() < 0.5 ? 'FFEE88' : '88CCFF' },
              },
              [
                { field: 'tableId', localName: 'tbl', index: table },
                { field: 'cellIds', localName: 'tc', index: cell, within: 0, array: true },
              ]
            );
      }
      const columns = elements(within, 'gridCol').length;
      if (columns === 0 || (kind === 'deleteColumn' && columns < 2)) return null;
      const column = Math.floor(random() * columns);
      const targets: NodeTarget[] = [
        { field: 'tableId', localName: 'tbl', index: table },
        { field: 'gridColumnId', localName: 'gridCol', index: column, within: 0 },
      ];
      return kind === 'insertColumn'
        ? node(
            {
              op: 'insertTableColumn',
              tableId: '',
              gridColumnId: '',
              where: random() < 0.5 ? 'left' : 'right',
            },
            targets
          )
        : node({ op: 'deleteTableColumn', tableId: '', gridColumnId: '' }, targets);
    }
    case 'pageBreak':
      return { paragraphOp: { op: 'insertPageBreak', offset } };
    case 'control':
      return {
        paragraphOp: { op: 'insertInlineContentControl', offset, tag: 'fuzz', text: 'value' },
      };
    case 'footnote':
      return { paragraphOp: { op: 'insertNote', noteKind: 'footnote', offset } };
    case 'comment': {
      // `addComment` is not a tree op: the scenario writes it through the package.
      if (length === 0) return null;
      const start = boundary(Math.min(offset, length - 1));
      return {
        paragraphOp: { op: 'addComment', start, end: endBoundary(Math.min(length, start + span)) },
      };
    }
  }
}

/**
 * Merge two cells of one table, or split one. The store refuses a ragged rectangle or a split
 * the cell cannot take, and a refused edit is an ordinary outcome here: the two cells are
 * picked near each other, so most merges hold.
 */
function planCellStructure(
  kind: 'mergeCells' | 'splitCell',
  table: number,
  within: OoxmlNode,
  random: () => number
): NodeAddressed | null {
  const cells = elements(within, 'tc').length;
  if (cells === 0) return null;
  const first = Math.floor(random() * cells);
  const tableTarget: NodeTarget = { field: 'tableId', localName: 'tbl', index: table };
  if (kind === 'splitCell') {
    const rows = 1 + Math.floor(random() * 2);
    const columns = rows === 1 ? 2 + Math.floor(random() * 2) : 1 + Math.floor(random() * 2);
    return {
      kind: 'node',
      op: { op: 'splitTableCell', tableId: '', cellId: '', rows, columns } as unknown as TreeDocOp,
      targets: [tableTarget, { field: 'cellId', localName: 'tc', index: first, within: 0 }],
    };
  }
  if (cells < 2) return null;
  const reach = 1 + Math.floor(random() * 4);
  const second = Math.min(cells - 1, first + reach);
  if (second === first) return null;
  return {
    kind: 'node',
    op: { op: 'mergeTableCells', tableId: '', cellIds: [] } as unknown as TreeDocOp,
    targets: [
      tableTarget,
      { field: 'cellIds', localName: 'tc', index: first, within: 0, array: true },
      { field: 'cellIds', localName: 'tc', index: second, within: 0, array: true },
    ],
  };
}
