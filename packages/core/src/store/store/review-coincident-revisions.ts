import type { RevisionAddress } from './tree-op-types.ts';
import {
  registerRevisionSiteNodeIds,
  revisionSiteNodeIdsOf,
  type ReviewRange,
  type ReviewRevisionItem,
} from './review-items.ts';

function addressKey(address: RevisionAddress): string {
  return `${address.id}\u0000${address.author}\u0000${address.date ?? ''}`;
}

function rangeKey(range: ReviewRange): string {
  return (
    `${range.partName}\u0000${range.start.paragraphId}:${range.start.offset}` +
    `|${range.end.paragraphId}:${range.end.offset}`
  );
}

function dedupeAddresses(addresses: readonly RevisionAddress[]): RevisionAddress[] {
  const out: RevisionAddress[] = [];
  for (const address of addresses) {
    if (
      out.some(
        (known) =>
          known.id === address.id &&
          known.author === address.author &&
          (known.date ?? '') === (address.date ?? '')
      )
    ) {
      continue;
    }
    out.push(address);
  }
  return out;
}

function hasCharacters(range: ReviewRange): boolean {
  return (
    range.start.paragraphId !== range.end.paragraphId || range.start.offset !== range.end.offset
  );
}

function coincidentKey(item: ReviewRevisionItem): string | null {
  if (
    item.revisionKind !== 'insert' &&
    item.revisionKind !== 'delete' &&
    item.revisionKind !== 'moveFrom' &&
    item.revisionKind !== 'moveTo'
  ) {
    return null;
  }
  if (item.ranges.length === 0 || item.ranges.some((range) => !hasCharacters(range))) return null;
  const ranges = item.ranges.map(rangeKey).sort();
  return `${addressKey(item.address)}\u0000${ranges.join('\u0001')}`;
}

function startKey(item: ReviewRevisionItem): string | null {
  if (item.revisionKind === 'structural' || item.ranges.length === 0) return null;
  const start = item.ranges[0]!.start;
  return `${addressKey(item.address)}\u0000${item.ranges[0]!.partName}\u0000${start.paragraphId}:${start.offset}`;
}

function structuralPointKey(item: ReviewRevisionItem): string | null {
  if (
    item.revisionKind !== 'structural' ||
    item.ranges.length !== 1 ||
    hasCharacters(item.ranges[0]!)
  ) {
    return null;
  }
  const point = item.ranges[0]!.start;
  return `${addressKey(item.address)}\u0000${item.ranges[0]!.partName}\u0000${point.paragraphId}:${point.offset}`;
}

function sameDirection(left: ReviewRevisionItem, right: ReviewRevisionItem): boolean {
  const removed = (kind: ReviewRevisionItem['revisionKind']): boolean =>
    kind === 'delete' || kind === 'moveFrom';
  return removed(left.revisionKind) === removed(right.revisionKind);
}

/**
 * Fold nested wrappers that name one decision and cover the same characters.
 *
 * Word and third-party producers can write two wrapper kinds for one logical change. The
 * shared address makes Accept resolve both, while grouping only by element name used to show
 * two cards for that one action. A shared range is required because revision ids are not unique.
 */
export function mergeCoincidentSameAddressEdits(
  items: readonly ReviewRevisionItem[]
): readonly ReviewRevisionItem[] {
  if (items.length < 2) return items;
  const groups = new Map<string, number[]>();
  const contentByStart = new Map<string, number[]>();
  for (const [index, item] of items.entries()) {
    const key = coincidentKey(item);
    if (key !== null) {
      const group = groups.get(key);
      if (group) group.push(index);
      else groups.set(key, [index]);
    }
    const start = startKey(item);
    if (start !== null) {
      const group = contentByStart.get(start);
      if (group) group.push(index);
      else contentByStart.set(start, [index]);
    }
  }
  // A tracked row's `w:trPr/w:del` and `w:cellDel` markers anchor at the first
  // paragraph's start. Word can stamp the row's text wrapper with the same address. Accept
  // already resolves them together, so attach an unambiguous structural point to that card.
  for (const [index, item] of items.entries()) {
    const point = structuralPointKey(item);
    if (point === null) continue;
    const candidates = contentByStart.get(point) ?? [];
    const keys = new Set(candidates.map((candidate) => coincidentKey(items[candidate]!)));
    keys.delete(null);
    if (keys.size !== 1) continue;
    const key = keys.values().next().value;
    if (key === undefined || key === null) continue;
    const group = groups.get(key)!;
    group.push(index);
  }

  const merged = new Map<number, ReviewRevisionItem>();
  const consumed = new Set<number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const members = group.map((index) => items[index]!);
    const content = members.filter((item) => item.revisionKind !== 'structural');
    if (content.length === 0) continue;
    const firstContent = content[0]!;
    const hasStructural = content.length !== members.length;
    if (content.some((item) => !sameDirection(firstContent, item))) continue;
    if (!hasStructural && new Set(members.map((item) => item.nesting)).size !== members.length) {
      continue;
    }
    // Keep the pairable content kind when a move wrapper duplicates it. The replacement pass
    // that follows only pairs `insert` and `delete`. It also gives a tracked row's text-bearing
    // wrapper precedence over its structural markers.
    const representative =
      content.find((item) => item.revisionKind === 'insert' || item.revisionKind === 'delete') ??
      content.reduce((deepest, item) => (item.nesting > deepest.nesting ? item : deepest));
    const ranges: ReviewRange[] = [];
    const rangeKeys = new Set<string>();
    const siteNodeIds: string[] = [];
    let readOnly = false;
    for (const member of members) {
      readOnly ||= member.readOnly;
      for (const range of member.ranges) {
        const key = rangeKey(range);
        if (rangeKeys.has(key)) continue;
        rangeKeys.add(key);
        ranges.push(range);
      }
      for (const nodeId of revisionSiteNodeIdsOf(member)) siteNodeIds.push(nodeId);
    }
    merged.set(
      group[0]!,
      registerRevisionSiteNodeIds(
        {
          ...representative,
          id: members.map((item) => item.id).join('+'),
          addresses: dedupeAddresses(members.flatMap((item) => item.addresses)),
          ranges,
          readOnly,
        },
        siteNodeIds
      )
    );
    for (const index of group.slice(1)) consumed.add(index);
  }
  if (merged.size === 0) return items;
  return items.flatMap((item, index) => {
    if (consumed.has(index)) return [];
    return [merged.get(index) ?? item];
  });
}
