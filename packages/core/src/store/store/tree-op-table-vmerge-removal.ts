// Vertical-merge repair for a removed table row.
//
// A `w:vMerge w:val="restart"` cell leaves with its row, content included. The cell below it
// at the same grid interval then continues nothing. It becomes the new `restart` when the
// chain goes on past it, and loses `w:vMerge` when it was the chain's last row. Its own
// content stays as it is, and no row further down changes.

import {
  removeNode,
  replaceNode,
  type EditOptions,
  type OoxmlEditResult,
} from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlPart,
  type OoxmlTableRowNode,
} from '../package/ooxml-tree.ts';
import { wmlFreshNamespaceContextAt } from '../package/wml-namespace.ts';
import { wmlChildNamed } from './tree-op-table-shared.ts';
import {
  buildRowGridSlots,
  gridIntervalsMatchExactly,
  rowHasVerticalMerge,
  rowHidesCellInWrapper,
  tableHidesRowAfter,
  tableHidesRowBetween,
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

function directRows(table: OoxmlElement): OoxmlTableRowNode[] {
  return table.children.filter((child) => child.kind === 'tableRow') as OoxmlTableRowNode[];
}

function cellsWithSlots(
  row: OoxmlTableRowNode
): { readonly cell: OoxmlElement; readonly slot: GridCellSlot }[] {
  const slots = buildRowGridSlots(row);
  const cells = row.children.filter((child) => child.kind === 'tableCell') as OoxmlElement[];
  return cells.map((cell, index) => ({ cell, slot: slots[index]! }));
}

/** A row whose grid the walk can read: no wrapped cell, and no wrapped row before it. */
function unreadable(
  table: OoxmlElement,
  upper: OoxmlTableRowNode,
  lower: OoxmlTableRowNode | undefined
): boolean {
  if (!lower) return tableHidesRowAfter(table, upper.id);
  return rowHidesCellInWrapper(lower) || tableHidesRowBetween(table, upper.id, lower.id);
}

/**
 * The continuation markers that removing `rowId` from `table` would orphan, and what each
 * becomes. Refuses `row-hides-cell` when a wrapper hides the cells or rows the answer
 * depends on, because a guessed grid would write the marker into a column with no chain.
 */
export function planVerticalMergeHeadRepairs(
  table: OoxmlElement,
  rowId: string
): VerticalMergeHeadRepairPlan {
  const rows = directRows(table);
  const index = rows.findIndex((row) => row.id === rowId);
  const removed = rows[index];
  if (!removed || !rowHasVerticalMerge(removed)) return NO_REPAIRS;
  if (rowHidesCellInWrapper(removed)) return { ok: false, reason: 'row-hides-cell' };
  const heads = cellsWithSlots(removed).filter(({ slot }) => slot.vMergeKind === 'restart');
  if (heads.length === 0) return NO_REPAIRS;

  const below = rows[index + 1];
  if (unreadable(table, removed, below)) return { ok: false, reason: 'row-hides-cell' };
  if (!below) return NO_REPAIRS;
  const orphans = cellsWithSlots(below).filter(
    ({ slot }) =>
      slot.vMergeKind === 'continue' &&
      heads.some(({ slot: head }) =>
        gridIntervalsMatchExactly(head.startCol, head.span, slot.startCol, slot.span)
      )
  );
  if (orphans.length === 0) return NO_REPAIRS;

  const next = rows[index + 2];
  if (unreadable(table, below, next)) return { ok: false, reason: 'row-hides-cell' };
  const nextSlots = next ? buildRowGridSlots(next) : [];
  const repairs = orphans.map(({ cell, slot }): VerticalMergeHeadRepair => {
    const continues = nextSlots.some(
      (other) =>
        other.vMergeKind === 'continue' &&
        gridIntervalsMatchExactly(slot.startCol, slot.span, other.startCol, other.span)
    );
    return {
      rowId: below.id,
      cellId: cell.id,
      marker: wmlChildNamed(wmlChildNamed(cell, 'tcPr')!, 'vMerge')!,
      becomes: continues ? 'restart' : 'unmerged',
    };
  });
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
