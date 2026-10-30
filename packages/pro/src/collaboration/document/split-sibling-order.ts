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
 * and the marks that name what each insert copies. Each paragraph moves with the items listed
 * after it later from its own place, such as a paragraph split off it, and the projection of a
 * local edit lists a new paragraph beside such a sibling right after the one shown before it.
 * The materializer, the projection of local edits, and the document order that decides where
 * a copy shows all use this one rule.
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

/** Whether `id` names an element of `item`. */
function inItem(id: Y.ID | null, item: Y.Item): boolean {
  return (
    id !== null &&
    id.client === item.id.client &&
    id.clock >= item.id.clock &&
    id.clock < item.id.clock + item.length
  );
}

/**
 * One concurrent split sibling and the items listed after it later, whose left origin is in
 * it: a paragraph split off it, or inserted after it, goes with it, so it shows right after
 * it wherever the rule puts it. Deleted items count, so a follower of a deleted paragraph
 * keeps that paragraph's place.
 */
interface Block {
  readonly head: Y.Item;
  readonly items: Y.Item[];
}

const idKey = (id: Y.ID | null): string => (id ? `${id.client}:${id.clock}` : '-');
const originsKey = (item: Y.Item): string => `${idKey(item.origin)} ${idKey(item.rightOrigin)}`;

/**
 * The concurrent split siblings of a parent's child array that the rule moves, with their
 * ranks. `textOf` gives a child's paragraph text, or null for a child that is no paragraph.
 */
export function splitSiblingRanks(
  children: Y.Array<LogicalId>,
  textOf: (id: LogicalId) => Y.Text | null,
  /** Collects the paragraph of each block of every concurrent run, moved or not. */
  heads: LogicalId[] = []
): SiblingRanks {
  let ranks: Map<LogicalId, SiblingRank> | null = null;
  let group = 0;
  const items: Y.Item[] = [];
  // Items that went in at one place at once have the same two origins. Only such items start
  // a group, so a listing without concurrent inserts is read once.
  const sharing = new Map<string, number>();
  for (let item = firstItem(children); item; item = item.right) {
    items.push(item);
    const key = originsKey(item);
    sharing.set(key, (sharing.get(key) ?? 0) + 1);
  }
  for (let start = 0; start < items.length; ) {
    const head = items[start]!;
    const key = originsKey(head);
    if (sharing.get(key)! < 2) {
      start += 1;
      continue;
    }
    // Blocks in list order: each item with the head's origins starts one, and an item whose
    // left origin is in the current block follows it.
    const blocks: Block[] = [{ head, items: [head] }];
    let end = start + 1;
    for (; end < items.length; end += 1) {
      const item = items[end]!;
      const current = blocks.at(-1)!;
      if (originsKey(item) === key) blocks.push({ head: item, items: [item] });
      else if (current.items.some((member) => inItem(item.origin, member)))
        current.items.push(item);
      else break;
    }
    if (blocks.length < 2) {
      start += 1;
      continue;
    }
    for (const block of blocks) heads.push(headId(block.head));
    const order = orderOf(blocks, textOf);
    if (order) {
      group += 1;
      ranks ??= new Map();
      let rank = 0;
      for (const block of order) {
        for (const item of block.items) {
          if (item.deleted) continue;
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

/** The paragraph a listing item names first. */
function headId(item: Y.Item): LogicalId {
  return (item.content.getContent() as unknown[])[0] as LogicalId;
}

function copiesOf(id: LogicalId, textOf: (id: LogicalId) => Y.Text | null): Identity[] {
  const text = typeof id === 'string' ? textOf(id) : null;
  return text ? copiedIdentities(text) : [];
}

/** The blocks of one concurrent run in the order the rule shows them, or null when unchanged. */
function orderOf(run: readonly Block[], textOf: (id: LogicalId) => Y.Text | null): Block[] | null {
  const copies = run.map(({ head }) => copiesOf(headId(head), textOf));
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

interface OrderEntry {
  readonly ranks: SiblingRanks;
  readonly shown: readonly LogicalId[];
  /** The paragraphs of the concurrent runs the order read, and the copies they held. */
  readonly heads: readonly LogicalId[];
  readonly copies: string;
}

/**
 * The rule's ranks per parent, read again when the parent's listing changes, or when a
 * paragraph of a concurrent run holds other copies than the order read. A replica can list a
 * paragraph before its text or its marks arrive, when an update waits for another one, so a
 * listing that did not change can still need another order. A listing without concurrent
 * inserts has no paragraph to read again.
 */
export class SplitSiblingOrders {
  private readonly built = new WeakMap<readonly LogicalId[], OrderEntry>();
  /** Parents whose last order read a concurrent run. */
  private readonly withRuns = new Set<LogicalId>();

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

  /**
   * Parents whose shown order changed since the last call while their listing stayed: a
   * paragraph of a concurrent run got its text or marks. A view rebuilds them, and the order
   * that decides where a moved copy shows changed with them.
   */
  takeChanged(): LogicalId[] {
    const changed: LogicalId[] = [];
    for (const parentId of [...this.withRuns]) {
      const listing = this.listingOf(parentId);
      const known = listing ? this.built.get(listing) : undefined;
      if (!known || this.copiesKey(known.heads) === known.copies) continue;
      const next = this.read(parentId);
      if (!next || next.shown.some((id, at) => known.shown[at] !== id)) changed.push(parentId);
    }
    return changed;
  }

  private copiesKey(heads: readonly LogicalId[]): string {
    return heads.map((id) => copiesOf(id, this.textOf).join(',')).join(';');
  }

  private read(parentId: LogicalId): OrderEntry | null {
    const listing = this.listingOf(parentId);
    const known = listing ? this.built.get(listing) : undefined;
    if (known && (known.heads.length === 0 || this.copiesKey(known.heads) === known.copies))
      return known;
    const children = this.childArrayOf(parentId);
    if (!children || children.length < 2) return null;
    const heads: LogicalId[] = [];
    const ranks = splitSiblingRanks(children, this.textOf, heads);
    const ids = listing ?? children.toArray();
    const order = splitSiblingOrder(ids, ranks);
    const shown = order ? order.map((index) => ids[index]!) : ids;
    const entry = { ranks, shown, heads, copies: this.copiesKey(heads) };
    if (listing) this.built.set(listing, entry);
    if (heads.length > 0) this.withRuns.add(parentId);
    else this.withRuns.delete(parentId);
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
