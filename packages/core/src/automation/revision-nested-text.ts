// One decision on a text revision nested with other pending text revisions.
//
// A strike over another author's inserted words sits inside their insertion. Each author
// decides their own change: accepting the insertion leaves the strike pending, and rejecting
// the strike leaves the insertion pending. The batch planner groups nested sites, so a single
// decision on one of them would otherwise refuse as an incomplete group.
import { parentNodeOf } from '../store/package/ooxml-edit.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import {
  reviewItemKey,
  revisionSiteNodeIdsOf,
  type ReviewRevisionItem,
} from '../store/store/review-items.ts';
import { revisionItemsOf } from '../store/store/review-reads.ts';
import { planRevisionBatch } from '../store/store/revision-batch.ts';
import { collectRevisionSites } from '../store/store/tree-op-revisions.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { AutomationStoryReads } from './reads.ts';
import { sharesItsPart } from './stories.ts';

const TEXT_KINDS: readonly string[] = ['insert', 'delete'];

/**
 * Site-scoped ops for one text insertion or deletion nested with other text revisions, or no
 * ops when anything else shares its group.
 *
 * The preflight resolves the item and every revision nested with it as one batch first. Only
 * when that whole set is resolvable text do the ops resolve the item's own sites alone.
 */
export function nestedTextDecisionOps(
  reads: AutomationStoryReads,
  item: ReviewRevisionItem,
  action: 'accept' | 'reject'
): readonly TreeDocOp[] {
  if (!TEXT_KINDS.includes(item.revisionKind)) return [];
  const own = new Set(revisionSiteNodeIdsOf(item));
  const ancestors = new Set<string>();
  const climb = (id: string, visit: (nodeId: string) => boolean): boolean => {
    for (let node = parentNodeOf(reads.part, id); node; node = parentNodeOf(reads.part, node.id))
      if (visit(node.id)) return true;
    return false;
  };
  for (const id of own) climb(id, (nodeId) => (ancestors.add(nodeId), false));
  const nestsWith = (other: ReviewRevisionItem) =>
    revisionSiteNodeIdsOf(other).some(
      (id) => ancestors.has(id) || climb(id, (nodeId) => own.has(nodeId))
    );
  const key = reviewItemKey(item);
  const keys = [key];
  for (const other of revisionItemsOf(reads.part)) {
    if (reviewItemKey(other) === key || !nestsWith(other)) continue;
    if (!TEXT_KINDS.includes(other.revisionKind)) return [];
    keys.push(reviewItemKey(other));
  }
  if (keys.length === 1) return [];
  const scope = sharesItsPart(reads.story) ? reads.root : undefined;
  if (planRevisionBatch(reads.part, action, keys, scope).result.skipped.length) return [];
  const op = action === 'accept' ? ('acceptRevision' as const) : ('rejectRevision' as const);
  const groups = new Map<
    string,
    { revision: ReviewRevisionItem['address']; localName: string; siteNodeIds: string[] }
  >();
  for (const site of collectRevisionSites(reads.part)) {
    if (!own.has(site.node.id)) continue;
    const attribute = (name: string) =>
      site.node.attributes.find(
        (value) => value.namespaceUri === WML_NAMESPACE_URI && value.localName === name
      )?.value;
    const revision = item.addresses.find(
      (address) =>
        address.id === attribute('id') &&
        address.author === (attribute('author') ?? '') &&
        (address.date ?? '') === (attribute('date') ?? '')
    );
    if (!revision) return [];
    const localName = site.node.localName;
    const group = JSON.stringify([revision, localName]);
    const known = groups.get(group);
    if (known) known.siteNodeIds.push(site.node.id);
    else groups.set(group, { revision, localName, siteNodeIds: [site.node.id] });
  }
  return [...groups.values()].map((group) => ({ op, ...group }));
}
