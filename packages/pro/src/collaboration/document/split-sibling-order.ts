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
import { firstItem, structAt } from './yjs-items.ts';
import { itemIdentity, type Identity } from './paragraph-text-identity.ts';
import { marksOfText } from './paragraph-text-marks.ts';
import { childArrayOf } from './schema.ts';
import { splitOffsetIn, splitPointsOf, type SplitPoint } from './split-points.ts';

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

/**
 * One run of concurrent split siblings after the paragraph they split: the run's paragraphs
 * as shown, with the first paragraph of each block in `heads` and every one in `shown`.
 */
export interface SiblingGroup {
  readonly source: LogicalId;
  readonly heads: readonly LogicalId[];
  readonly shown: readonly LogicalId[];
  /** For each paragraph, the one its author listed it right after: the source or a sibling. */
  readonly before: ReadonlyMap<LogicalId, LogicalId>;
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
  /** Collects every paragraph the order of a concurrent run reads, moved or not. */
  heads: LogicalId[] = [],
  /** The split points recorded on a paragraph (`split-points.ts`). */
  pointsOf: (id: LogicalId) => readonly SplitPoint[] = () => [],
  /** Collects every concurrent run that follows a listed paragraph, moved or not. */
  groups: SiblingGroup[] = []
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
    // An undo puts a removed sibling back right before the sibling it was listed before: its
    // left origin is the paragraph the run follows, or a sibling, and its right origin is in
    // the run. It belongs to the run, in a block of its own.
    let first = start;
    while (first > 1) {
      const item = items[first - 1]!;
      const inRun = (id: Y.ID | null) =>
        blocks.some((block) => block.items.some((member) => inItem(id, member)));
      if (!inRun(item.rightOrigin) || !inItem(item.origin, items[first - 2]!)) break;
      blocks.unshift({ head: item, items: [item] });
      first -= 1;
    }
    for (const block of blocks)
      for (const item of block.items) if (!item.deleted) heads.push(headId(item));
    const idsOf = (list: readonly Block[]): LogicalId[] =>
      list.flatMap((block) =>
        block.items
          .filter((item) => !item.deleted)
          .flatMap((item) => item.content.getContent() as LogicalId[])
      );
    const listed = idsOf(blocks);
    const byText = orderOf(blocks, textOf, children.doc, pointsOf);
    const order = idsByPoints(listed, pointsOf) ?? (byText ? idsOf(byText) : null);
    const shown = order ?? listed;
    const source = items[first - 1];
    if (source && !source.deleted && inItem(head.origin, source)) {
      const heads = new Set(
        blocks.filter((block) => !block.head.deleted).map((b) => headId(b.head))
      );
      const sourceId = (source.content.getContent() as LogicalId[])[
        head.origin!.clock - source.id.clock
      ]!;
      const before = new Map<LogicalId, LogicalId>();
      for (const block of blocks) {
        let previous = sourceId;
        for (const id of idsOf([block])) {
          before.set(id, previous);
          previous = id;
        }
      }
      groups.push({ source: sourceId, heads: shown.filter((id) => heads.has(id)), shown, before });
    }
    if (order && order.some((id, at) => listed[at] !== id)) {
      group += 1;
      ranks ??= new Map();
      order.forEach((id, rank) => ranks!.set(id, { group, rank }));
    }
    start = end;
  }
  return ranks;
}

/**
 * The paragraphs of one concurrent run in the order of their split points, or null when they
 * do not all name a split of one paragraph. Each paragraph goes by the offset of that split,
 * so pieces that several peers split off at once interleave in text order; paragraphs with
 * one offset, as a paragraph and the paragraph that took its split points, keep their listed
 * order.
 */
function idsByPoints(
  listed: readonly LogicalId[],
  pointsOf: (id: LogicalId) => readonly SplitPoint[]
): LogicalId[] | null {
  if (listed.length < 2) return null;
  const points = listed.map((id) => pointsOf(id));
  for (let at = points[0]!.length - 1; at >= 0; at -= 1) {
    const source = points[0]![at]!.source;
    const offsets = points.map((list) => splitOffsetIn(list, source));
    if (offsets.some((offset) => offset === null)) continue;
    const order = listed.map((_, index) => index);
    order.sort((a, b) => offsets[a]! - offsets[b]! || a - b);
    return order.map((index) => listed[index]!);
  }
  return null;
}

/** The paragraph a listing item names first. */
function headId(item: Y.Item): LogicalId {
  return (item.content.getContent() as unknown[])[0] as LogicalId;
}

function copiesOf(id: LogicalId, textOf: (id: LogicalId) => Y.Text | null): Identity[] {
  const text = typeof id === 'string' ? textOf(id) : null;
  return text ? copiedIdentities(text) : [];
}

/** Where a character stands: its text, and its place among the text's clocks. */
interface SourcePlace {
  readonly text: Y.Text;
  readonly at: number;
}

