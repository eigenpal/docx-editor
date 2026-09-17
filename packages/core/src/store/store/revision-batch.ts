import {
  tableRevisionContentTarget,
  tableRevisionRemovals,
  tableRevisionNeighbours,
  tableMergeDependencies,
} from './revision-table-plan.ts';
import { paragraphMergeSources } from './revision-paragraph-merge.ts';
import { preservedRevisionProperty } from './revision-property-records.ts';
import { recordedProperties } from './tree-op-tracked-properties.ts';
import { findNode, parentNodeOf } from '../package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { revisionItemsOf } from './review-reads.ts';
import { reviewItemKey, revisionSiteNodeIdsOf, type ReviewRevisionItem } from './review-items.ts';
import {
  collectRevisionSites,
  namedMoveRanges,
  orphanMoveDestinationSites,
} from './tree-op-revisions.ts';
import type { TreeDocOp } from './tree-op-types.ts';

/** A canonical review decision. Keys are valid only in the open document. @public */
export interface RevisionBatchEntry {
  readonly key: string;
  readonly author: string;
  readonly partName: string;
  readonly revisionKind: ReviewRevisionItem['revisionKind'];
}

/** Why a requested decision remains pending. @public */
export type RevisionBatchSkipReason =
  | 'unsupported-revision'
  | 'incomplete-group'
  | 'unknown-revision';

/** Outcome of one selected-set decision. Counts refer to review decisions, not XML markers. @public */
export interface RevisionBatchResult {
  readonly resolved: readonly RevisionBatchEntry[];
  readonly skipped: readonly {
    readonly key: string;
    readonly reason: RevisionBatchSkipReason;
    readonly revision?: RevisionBatchEntry;
  }[];
  /** All pending decisions in the addressed scope, including excluded and unsupported changes. */
  readonly remaining: number;
}

