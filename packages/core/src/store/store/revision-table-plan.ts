import { tableChildren, isTableWrapper } from './revision-table-children.ts';
import { parentNodeOf } from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import type { RevisionSite } from './tree-op-revisions.ts';

export const CELL_REVISION_NAMES: ReadonlySet<string> = new Set([
  'cellIns',
  'cellDel',
  'cellMerge',
]);
export function revisionAttribute(node: OoxmlElement, name: string): string | undefined {
  return node.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === name
  )?.value;
}

/** Row markers and cell markers describe distinct structural decisions. */
export function tableRevisionTarget(part: OoxmlPart, site: RevisionSite): OoxmlElement | null {
  if (!site.parent) return null;
  const name = site.node.localName;
  const row = (name === 'ins' || name === 'del') && site.parent.localName === 'trPr';
  if (!row && !(CELL_REVISION_NAMES.has(name) && site.parent.localName === 'tcPr')) return null;
  const target = parentNodeOf(part, site.parent.id);
  return target?.kind === (row ? 'tableRow' : 'tableCell') ? target : null;
}

export function validTableRevision(
  node: OoxmlElement,
  parent: OoxmlElement | null,
  grandparent: OoxmlElement | null
): boolean {
  if (
    !parent ||
    !grandparent ||
    parent.namespaceUri !== WML_NAMESPACE_URI ||
    grandparent.namespaceUri !== WML_NAMESPACE_URI
  )
    return false;
  const row =
    (node.localName === 'ins' || node.localName === 'del') &&
    parent.localName === 'trPr' &&
    grandparent.kind === 'tableRow';
  const cell =
    CELL_REVISION_NAMES.has(node.localName) &&
    parent.localName === 'tcPr' &&
    grandparent.kind === 'tableCell';
  if (!row && !cell) return false;
  // A duplicate marker cannot be mistaken for another cell or another decision.
  if (
    parent.children.filter(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === node.localName
    ).length !== 1
  )
    return false;
  if (node.localName === 'cellMerge') {
    return ['vMerge', 'vMergeOrig'].every((name) => {
      const value = revisionAttribute(node, name);
      return value === undefined || value === 'cont' || value === 'rest';
    });
  }
  return true;
}

export function tableRevisionRemoves(site: RevisionSite, action: 'accept' | 'reject'): boolean {
  const name = site.node.localName;
  return action === 'accept'
    ? name === 'del' || name === 'cellDel'
    : name === 'ins' || name === 'cellIns';
}

/** Exact removed cells/rows/tables and the selected markers responsible for their removal. */
export function tableRevisionRemovals(
  part: OoxmlPart,
  sites: readonly RevisionSite[],
  action: 'accept' | 'reject'
): ReadonlyMap<string, readonly string[]> {
  const removed = new Map<string, readonly string[]>();
  for (const site of sites) {
    if (site.refused || !tableRevisionRemoves(site, action)) continue;
    const target = tableRevisionTarget(part, site);
    if (target) removed.set(target.id, [...(removed.get(target.id) ?? []), site.node.id]);
  }
  if (!removed.size) return removed;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue' || removed.has(node.id)) return;
    for (const child of node.children) visit(child);
    if (node.kind !== 'table' && node.kind !== 'tableRow' && !isTableWrapper(node)) return;
    const children =
      node.kind === 'table'
        ? tableChildren(node, 'tableRow')
        : node.kind === 'tableRow'
          ? tableChildren(node, 'tableCell')
          : [...tableChildren(node, 'tableRow'), ...tableChildren(node, 'tableCell')];
    if (children.length && children.every((child) => removed.has(child.id))) {
      removed.set(
        node.id,
        children.flatMap((child) => [...removed.get(child.id)!])
      );
    }
  };
  visit(part.root);
  return removed;
}