/**
 * Where the character an identity names stands in the text that holds it, deleted or not.
 * Every copy of one character resolves to the identity of the character first typed, so the
 * pieces of one split paragraph, however often split again, compare in the order of the text
 * they came from.
 *
 * Null when that text, or a record above it, is deleted, whether or not this replica's Yjs
 * collected it: a replica with garbage collection off still holds the text, one with it on
 * holds only a collected struct, and both then fall back to the pairwise rule alike.
 */
function sourcePlace(
  doc: Y.Doc,
  identity: Identity | undefined,
  places: Map<Y.Text, Map<string, number>>
): SourcePlace | null {
  const match = identity ? /^(\d+):(\d+)$/.exec(identity) : null;
  if (!match) return null;
  const client = Number(match[1]);
  const clock = Number(match[2]);
  const item = structAt(doc, { client, clock });
  const text = item?.parent;
  if (!item || !(text instanceof Y.Text)) return null;
  for (
    let holder = text._item;
    holder;
    holder = holder.parent instanceof Y.AbstractType ? holder.parent._item : null
  )
    if (holder.deleted) return null;
  let starts = places.get(text);
  if (!starts) {
    starts = new Map();
    let at = 0;
    for (let next = firstItem(text); next; next = next.right) {
      starts.set(`${next.id.client}:${next.id.clock}`, at);
      at += next.length;
    }
    places.set(text, starts);
  }
  const start = starts.get(`${item.id.client}:${item.id.clock}`);
  return start === undefined ? null : { text, at: start + clock - item.id.clock };
}

/**
 * What one block shows first: the copies of its first paragraph that is still listed. A
 * deleted paragraph has no text to read, so a paragraph split off it stands for it.
 */
function blockCopies(block: Block, textOf: (id: LogicalId) => Y.Text | null): Identity[] {
  for (const item of block.items) {
    if (item.deleted) continue;
    const copies = copiesOf(headId(item), textOf);
    if (copies.length > 0) return copies;
  }
  return [];
}

/**
 * Whether block `first` goes before block `second`. When both start with a copy of a
 * character of one text, the one whose character comes first does. Otherwise, the pairwise
 * rule: `first` holds the start of `second`, after its own.
 */
function blockBefore(
  first: readonly Identity[],
  second: readonly Identity[],
  firstPlace: SourcePlace | null,
  secondPlace: SourcePlace | null
): boolean {
  if (firstPlace && secondPlace && firstPlace.text === secondPlace.text)
    return firstPlace.at < secondPlace.at;
  return splitEarlier(first, second);
}

/**
 * The split points of one block: those of its first paragraph that is still listed and holds
 * any. A paragraph split off a deleted one keeps the deleted one's split point.
 */
function blockPoints(
  block: Block,
  pointsOf: (id: LogicalId) => readonly SplitPoint[]
): readonly SplitPoint[] {
  for (const item of block.items) {
    if (item.deleted) continue;
    const points = pointsOf(headId(item));
    if (points.length > 0) return points;
  }
  return [];
}

/**
 * Whether block `first` goes before block `second` by the split points they recorded: the
 * nearest split of one paragraph both name decides, the earlier offset first. Null when they
 * name none in common or the same offset, as a release without the field leaves them.
 */
function splitBefore(first: readonly SplitPoint[], second: readonly SplitPoint[]): boolean | null {
  for (let at = first.length - 1; at >= 0; at -= 1) {
    const offset = splitOffsetIn(second, first[at]!.source);
    if (offset === null) continue;
    return first[at]!.offset === offset ? null : first[at]!.offset < offset;
  }
  return null;
}

/** The blocks of one concurrent run in the order the rule shows them, or null when unchanged. */
function orderOf(
  run: readonly Block[],
  textOf: (id: LogicalId) => Y.Text | null,
  doc: Y.Doc | null,
  pointsOf: (id: LogicalId) => readonly SplitPoint[]
): Block[] | null {
  const points = run.map((block) => blockPoints(block, pointsOf));
  const copies = run.map((block) => blockCopies(block, textOf));
  const places = new Map<Y.Text, Map<string, number>>();
  const starts = copies.map((list) => (doc ? sourcePlace(doc, list[0], places) : null));
  // Insertion sort by the rule, from the order Yjs gives: every replica starts from the same
  // order and reads the same copies, so every replica ends in the same order.
  const order = run.map((_, index) => index);
  let moved = false;
  for (let at = 1; at < order.length; at += 1) {
    for (let back = at; back > 0; back -= 1) {
      const later = order[back]!;
      const earlier = order[back - 1]!;
      const recorded = splitBefore(points[later]!, points[earlier]!);
      const before =
        recorded ?? blockBefore(copies[later]!, copies[earlier]!, starts[later]!, starts[earlier]!);
      if (!before) break;
      [order[back - 1], order[back]] = [later, earlier];
      moved = true;
    }
  }
  return moved ? order.map((index) => run[index]!) : null;
}