/** @internal Pure preflight; callers commit its operations through their normal write guards. */
export function planRevisionBatch(
  part: OoxmlPart,
  action: 'accept' | 'reject',
  keys?: readonly string[],
  scopeRoot?: OoxmlNode
): { ops: readonly TreeDocOp[]; result: RevisionBatchResult } {
  const root = scopeRoot ?? part.root;
  const scopedPart = root.kind === 'textValue' ? part : { ...part, root };
  const items = revisionItemsOf(scopedPart);
  if (keys?.length === 0 || items.length === 0) {
    return {
      ops: [],
      result: {
        resolved: [],
        skipped: [...new Set(keys ?? [])].map((key) => ({ key, reason: 'unknown-revision' })),
        remaining: items.length,
      },
    };
  }
  const selected = new Set(keys ?? items.map(reviewItemKey));
  const byKey = new Map(items.map((item) => [reviewItemKey(item), item]));
  const selectedSites = new Set<string>();
  for (const key of selected) {
    const item = byKey.get(key);
    if (item) for (const id of revisionSiteNodeIdsOf(item)) selectedSites.add(id);
  }
  const sites = collectRevisionSites(scopedPart);
  const orphanDestinations = orphanMoveDestinationSites(root, sites);
  const indices = new Map(sites.map((site, index) => [site.node.id, index]));
  const parents = sites.map((_, index) => index);
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]!]!;
      index = parents[index]!;
    }
    return index;
  };
  const join = (a: number, b: number): void => {
    parents[find(b)] = find(a);
  };
  const owners = new Map<string, number>();
  for (const item of items) {
    const own = revisionSiteNodeIdsOf(item).flatMap((id) => {
      const index = indices.get(id);
      return index === undefined ? [] : [index];
    });
    for (const index of own) join(own[0]!, index);
  }
  const selectedTableSites = sites.filter((site) => selectedSites.has(site.node.id));
  const removedTables = new Set(tableRevisionRemovals(part, selectedTableSites, action).keys());
  const mergeSources = new Map<string, ReadonlySet<string>>();
  // Row decisions can remove every descendant. Property restoration replaces the live
  // property container. Containment also protects wrappers the resolver would sweep empty.
  for (const [index, site] of sites.entries()) {
    if (
      action === 'reject' &&
      site.propertyChange &&
      site.parent &&
      selectedSites.has(site.node.id)
    ) {
      // Restoration preserves live paragraph marks and, for pPrChange, rPr/sectPr.
      // Only children actually replaced by the resolver depend on this decision.
      for (const child of site.parent.children) {
        const preserved = preservedRevisionProperty(site.node.localName, child);
        if (!preserved) owners.set(child.id, index);
      }
    }
    // Removing a paragraph mark merges its text forward and drops its paragraph properties.
    // Keep numbering, section and formatting decisions in those properties in the same group.
    const removesMark =
      action === 'accept'
        ? site.node.localName === 'del' || site.node.localName === 'moveFrom'
        : site.node.localName === 'ins' || site.node.localName === 'moveTo';
    if (
      site.paragraphMark &&
      site.parent &&
      removesMark &&
      !orphanDestinations.has(site.node.id) &&
      selectedSites.has(site.node.id)
    ) {
      const properties = parentNodeOf(part, site.parent.id);
      const paragraph = properties && parentNodeOf(part, properties.id);
      const container = paragraph && parentNodeOf(part, paragraph.id);
      if (properties && paragraph && container) {
        let sources = mergeSources.get(container.id);
        if (!sources) {
          sources = paragraphMergeSources(container.children, removedTables);
          mergeSources.set(container.id, sources);
        }
        if (sources.has(paragraph.id)) owners.set(properties.id, index);
      }
    }
    if (selectedSites.has(site.node.id) && tableRevisionContentTarget(part, site, action)) {
      const target = tableRevisionContentTarget(part, site, action);
      if (target && !site.refused) owners.set(target.id, index);
    }
  }
  for (const [cellId, markers] of tableRevisionNeighbours(part, selectedTableSites, action)) {
    const cell = findNode(part, cellId);
    const markerIndex = indices.get(markers[0]!);
    if (cell?.kind !== 'tableCell' || markerIndex === undefined) continue;
    for (const property of cell.children) {
      if (property.localName === 'tcPr') owners.set(property.id, markerIndex);
    }
  }
  const visit = (node: OoxmlNode, ancestor?: number): void => {
    const site = indices.get(node.id);
    const owner = owners.get(node.id);
    if (site !== undefined && owner !== undefined) join(owner, site);
    const own = site ?? owner;
    if (own !== undefined && ancestor !== undefined) join(ancestor, own);
    const next = own ?? ancestor;
    if (node.kind !== 'textValue') for (const child of node.children) visit(child, next);
  };
  visit(root);
  for (const range of namedMoveRanges(root).values()) {
    const own = range.wrappers.flatMap((node) => {
      const index = indices.get(node.id);
      return index === undefined ? [] : [index];
    });
    for (const index of own) join(own[0]!, index);
  }
  for (const ids of sites.some((site) => site.node.localName === 'cellMerge')
    ? tableMergeDependencies(scopedPart)
    : []) {
    const group = ids.flatMap((id) => {
      const index = indices.get(id);
      return index === undefined ? [] : [index];
    });
    for (const index of group) join(group[0]!, index);
  }
  const groups = new Map<number, typeof sites>();
  for (const [index, site] of sites.entries()) {
    const id = find(index);
    const group = groups.get(id) ?? [];
    group.push(site);
    groups.set(id, group);
  }
  const reasons = new Map<number, RevisionBatchSkipReason>();
  for (const [id, group] of groups) {
    if (
      group.some(
        (site) =>
          site.refused ||
          (action === 'reject' && site.propertyChange && recordedProperties(site.node) === null)
      )
    ) {
      reasons.set(id, 'unsupported-revision');
    } else if (group.some((site) => !selectedSites.has(site.node.id))) {
      reasons.set(id, 'incomplete-group');
    }
  }
  for (const item of items) {
    if (!item.readOnly) continue;
    for (const id of revisionSiteNodeIdsOf(item)) {
      const index = indices.get(id);
      if (index !== undefined) reasons.set(find(index), 'unsupported-revision');
    }
  }
  // Cell removal may remove its row; row removal may remove the containing table.
  // Only eligible groups contribute to this closure, so a retained row does not block peers.
  const eligible = sites.filter(
    (site, index) => selectedSites.has(site.node.id) && !reasons.has(find(index))
  );
  let removedContainer = false;
  for (const [id, markerIds] of tableRevisionRemovals(part, eligible, action)) {
    if (owners.has(id)) continue;
    const owner = indices.get(markerIds[0]!);
    if (owner !== undefined) {
      owners.set(id, owner);
      removedContainer = true;
    }
  }
  if (removedContainer) {
    visit(root);
    for (const [group, reason] of [...reasons]) {
      const root = find(group);
      if (reasons.get(root) !== 'unsupported-revision') reasons.set(root, reason);
    }
  }
  const resolved: RevisionBatchEntry[] = [];
  const skipped: RevisionBatchResult['skipped'][number][] = [];
  const acceptedSites = new Set<string>();
  for (const key of selected) {
    const item = byKey.get(key);
    if (!item) {
      skipped.push({ key, reason: 'unknown-revision' });
      continue;
    }
    const entry: RevisionBatchEntry = {
      key,
      author: item.author,
      partName: part.name,
      revisionKind: item.revisionKind,
    };
    const ids = revisionSiteNodeIdsOf(item);
    let reason: RevisionBatchSkipReason | undefined;
    for (const id of ids) {
      const index = indices.get(id);
      reason = index === undefined ? 'incomplete-group' : reasons.get(find(index));
      if (reason) break;
    }
    if (!ids.length) reason = 'unsupported-revision';
    if (reason) skipped.push({ key, reason, revision: entry });
    else {
      resolved.push(entry);
      for (const id of ids) acceptedSites.add(id);
    }
  }
  return {
    ops: acceptedSites.size
      ? [
          {
            op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions',
            siteNodeIds: [...acceptedSites],
            ...(scopeRoot ? { scopeRootId: scopeRoot.id } : {}),
          },
        ]
      : [],
    result: { resolved, skipped, remaining: items.length - resolved.length },
  };
}
