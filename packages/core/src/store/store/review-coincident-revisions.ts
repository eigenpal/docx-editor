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
  const parents = items.map((_, index) => index);
  const rootOf = (initial: number): number => {
    let index = initial;
    while (parents[index] !== index) index = parents[index]!;
    const root = index;
    index = initial;
    while (parents[index] !== index) {
      const next = parents[index]!;
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const join = (left: number, right: number): void => {
    const leftRoot = rootOf(left);
    const rightRoot = rootOf(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  const firstByAddressRange = new Map<string, number>();
  for (const [index, item] of items.entries()) {
    const address = addressKey(item.address);
    for (const range of item.ranges) {
      const key = `${address}\u0000${rangeKey(range)}`;
      const first = firstByAddressRange.get(key);
      if (first === undefined) firstByAddressRange.set(key, index);
      // Coincident siblings can be separate decisions. Paragraph-mark insertion and deletion
      // can share an address and point, for example. Different nesting proves one wrapper
      // encloses the other, which is the duplicate shape this pass removes.
      else if (items[first]!.nesting !== item.nesting) join(first, index);
    }
  }
  const groups = new Map<number, number[]>();
  for (const index of items.keys()) {
    const root = rootOf(index);
    const group = groups.get(root);
    if (group) group.push(index);
    else groups.set(root, [index]);
  }

  const merged = new Map<number, ReviewRevisionItem>();
  const consumed = new Set<number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const members = group.map((index) => items[index]!);
    const representative = members.reduce((deepest, item) =>
      item.nesting > deepest.nesting ? item : deepest
    );
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
