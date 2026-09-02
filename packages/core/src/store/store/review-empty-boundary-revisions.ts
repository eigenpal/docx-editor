import type { RevisionAddress } from './tree-op-types.ts';
import {
  registerRevisionSiteNodeIds,
  revisionSiteNodeIdsOf,
  type ReviewPosition,
  type ReviewRange,
  type ReviewRevisionItem,
} from './review-items.ts';

function sameAddress(left: RevisionAddress, right: RevisionAddress): boolean {
  return (
    left.id === right.id && left.author === right.author && (left.date ?? '') === (right.date ?? '')
  );
}

function hasCharacters(range: ReviewRange): boolean {
  return (
    range.start.paragraphId !== range.end.paragraphId || range.start.offset !== range.end.offset
  );
}

function mergeableKind(item: ReviewRevisionItem): boolean {
  return item.revisionKind === 'insert' || item.revisionKind === 'delete';
}

function boundaryKey(item: ReviewRevisionItem, range: ReviewRange, point: ReviewPosition): string {
  return (
    `${item.revisionKind}\u0000${item.author}\u0000${item.nesting}\u0000${range.partName}\u0000` +
    `${point.paragraphId}\u0000${point.offset}`
  );
}

/**
 * Attach empty content wrappers to the visible edit at the same boundary.
 *
 * Word can track a field separator and field end as empty `w:del` wrappers around one
 * text deletion. Their zero-width ranges collide with the text range's start and end in
 * the adjacency index. Keeping them separate therefore produces two empty Deleted cards.
 */
export function mergeEmptyBoundaryRevisions(
  items: readonly ReviewRevisionItem[]
): readonly ReviewRevisionItem[] {
  const visibleByBoundary = new Map<string, number[]>();
  for (const [index, item] of items.entries()) {
    if (!mergeableKind(item) || item.readOnly || item.ranges.length === 0 || item.text === '') {
      continue;
    }
    const first = item.ranges[0]!;
    const last = item.ranges[item.ranges.length - 1]!;
    for (const [range, point] of [
      [first, first.start],
      [last, last.end],
    ] as const) {
      const key = boundaryKey(item, range, point);
      const candidates = visibleByBoundary.get(key);
      if (candidates && !candidates.includes(index)) candidates.push(index);
      else if (!candidates) visibleByBoundary.set(key, [index]);
    }
  }

  const extrasByTarget = new Map<number, number[]>();
  for (const [index, item] of items.entries()) {
    if (
      !mergeableKind(item) ||
      item.readOnly ||
      item.text !== '' ||
      item.ranges.length !== 1 ||
      hasCharacters(item.ranges[0]!)
    ) {
      continue;
    }
    const candidates = visibleByBoundary.get(
      boundaryKey(item, item.ranges[0]!, item.ranges[0]!.start)
    );
    if (candidates?.length !== 1) continue;
    const extras = extrasByTarget.get(candidates[0]!);
    if (extras) extras.push(index);
    else extrasByTarget.set(candidates[0]!, [index]);
  }
  if (extrasByTarget.size === 0) return items;

  const mergedAt = new Map<number, ReviewRevisionItem>();
  const consumed = new Set<number>();
  for (const [targetIndex, extraIndexes] of extrasByTarget) {
    const memberIndexes = [targetIndex, ...extraIndexes].sort((left, right) => left - right);
    const members = memberIndexes.map((index) => items[index]!);
    const target = items[targetIndex]!;
    const addresses: RevisionAddress[] = [];
    const siteNodeIds: string[] = [];
    for (const member of members) {
      for (const address of member.addresses) {
        if (!addresses.some((known) => sameAddress(known, address))) addresses.push(address);
      }
      for (const nodeId of revisionSiteNodeIdsOf(member)) siteNodeIds.push(nodeId);
    }
    mergedAt.set(
      memberIndexes[0]!,
      registerRevisionSiteNodeIds(
        {
          ...target,
          id: members.map((member) => member.id).join('+'),
          addresses,
        },
        siteNodeIds
      )
    );
    for (const index of memberIndexes.slice(1)) consumed.add(index);
  }

  return items.flatMap((item, index) => {
    if (consumed.has(index)) return [];
    return [mergedAt.get(index) ?? item];
  });
}
