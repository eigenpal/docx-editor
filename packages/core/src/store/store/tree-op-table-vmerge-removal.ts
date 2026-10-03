// Vertical-merge repair for a removed table row.
//
// A `w:vMerge w:val="restart"` cell leaves with its row, content included. The cell below it
// at the same grid interval is then a continuation under a new neighbour. If that neighbour
// has a merged cell starting at the same grid column, the continuation joins it and nothing
// changes. Otherwise it continues nothing: it becomes the new `restart` when the chain goes
// on past it, and loses `w:vMerge` when it was the chain's last row. Its own content stays,
// and no row further down changes. Layout reads a continuation by the same rule.
//
// Rows and cells inside content controls count where they stand, as they do for layout.

import {
  findNode,
  removeNode,
  replaceNode,
  type EditOptions,
  type OoxmlEditResult,
} from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlTableRowNode,
} from '../package/ooxml-tree.ts';
import { wmlFreshNamespaceContextAt } from '../package/wml-namespace.ts';
import { flattenContentControls } from '../package/content-control-nodes.ts';
import { tableAncestorOf, wmlChildNamed } from './tree-op-table-shared.ts';
import {
  buildCellGridSlots,
  gridIntervalsMatchExactly,
  rowHasVerticalMerge,
  subtreeHolds,
  type GridCellSlot,
} from './tree-op-table-vmerge.ts';
import type { TreeOpRejection } from './tree-op-types.ts';

export interface VerticalMergeHeadRepair {
  readonly rowId: string;
  readonly cellId: string;
  /** The orphaned continuation marker. */
  readonly marker: OoxmlElement;
  /** `restart` when the chain goes on below the cell; otherwise the marker is removed. */
  readonly becomes: 'restart' | 'unmerged';
}

export type VerticalMergeHeadRepairPlan =
  | { readonly ok: true; readonly repairs: readonly VerticalMergeHeadRepair[] }
  | { readonly ok: false; readonly reason: TreeOpRejection };

const NO_REPAIRS: VerticalMergeHeadRepairPlan = { ok: true, repairs: [] };

interface Flattened<T> {
  readonly items: readonly T[];
  /** Something other than a content control hides a row or cell the walk cannot type. */
  readonly unreadable: boolean;
}

/**
 * Typed rows or cells of `root` in document order. Content controls unwrap as they do for
 * layout, so both read the same grid; any other element holding a row or cell, such as
 * `w:customXml`, marks the result unreadable.
 */
function flatten<T extends OoxmlNode>(root: OoxmlElement, want: 'row' | 'cell'): Flattened<T> {
  const kind = want === 'row' ? 'tableRow' : 'tableCell';
  const items: T[] = [];
  for (const node of flattenContentControls(root.children)) {
    if (node.kind === kind) items.push(node as T);
    else if (node.kind !== 'textValue' && subtreeHolds(node, want)) {
      return { items, unreadable: true };
    }
  }
  return { items, unreadable: false };
}

interface ReadRow {
  readonly row: OoxmlTableRowNode;
  readonly cells: readonly OoxmlElement[];
  readonly slots: readonly GridCellSlot[];
}

function readRow(row: OoxmlTableRowNode): ReadRow | null {
  const cells = flatten<OoxmlElement>(row, 'cell');
  if (cells.unreadable) return null;
  return { row, cells: cells.items, slots: buildCellGridSlots(row, cells.items) };
}

function sameInterval(a: GridCellSlot, b: GridCellSlot): boolean {
  return gridIntervalsMatchExactly(a.startCol, a.span, b.startCol, b.span);
}

/**
 * The continuation markers that removing `rowId` would orphan, and what each becomes.
 * Refuses `row-hides-cell` when the tree hides a cell or row the answer depends on, because
 * a guessed grid would write the marker into a column with no chain.
 */
export function planVerticalMergeHeadRepairs(
  part: OoxmlPart,
  rowId: string
): VerticalMergeHeadRepairPlan {
  const target = findNode(part, rowId);
  if (!target || target.kind !== 'tableRow' || !rowHasVerticalMerge(target)) return NO_REPAIRS;
  const removed = readRow(target);
  if (!removed) return { ok: false, reason: 'row-hides-cell' };
  const heads = removed.slots.filter((slot) => slot.vMergeKind === 'restart');
  if (heads.length === 0) return NO_REPAIRS;
  const table = tableAncestorOf(part, rowId);
  if (!table) return NO_REPAIRS;
  const rows = flatten<OoxmlTableRowNode>(table, 'row');
  const index = rows.items.findIndex((row) => row.id === rowId);
  if (rows.unreadable || index === -1) return { ok: false, reason: 'row-hides-cell' };
  const belowRow = rows.items[index + 1];
  if (!belowRow) return NO_REPAIRS;

  const below = readRow(belowRow);
  if (!below) return { ok: false, reason: 'row-hides-cell' };
  const candidates = below.slots.flatMap((slot, cellIndex) =>
    slot.vMergeKind === 'continue' && heads.some((head) => sameInterval(head, slot))
      ? [{ slot, cell: below.cells[cellIndex]! }]
      : []
  );
  if (candidates.length === 0) return NO_REPAIRS;

  const aboveRow = rows.items[index - 1];
  const nextRow = rows.items[index + 2];
  const above = aboveRow ? readRow(aboveRow) : null;
  const next = nextRow ? readRow(nextRow) : null;
  if ((aboveRow && !above) || (nextRow && !next)) return { ok: false, reason: 'row-hides-cell' };

  const repairs: VerticalMergeHeadRepair[] = [];
  for (const { slot, cell } of candidates) {
    // A merged cell starting at the same column above takes the continuation over.
    const joins = above?.slots.some(
      (other) => other.vMergeKind !== 'none' && other.startCol === slot.startCol
    );
    if (joins) continue;
    const continues = next?.slots.some(
      (other) => other.vMergeKind === 'continue' && sameInterval(slot, other)
    );
    repairs.push({
      rowId: below.row.id,
      cellId: cell.id,
      marker: wmlChildNamed(wmlChildNamed(cell, 'tcPr')!, 'vMerge')!,
      becomes: continues ? 'restart' : 'unmerged',
    });
  }
  return { ok: true, repairs };
}

function restartMarker(part: OoxmlPart, marker: OoxmlElement): OoxmlElement {
  const wml = wmlFreshNamespaceContextAt(part, marker);
  const val: OoxmlAttribute = {
    kind: 'wmlVal',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'val',
    prefix: wml.attributePrefix,
    value: 'restart',
  } as const;
  const kept = marker.attributes.filter(
    (attribute) => attribute.namespaceUri !== WML_NAMESPACE_URI || attribute.localName !== 'val'
  );
  return { ...marker, attributes: [...kept, val] } as OoxmlElement;
}

/** One edit per repair, to run in the same write that removes the row. */
export function verticalMergeHeadRepairEdits(
  repairs: readonly VerticalMergeHeadRepair[],
  options?: EditOptions
): ((current: OoxmlPart) => OoxmlEditResult)[] {
  return repairs.map(
    ({ marker, becomes }) =>
      (current) =>
        becomes === 'restart'
          ? replaceNode(current, marker.id, restartMarker(current, marker), options)
          : removeNode(current, marker.id, options)
  );
}

/** Ids a repair touches, for the op's `dirty` list. */
export function verticalMergeHeadRepairDirtyIds(
  repairs: readonly VerticalMergeHeadRepair[]
): string[] {
  return repairs.flatMap(({ rowId, cellId }) => [rowId, cellId]);
}
