import { tableChildren } from './revision-table-children.ts';
import { parentNodeOf } from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import type { RevisionSite } from './tree-op-revisions.ts';
interface NestedState {
  table: boolean;
  removedRow: boolean;
}
const caches = {
  accept: new WeakMap<OoxmlNode, NestedState>(),
  reject: new WeakMap<OoxmlNode, NestedState>(),
};
function state(node: OoxmlNode, action: 'accept' | 'reject'): NestedState {
  const cache = caches[action];
  const previous = cache.get(node);
  if (previous) return previous;
  const result = { table: false, removedRow: false };
  if (
    node.kind !== 'textValue' &&
    !(node.namespaceUri === WML_NAMESPACE_URI && /Change$/.test(node.localName))
  ) {
    result.table = node.kind === 'table';
    if (node.kind === 'tableRow') {
      const marker = action === 'accept' ? 'del' : 'ins';
      result.removedRow = node.children.some(
        (p) =>
          p.namespaceUri === WML_NAMESPACE_URI &&
          p.localName === 'trPr' &&
          p.children.some(
            (c) =>
              c.kind !== 'textValue' &&
              c.namespaceUri === WML_NAMESPACE_URI &&
              c.localName === marker
          )
      );
    }
    for (const child of node.children) {
      const nested = state(child, action);
      result.table ||= nested.table;
      result.removedRow ||= nested.removedRow;
    }
  }
  cache.set(node, result);
  return result;
}
/** Word retains a row end around a surviving nested table when no nested row is
 * being removed in this direction. Its independent tracked text can still resolve. */
export function retainsNestedTable(row: OoxmlElement, action: 'accept' | 'reject'): boolean {
  if (row.kind !== 'tableRow') return false;
  const content = tableChildren(row, 'tableCell');
  return (
    content.some((n) => state(n, action).table) && !content.some((n) => state(n, action).removedRow)
  );
}
export function retainedNestedRowSites(
  part: OoxmlPart,
  sites: readonly RevisionSite[],
  action: 'accept' | 'reject'
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const site of sites) {
    if (
      site.refused ||
      site.node.localName !== (action === 'accept' ? 'del' : 'ins') ||
      site.parent?.localName !== 'trPr'
    )
      continue;
    const row = parentNodeOf(part, site.parent.id);
    if (row?.kind === 'tableRow' && retainsNestedTable(row, action)) ids.add(site.node.id);
  }
  return ids;
}
