import { parentNodeOf } from '../package/ooxml-edit.ts';
import { ooxmlTreesEqual } from '../package/ooxml-serialize.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlPart } from '../package/ooxml-tree.ts';
import type { RevisionSite } from './tree-op-revisions.ts';
function children(node: OoxmlElement, name: string): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  for (const n of node.children)
    if (n.kind !== 'textValue' && n.namespaceUri === WML_NAMESPACE_URI && n.localName === name)
      found.push(n);
  return found;
}
const attr = (node: OoxmlElement, name: string) =>
  node.attributes.find((a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === name)?.value;

function plainGrid(node: OoxmlElement, omit?: string): boolean {
  const columns = children(node, 'gridCol');
  return (
    !node.attributes.length &&
    columns.length > 0 &&
    node.children.every(
      (n) =>
        n.id === omit ||
        (n.kind === 'textValue'
          ? !n.value.trim()
          : n.namespaceUri === WML_NAMESPACE_URI &&
            n.localName === 'gridCol' &&
            !n.children.length &&
            n.attributes.length === 1 &&
            /^\d+$/.test(attr(n, 'w') ?? ''))
    )
  );
}

/** Standalone alignment/grid snapshots without a row decision are unused history in Word.
 * Keep live properties and clean only the unambiguous metadata on unfiltered bulk actions. */
export function unboundTableHistories(
  part: OoxmlPart,
  sites: readonly RevisionSite[]
): ReadonlySet<string> {
  const result = new Set<string>();
  if (!sites.some((s) => ['tblPrChange', 'tblGridChange'].includes(s.node.localName)))
    return result;
  const identity = (site: RevisionSite) =>
    JSON.stringify(['id', 'author', 'date'].map((name) => attr(site.node, name)));
  const identities = new Map<string, number>();
  const tableRecords = new Map<string, number>();
  for (const site of sites) {
    const key = identity(site);
    identities.set(key, (identities.get(key) ?? 0) + 1);
    let ancestor = site.parent;
    while (ancestor && ancestor.kind !== 'table') ancestor = parentNodeOf(part, ancestor.id);
    if (ancestor) tableRecords.set(ancestor.id, (tableRecords.get(ancestor.id) ?? 0) + 1);
  }
  for (const site of sites) {
    if (
      site.refused ||
      !['tblPrChange', 'tblGridChange'].includes(site.node.localName) ||
      !site.parent
    )
      continue;
    const current = site.parent;
    if (site.node.localName === 'tblGridChange') {
      const previous = children(site.node, 'tblGrid');
      if (previous.length !== 1 || !plainGrid(current, site.node.id) || !plainGrid(previous[0]!))
        continue;
      if (children(current, 'gridCol').length !== children(previous[0]!, 'gridCol').length)
        continue;
    } else {
      const previous = children(site.node, 'tblPr');
      const jc = children(current, 'jc');
      if (previous.length !== 1 || jc.length !== 1 || children(previous[0]!, 'jc').length) continue;
      if (
        jc[0]!.children.length ||
        jc[0]!.attributes.length !== 1 ||
        !['left', 'center', 'right', 'start', 'end'].includes(attr(jc[0]!, 'val') ?? '')
      )
        continue;
      if (
        !ooxmlTreesEqual(
          {
            ...current,
            children: current.children.filter((n) => n.id !== site.node.id && n.id !== jc[0]!.id),
          } as OoxmlElement,
          previous[0]!
        )
      )
        continue;
    }
    const table = parentNodeOf(part, current.id);
    if (table?.kind !== 'table' || !children(table, 'tr').length) continue;
    // Keep reused identities and any table with another formatting history explicit.
    if (identities.get(identity(site)) !== 1 || tableRecords.get(table.id) !== 1) continue;
    result.add(site.node.id);
  }
  return result;
}
