/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The order of paragraphs that two peers' splits of one paragraph added at the same place.
 *
 * Each split lists its new paragraph right after the paragraph it splits. When two peers split
 * one paragraph at once, both new paragraphs go in at that one place, and Yjs orders them by
 * client ID, not by where each split fell. The paragraph that holds the later tail can then
 * come first: its text is all of the other's text too, so the earlier tail showed in the
 * later paragraph, and the earlier paragraph showed nothing.
 *
 * Each new paragraph holds moved copies of its tail. When one paragraph holds the first
 * character another paragraph copied, after characters of its own, its split fell earlier, so
 * it comes first. Only paragraphs a parent lists side by side, inserted concurrently at the
 * same place, are reordered, and only by what every replica reads alike: item IDs and order,
 * and the marks that name what each insert copies. The materializer, the projection of local
 * edits, and the document order that decides where a copy shows all use this one rule.
 */
import * as Y from 'yjs';
import type { LogicalId } from './identity.ts';
import { firstItem } from './yjs-items.ts';
import { itemIdentity, type Identity } from './paragraph-text-identity.ts';
import { marksOfText } from './paragraph-text-marks.ts';

/**
 * How many clocks of one paragraph's text the rule reads. It counts clocks, which every
 * replica holds alike whatever each one collected, so a long paragraph is cut at the same
 * place everywhere.
 */
const MAX_COPY_CLOCKS = 4096;

/** Where one listed child stands in a group of concurrent split siblings. */
export interface SiblingRank {
  /** The group: siblings of one group are reordered among themselves only. */
  readonly group: number;
  /** Its place in the group, first is 0. */
  readonly rank: number;
}

/** The ranks of the children of one parent that move, or null when none does. */
export type SiblingRanks = ReadonlyMap<LogicalId, SiblingRank> | null;

/**
 * The identities of the moved copies one paragraph's text holds, deleted or not, in text
 * order. A deleted character keeps its ID and its mark, so a later edit of the text does not
 * change what this returns.
 */
function copiedIdentities(text: Y.Text): Identity[] {
  const marks = marksOfText(text);
  const copied: Identity[] = [];
  let clocks = 0;
  for (let item = firstItem(text); item && clocks < MAX_COPY_CLOCKS; item = item.right) {
    for (let offset = 0; offset < item.length && clocks < MAX_COPY_CLOCKS; offset += 1) {
      clocks += 1;
      // A formatting marker never carries a move mark, live or collected.
      if (!marks.origin('move', item.id.client, item.id.clock + offset)) continue;
      copied.push(itemIdentity(text, item, offset));
    }
  }
  return copied;
}

/** Whether `first` goes before `second`: `first` holds the start of `second`, after its own. */
function splitEarlier(first: readonly Identity[], second: readonly Identity[]): boolean {
  const start = second[0];
  if (start === undefined || first.length === 0) return false;
  return first.indexOf(start) > 0 && second.indexOf(first[0]!) <= 0;
}

function sameId(left: Y.ID | null, right: Y.ID | null): boolean {
  if (left === null || right === null) return left === right;
  return left.client === right.client && left.clock === right.clock;
}

/**
 * The concurrent split siblings of a parent's child array that the rule moves, with their
 * ranks. `textOf` gives a child's paragraph text, or null for a child that is no paragraph.
 */
export function splitSiblingRanks(
  children: Y.Array<LogicalId>,
  textOf: (id: LogicalId) => Y.Text | null
): SiblingRanks {
  let ranks: Map<LogicalId, SiblingRank> | null = null;
  let group = 0;
  // Live items in list order; a run of items with the same two origins went in concurrently.
  const items: Y.Item[] = [];
  for (let item = firstItem(children); item; item = item.right) {
    if (!item.deleted) items.push(item);
  }
  for (let start = 0; start < items.length; ) {
    let end = start + 1;
    while (
      end < items.length &&
      sameId(items[end]!.origin, items[start]!.origin) &&
      sameId(items[end]!.rightOrigin, items[start]!.rightOrigin)
    ) {
      end += 1;
    }
    if (end - start > 1) {
      const order = orderOf(items.slice(start, end), textOf);
      if (order) {
        group += 1;
        ranks ??= new Map();
        let rank = 0;
        for (const item of order) {
          for (const id of item.content.getContent() as LogicalId[]) {
            ranks.set(id, { group, rank });
            rank += 1;
          }
        }
      }
    }
    start = end;
  }
  return ranks;
}

