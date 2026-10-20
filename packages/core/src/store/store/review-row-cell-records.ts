// One decision for a tracked row and the cell records its own edit wrote.
//
// Recording a row insertion writes `w:trPr/w:ins` and a `w:cellIns` in every cell of that row,
// by one author at one date; a row deletion writes `w:del` and `w:cellDel` the same way. In the
// open document they share one `@w:id`, and sites that share an id are one decision. A saved
// file gives each record its own id, so after reopening the id no longer joins them, and the row
// read as one card with a separate card per cell: rejecting a cell card took one cell out of an
// inserted row.
//
// This joins them again by what does not change on save: the cell record sits in a cell of the
// row, records the same direction, and has the row record's author and date. The joined card
// is the one the shared id gives, so the review list reads the same before and after a save.

import { parentNodeOf } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlPart } from '../package/ooxml-tree.ts';
import {
  registerRevisionSiteNodeIds,
  revisionSiteNodeIdsOf,
  type ReviewRevisionItem,
} from './review-items.ts';
import type { RevisionSite } from './tree-op-revisions.ts';

const CELL_RECORD: Readonly<Record<string, string>> = { ins: 'cellIns', del: 'cellDel' };

const attribute = (node: OoxmlElement, name: string) =>
  node.attributes.find((a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === name)?.value;

/** The row a row record or a cell record belongs to, with what joins them. */
function rowKey(part: OoxmlPart, site: RevisionSite, cell: boolean): string | null {
  if (site.refused || !site.parent || site.node.namespaceUri !== WML_NAMESPACE_URI) return null;
  const date = attribute(site.node, 'date');
  const author = attribute(site.node, 'author');
  if (date === undefined || author === undefined) return null;
  let row: { readonly id: string; readonly localName?: string } | null;
  let direction: string | undefined;
  if (cell) {
    if (site.parent.localName !== 'tcPr') return null;
    direction = Object.keys(CELL_RECORD).find((key) => CELL_RECORD[key] === site.node.localName);
    const tableCell = parentNodeOf(part, site.parent.id);
    row = tableCell?.localName === 'tc' ? parentNodeOf(part, tableCell.id) : null;
  } else {
    if (site.parent.localName !== 'trPr' || !(site.node.localName in CELL_RECORD)) return null;
    direction = site.node.localName;
    row = parentNodeOf(part, site.parent.id);
  }
  if (!direction || row?.localName !== 'tr') return null;
  // NUL-separated: XML text cannot carry U+0000, so an author name cannot forge a boundary.
  return [row.id, direction, author, date].join('\u0000');
}

/** The single key every site of `item` shares in `keys`, or null. */
function keyOf(item: ReviewRevisionItem, keys: ReadonlyMap<string, string | null>): string | null {
  const ids = revisionSiteNodeIdsOf(item);
  const first = ids.length ? keys.get(ids[0]!) : null;
  if (!first || !ids.every((id) => keys.get(id) === first)) return null;
  return first;
}

const unique = <T>(values: readonly T[]): T[] => [
  ...new Map(values.map((value) => [JSON.stringify(value), value])).values(),
];

export function joinRowCellRecords(
  part: OoxmlPart,
  items: readonly ReviewRevisionItem[],
  sites: readonly RevisionSite[]
): readonly ReviewRevisionItem[] {
  const rowKeys = new Map<string, string | null>();
  const cellKeys = new Map<string, string | null>();
  for (const site of sites) {
    if (site.parent?.localName === 'trPr') rowKeys.set(site.node.id, rowKey(part, site, false));
    else if (site.parent?.localName === 'tcPr') {
      cellKeys.set(site.node.id, rowKey(part, site, true));
    }
  }
  if (rowKeys.size === 0 || cellKeys.size === 0) return items;
  // The row cards: every site a row record of one row, or a cell record that already joins it
  // through a shared id.
  const rows = new Map<string, ReviewRevisionItem>();
  for (const item of items) {
    if (item.revisionKind !== 'structural' || item.readOnly) continue;
    const ids = revisionSiteNodeIdsOf(item);
    const key = rowKeys.get(ids.find((id) => rowKeys.has(id)) ?? '');
    if (!key || rows.has(key)) continue;
    if (ids.every((id) => (rowKeys.has(id) ? rowKeys.get(id) : cellKeys.get(id)) === key)) {
      rows.set(key, item);
    }
  }
  if (rows.size === 0) return items;
  const cellsOf = new Map<ReviewRevisionItem, ReviewRevisionItem[]>();
  const consumed = new Set<ReviewRevisionItem>();
  for (const item of items) {
    if (item.revisionKind !== 'structural' || item.readOnly) continue;
    const key = keyOf(item, cellKeys);
    const row = key ? rows.get(key) : undefined;
    if (!row || row === item) continue;
    const cells = cellsOf.get(row) ?? [];
    cells.push(item);
    cellsOf.set(row, cells);
    consumed.add(item);
  }
  if (consumed.size === 0) return items;
  return items
    .filter((item) => !consumed.has(item))
    .map((item) => {
      const cells = cellsOf.get(item);
      if (!cells) return item;
      const all = [item, ...cells];
      const structuralChanges = unique(all.flatMap((member) => member.structuralChanges ?? []));
      return registerRevisionSiteNodeIds(
        {
          ...item,
          addresses: unique(all.flatMap((member) => member.addresses)),
          ...(structuralChanges.length ? { structuralChanges } : {}),
          ranges: unique(all.flatMap((member) => member.ranges)),
          nesting: all.reduce((deepest, member) => Math.max(deepest, member.nesting), 0),
        },
        all.flatMap(revisionSiteNodeIdsOf)
      );
    });
}