/** Merge continuations discard cell content, so their descendants share the decision. */
export function tableRevisionContentTarget(
  part: OoxmlPart,
  site: RevisionSite,
  action: 'accept' | 'reject'
): OoxmlElement | null {
  if (site.refused) return null;
  if (tableRevisionRemoves(site, action)) return tableRevisionTarget(part, site);
  return site.node.localName === 'cellMerge' &&
    revisionAttribute(site.node, action === 'accept' ? 'vMerge' : 'vMergeOrig') === 'cont'
    ? tableRevisionTarget(part, site)
    : null;
}

/** Neighbour cells whose geometry changes when selected cells are removed. */
export function tableRevisionNeighbours(
  part: OoxmlPart,
  sites: readonly RevisionSite[],
  action: 'accept' | 'reject'
): ReadonlyMap<string, readonly string[]> {
  const removed = tableRevisionRemovals(part, sites, action);
  const neighbours = new Map<string, readonly string[]>();
  if (!removed.size) return neighbours;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue' || removed.has(node.id)) return;
    if (node.kind === 'table') {
      let precedingRemovals: readonly string[] = [];
      for (const row of tableChildren(node, 'tableRow')) {
        const sources = removed.get(row.id);
        if (sources) {
          precedingRemovals = [...precedingRemovals, ...sources];
          continue;
        }
        if (precedingRemovals.length)
          for (const cell of tableChildren(row, 'tableCell')) {
            const properties = cell.children.find(
              (n) => n.kind !== 'textValue' && n.localName === 'tcPr'
            );
            if (
              properties &&
              properties.kind !== 'textValue' &&
              properties.children.some(
                (n) => n.kind !== 'textValue' && ['vMerge', 'cellMerge'].includes(n.localName)
              )
            )
              neighbours.set(cell.id, precedingRemovals);
          }
        precedingRemovals = [];
      }
    }
    if (node.kind === 'tableRow') {
      const cells = tableChildren(node, 'tableCell');
      const first = cells.find((cell) => !removed.has(cell.id));
      let previous: OoxmlElement | undefined;
      for (const cell of cells) {
        const sources = removed.get(cell.id);
        if (sources) {
          const receiver = previous ?? first;
          if (receiver)
            neighbours.set(receiver.id, [...(neighbours.get(receiver.id) ?? []), ...sources]);
        } else previous = cell;
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return neighbours;
}

/** A merge chain shares its head/continuation decisions even across different authors. */
export function tableMergeDependencies(part: OoxmlPart): readonly (readonly string[])[] {
  const groups: string[][] = [];
  const direct = (node: OoxmlElement, name: string): OoxmlElement | undefined => {
    for (const child of node.children)
      if (
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === name
      )
        return child;
    return undefined;
  };
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'table') {
      let above = new Map<string, { ids: string[]; active: boolean }>();
      for (const row of tableChildren(node, 'tableRow')) {
        const current = new Map<string, { ids: string[]; active: boolean }>();
        const pr = direct(row, 'trPr');
        let at = Number(pr && revisionAttribute(direct(pr, 'gridBefore') ?? pr, 'val')) || 0;
        for (const cell of tableChildren(row, 'tableCell')) {
          const pr = direct(cell, 'tcPr');
          const span = Number(pr && revisionAttribute(direct(pr, 'gridSpan') ?? pr, 'val')) || 1;
          const key = `${at}:${at + span}`;
          at += span;
          if (!pr) continue;
          const merge = direct(pr, 'cellMerge');
          const live = direct(pr, 'vMerge');
          const history = direct(pr, 'tcPrChange');
          const own = [...(merge ? [merge.id] : []), ...(history ? [history.id] : [])];
          const continuation = merge
            ? ['vMerge', 'vMergeOrig'].some((name) => revisionAttribute(merge, name) === 'cont')
            : live && revisionAttribute(live, 'val') !== 'restart';
          const prior = above.get(key);
          if (continuation && prior?.active && own.length) {
            groups.push([...prior.ids, ...own]);
          }
          const active = !!merge || !!live;
          current.set(key, {
            ids: continuation && prior?.active ? [...prior.ids, ...own] : own,
            active,
          });
        }
        above = current;
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return groups;
}
