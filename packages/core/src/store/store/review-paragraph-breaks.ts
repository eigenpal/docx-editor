// Word reviews adjacent text and paragraph marks as one insertion/deletion, even when
// the file gives each site a separate revision id. Keep every site for atomic resolution.
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import {
  registerRevisionSiteNodeIds,
  revisionSiteNodeIdsOf,
  type ReviewRevisionItem,
  type ReviewRange,
} from './review-items.ts';
import { sameEditingMoment } from './tree-op-tracked-adjacency.ts';

export function mergeParagraphBreakEdits(
  items: readonly ReviewRevisionItem[],
  part: OoxmlPart,
  order: ReadonlyMap<string, number>,
  previewByNode: ReadonlyMap<string, { readonly range: ReviewRange; readonly text: string }>
): readonly ReviewRevisionItem[] {
  if (!items.some((item) => item.revisionKind === 'paragraphMark')) return items;
  // Only sibling paragraphs share a break. Deep document order alone would join edits
  // across table cells, text boxes, or intervening tables.
  const following = new Map<string, string>();
  const visit = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i]!;
      const next = node.children[i + 1];
      if (child.kind === 'paragraph' && next?.kind === 'paragraph')
        following.set(child.id, next.id);
      visit(child, depth + 1);
    }
  };
  visit(part.root, 0);
  const parent = items.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }
    return index;
  };
  const starts = new Map<string, number[]>();
  const ends = new Map<string, number[]>();
  const key = (item: ReviewRevisionItem, paragraph: string, offset: number): string =>
    JSON.stringify([
      item.revisionKind === 'paragraphMark' ? item.markDirection : item.revisionKind,
      item.author,
      item.nesting,
      paragraph,
      offset,
    ]);
  const add = (map: Map<string, number[]>, at: string, index: number): void => {
    const bucket = map.get(at);
    if (bucket) bucket.push(index);
    else map.set(at, [index]);
  };
  items.forEach((item, index) => {
    if (item.readOnly || !['insert', 'delete', 'paragraphMark'].includes(item.revisionKind)) return;
    for (const range of item.ranges) {
      add(starts, key(item, range.start.paragraphId, range.start.offset), index);
      add(ends, key(item, range.end.paragraphId, range.end.offset), index);
    }
  });
  const join = (index: number, others: readonly number[]): void => {
    for (const other of others) {
      const left = items[index]!.date;
      const right = items[other]!.date;
      if (left !== undefined && right !== undefined && !sameEditingMoment(left, right)) continue;
      parent[find(other)] = find(index);
    }
  };
  items.forEach((item, index) => {
    if (
      item.readOnly ||
      item.revisionKind !== 'paragraphMark' ||
      !['insert', 'delete'].includes(item.markDirection ?? '')
    )
      return;
    for (const range of item.ranges) {
      join(index, ends.get(key(item, range.start.paragraphId, range.start.offset)) ?? []);
      const next = following.get(range.end.paragraphId);
      if (next) join(index, starts.get(key(item, next, 0)) ?? []);
    }
  });
  const groups = new Map<number, ReviewRevisionItem[]>();
  items.forEach((item, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(item);
    else groups.set(root, [item]);
  });
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]!;
    const ranges = group
      .flatMap((item) => item.ranges)
      .sort(
        (a, b) =>
          order.get(a.start.paragraphId)! - order.get(b.start.paragraphId)! ||
          a.start.offset - b.start.offset
      );
    const preview = group
      .flatMap((item) => revisionSiteNodeIdsOf(item))
      .flatMap((id) => {
        const segment = previewByNode.get(id);
        return segment ? [segment] : [];
      })
      .sort(
        (a, b) =>
          order.get(a.range.start.paragraphId)! - order.get(b.range.start.paragraphId)! ||
          a.range.start.offset - b.range.start.offset
      );
    const first = group[0]!;
    const content = group.find((item) => item.revisionKind !== 'paragraphMark');
    const addresses = [
      ...new Map(
        group.flatMap((item) => item.addresses).map((address) => [JSON.stringify(address), address])
      ).values(),
    ];
    return registerRevisionSiteNodeIds(
      {
        ...first,
        id: group.map((item) => item.id).join('+'),
        revisionKind: content?.revisionKind ?? 'paragraphMark',
        ...(content ? { markDirection: undefined } : {}),
        addresses,
        ranges,
        text: content ? preview.map((segment) => segment.text).join('') : '',
      },
      group.flatMap((item) => revisionSiteNodeIdsOf(item))
    );
  });
}