/** The items of one concurrent run in the order the rule shows them, or null when unchanged. */
function orderOf(
  run: readonly Y.Item[],
  textOf: (id: LogicalId) => Y.Text | null
): Y.Item[] | null {
  const copies = run.map((item) => {
    const first = (item.content.getContent() as unknown[])[0];
    const text = typeof first === 'string' ? textOf(first as LogicalId) : null;
    return text ? copiedIdentities(text) : [];
  });
  // Insertion sort by the pairwise rule, from the order Yjs gives: every replica starts from
  // the same order and reads the same copies, so every replica ends in the same order.
  const order = run.map((_, index) => index);
  let moved = false;
  for (let at = 1; at < order.length; at += 1) {
    for (let back = at; back > 0; back -= 1) {
      if (!splitEarlier(copies[order[back]!]!, copies[order[back - 1]!]!)) break;
      [order[back - 1], order[back]] = [order[back]!, order[back - 1]!];
      moved = true;
    }
  }
  return moved ? order.map((index) => run[index]!) : null;
}

/**
 * The rule's ranks per parent, read again only when the parent's listing changes. The texts
 * the rule reads hold the copies a split wrote when it listed its paragraph, in the same
 * transaction, so a listing that did not change keeps its order.
 */
export class SplitSiblingOrders {
  private readonly built = new WeakMap<
    readonly LogicalId[],
    { readonly ranks: SiblingRanks; readonly shown: readonly LogicalId[] }
  >();

  constructor(
    private readonly childArrayOf: (parentId: LogicalId) => Y.Array<LogicalId> | null,
    private readonly textOf: (id: LogicalId) => Y.Text | null,
    /** The listing the registry last indexed for a parent; a new array when it changes. */
    private readonly listingOf: (parentId: LogicalId) => readonly LogicalId[] | undefined
  ) {}

  /** The ranks of a parent's children that move, or null. */
  ranksOf(parentId: LogicalId): SiblingRanks {
    return this.read(parentId)?.ranks ?? null;
  }

  /** A parent's listing in the order the rule shows it. */
  shownChildren(parentId: LogicalId): readonly LogicalId[] | undefined {
    return this.read(parentId)?.shown ?? this.listingOf(parentId);
  }

  private read(parentId: LogicalId) {
    const listing = this.listingOf(parentId);
    const known = listing ? this.built.get(listing) : undefined;
    if (known) return known;
    const children = this.childArrayOf(parentId);
    if (!children || children.length < 2) return null;
    const ranks = splitSiblingRanks(children, this.textOf);
    const ids = listing ?? children.toArray();
    const order = splitSiblingOrder(ids, ranks);
    const entry = { ranks, shown: order ? order.map((index) => ids[index]!) : ids };
    if (listing) this.built.set(listing, entry);
    return entry;
  }
}

/**
 * Indexes of `ids` in the order the rule shows them, or null when nothing moves. Each run of
 * consecutive ids from one group is put in rank order; the list can be a parent's shared
 * children or a projection's working copy of them.
 */
export function splitSiblingOrder(ids: readonly LogicalId[], ranks: SiblingRanks): number[] | null {
  if (!ranks) return null;
  const order = ids.map((_, index) => index);
  let moved = false;
  for (let start = 0; start < ids.length; ) {
    const first = ranks.get(ids[start]!);
    let end = start + 1;
    while (first && end < ids.length && ranks.get(ids[end]!)?.group === first.group) end += 1;
    if (end - start > 1) {
      const segment = order.slice(start, end);
      segment.sort((left, right) => ranks.get(ids[left]!)!.rank - ranks.get(ids[right]!)!.rank);
      for (let at = 0; at < segment.length; at += 1) {
        if (order[start + at] !== segment[at]) moved = true;
        order[start + at] = segment[at]!;
      }
    }
    start = end;
  }
  return moved ? order : null;
}