interface OrderEntry {
  readonly ranks: SiblingRanks;
  readonly shown: readonly LogicalId[];
  /**
   * The paragraphs of the concurrent runs that held neither copies nor split points when the
   * order was read: their text can still be on its way. Usually empty.
   */
  readonly waiting: readonly LogicalId[];
  /** Their text lengths, a cheap sign that one of them changed. */
  readonly lengths: string;
  /** The concurrent runs that follow a listed paragraph. */
  readonly groups: readonly SiblingGroup[];
}

/**
 * The rule's ranks per parent, read once per listing. A replica can list a paragraph before
 * its text or its marks arrive, when an update waits for another one, so a listing that did
 * not change can still need another order: `takeChanged`, which a view calls once per build,
 * reads a run again when one of its paragraphs that held nothing to order by changed length.
 * Every other read, such as each comparison of document order or each keystroke in a run
 * paragraph, uses the stored order.
 */
export class SplitSiblingOrders {
  private readonly built = new WeakMap<readonly LogicalId[], OrderEntry>();
  /** Parents whose last order read a concurrent run. */
  private readonly withRuns = new Set<LogicalId>();
  /** Parents whose last order found a concurrent run after a listed paragraph. */
  private readonly grouped = new Set<LogicalId>();

  constructor(
    /** A node's shared record. */
    private readonly nodeOf: (id: LogicalId) => Y.Map<unknown> | undefined,
    private readonly textOf: (id: LogicalId) => Y.Text | null,
    /** The listing the registry last indexed for a parent; a new array when it changes. */
    private readonly listingOf: (parentId: LogicalId) => readonly LogicalId[] | undefined
  ) {}

  /** The ranks of a parent's children that move, or null. */
  ranksOf(parentId: LogicalId): SiblingRanks {
    return this.read(parentId)?.ranks ?? null;
  }

  /** The concurrent runs of split siblings among a parent's children, moved or not. */
  groupsOf(parentId: LogicalId): readonly SiblingGroup[] {
    return this.read(parentId)?.groups ?? [];
  }

  /** Parents whose last order read a concurrent run. */
  parentsWithRuns(): readonly LogicalId[] {
    for (const parentId of [...this.grouped])
      if (!this.listingOf(parentId)) this.grouped.delete(parentId);
    return [...this.grouped];
  }

  /** A parent's listing in the order the rule shows it. */
  shownChildren(parentId: LogicalId): readonly LogicalId[] | undefined {
    return this.read(parentId)?.shown ?? this.listingOf(parentId);
  }

  /**
   * Parents whose shown order changed since the last call while their listing stayed: a
   * paragraph of a concurrent run got its text or marks. A view rebuilds them, and the order
   * that decides where a moved copy shows changed with them. A parent no longer listed, or
   * whose listing changed, leaves the set until it is read again.
   */
  takeChanged(): LogicalId[] {
    const changed: LogicalId[] = [];
    for (const parentId of [...this.withRuns]) {
      const listing = this.listingOf(parentId);
      const known = listing ? this.built.get(listing) : undefined;
      if (!listing || !known) {
        this.withRuns.delete(parentId);
        continue;
      }
      if (known.waiting.length === 0 || this.lengthsKey(known.waiting) === known.lengths) continue;
      const next = this.build(parentId, listing);
      if (!next || next.shown.some((id, at) => known.shown[at] !== id)) changed.push(parentId);
    }
    return changed;
  }

  private lengthsKey(heads: readonly LogicalId[]): string {
    return heads.map((id) => this.textOf(id)?.length ?? -1).join(',');
  }

  private read(parentId: LogicalId): OrderEntry | null {
    const listing = this.listingOf(parentId);
    return (listing && this.built.get(listing)) || this.build(parentId, listing);
  }

  private build(parentId: LogicalId, listing: readonly LogicalId[] | undefined): OrderEntry | null {
    const children = childArrayOf(this.nodeOf(parentId)) as Y.Array<LogicalId> | null;
    if (!children || children.length < 2) return null;
    const heads: LogicalId[] = [];
    const groups: SiblingGroup[] = [];
    const ranks = splitSiblingRanks(
      children,
      this.textOf,
      heads,
      (id) => splitPointsOf(this.nodeOf(id)),
      groups
    );
    const ids = listing ?? children.toArray();
    const order = splitSiblingOrder(ids, ranks);
    const shown = order ? order.map((index) => ids[index]!) : ids;
    const waiting = heads.filter(
      (id) => splitPointsOf(this.nodeOf(id)).length === 0 && copiesOf(id, this.textOf).length === 0
    );
    const entry = { ranks, shown, waiting, lengths: this.lengthsKey(waiting), groups };
    if (groups.length > 0) this.grouped.add(parentId);
    else this.grouped.delete(parentId);
    if (listing) this.built.set(listing, entry);
    if (waiting.length > 0 && listing) this.withRuns.add(parentId);
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
