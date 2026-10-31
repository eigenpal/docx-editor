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
import { firstItem, mapEntry, structAt } from './yjs-items.ts';
import { itemIdentity, type Identity } from './paragraph-text-identity.ts';
import { marksOfText } from './paragraph-text-marks.ts';
import { childArrayOf, PACKAGE_NODES_KEY } from './schema.ts';
import { splitAtIn, splitEntryOf, splitPointsOf, type SplitPoint } from './split-points.ts';

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
  groups: SiblingGroup[] = [],
  /** Collects the characters an order named that this replica has not received yet. */
  missing: string[] = []
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
  const nodes = children.doc?.getMap<unknown>(PACKAGE_NODES_KEY) ?? null;
  // A paragraph a split added at this place, not one a move or an undo listed here again: two
  // moves to one place share both origins too, and they show where their authors put them.
  const splitHere = (item: Y.Item): boolean => item.deleted || listedBySplit(nodes, item);
  for (let start = 0; start < items.length; ) {
    const head = items[start]!;
    const key = originsKey(head);
    if (sharing.get(key)! < 2 || !splitHere(head)) {
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
      if (originsKey(item) === key && splitHere(item)) blocks.push({ head: item, items: [item] });
      else if (current.items.some((member) => inItem(item.origin, member)))
        current.items.push(item);
      else break;
    }
    if (blocks.length < 2) {
      start += 1;
      continue;
    }
    // An undo or redo puts a removed sibling back right before its own removed entry: its
    // left origin is the paragraph the run follows, its right origin is a deleted member of
    // the run, and that member listed a paragraph whose record was already there. It belongs
    // to the run, in a block of its own. A paragraph listed there anew, as a split made later
    // or a break typed at the end of the split paragraph, does not: it shows where its author
    // put it.
    let first = start;
    while (first > 1) {
      const item = items[first - 1]!;
      const removed = blocks
        .flatMap((block) => block.items)
        .find((member) => member.deleted && inItem(item.rightOrigin, member));
      if (!removed || !inItem(item.origin, items[first - 2]!)) break;
      if (!listedAgain(nodes, item, removed)) break;
      blocks.unshift({ head: item, items: [item] });
      first -= 1;
    }
    for (const block of blocks)
      for (const item of block.items) if (!item.deleted) heads.push(headId(item));
    // A paragraph stands for its place in the run only where a split listed it, or where an
    // undo or redo listed it again in its run, as above.
    const relisted = new Set(blocks.slice(0, start - first).map((block) => block.head));
    const keyed = (item: Y.Item): boolean => relisted.has(item) || listedBySplit(nodes, item);
    const idsOf = (list: readonly Block[]): LogicalId[] =>
      list.flatMap((block) =>
        block.items
          .filter((item) => !item.deleted)
          .flatMap((item) => item.content.getContent() as LogicalId[])
      );
    const listed = idsOf(blocks);
    const blockOf = blocks.flatMap((block, index) => idsOf([block]).map(() => index));
    const byText = orderOf(blocks, textOf, children.doc, pointsOf, missing, keyed);
    const order =
      idsByPoints(listed, blockOf, pointsOf, children.doc, missing) ??
      (byText ? idsOf(byText) : null);
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
    const moves = order !== null && order.some((id, at) => listed[at] !== id);
    if (moves) {
      group += 1;
      ranks ??= new Map();
      order.forEach((id, rank) => ranks!.set(id, { group, rank }));
    }
    // A run that moves nothing leaves its blocks as listed, so a run inside one of them, as
    // splits of a paragraph a moved block carries, is read on its own.
    start = moves ? end : start + 1;
  }
  return ranks;
}

/**
 * Whether `item` is the entry a paragraph's split points were written for (`split-points.ts`):
 * the entry a split made when it added the paragraph, or one that took a moved sibling's points.
 * A paragraph listed again by a move, an undo, or a redo names its earlier entry, and a
 * paragraph that names no split point is no split.
 */
function listedBySplit(nodes: Y.Map<unknown> | null, item: Y.Item): boolean {
  const record = nodes?.get(headId(item) as string);
  if (!(record instanceof Y.Map)) return false;
  const entry = splitEntryOf(record as Y.Map<unknown>);
  return entry !== null && inItem(entry, item);
}

/**
 * The paragraphs of one concurrent run in the order of their split points, or null when they
 * do not all name a split of one paragraph. Each paragraph goes by where its own last split
 * fell, so pieces that several peers split off at once, each peer's later pieces split off its
 * earlier ones included, interleave in text order. When those splits do not all stand in one
 * live text, as a split of text typed after the first split, each paragraph goes by its split
 * of that one paragraph; paragraphs with one split point, as
 * a paragraph and the paragraph that took its split points, keep their listed order.
 *
 * Two paragraphs can fall at one place: a break at the end of the paragraph the run follows
 * and a break at the end of a sibling that took that paragraph's last character both fall
 * after that character. Such a tie goes by where each one's block shows, so a paragraph split
 * off a sibling stays with it, and then by the listed order.
 */
function idsByPoints(
  listed: readonly LogicalId[],
  /** The block of the run that lists each paragraph, in listed order. */
  blockOf: readonly number[],
  pointsOf: (id: LogicalId) => readonly SplitPoint[],
  doc: Y.Doc | null,
  missing: string[]
): LogicalId[] | null {
  if (listed.length < 2) return null;
  const points = listed.map((id) => pointsOf(id));
  const places = new Map<Y.Text, Map<string, number>>();
  const sorted = (keys: readonly number[]): LogicalId[] => {
    // Where each block shows: by the key of the first paragraph it lists.
    const heads = new Map<number, number>();
    blockOf.forEach((block, index) => {
      if (!heads.has(block)) heads.set(block, index);
    });
    const blocks = [...heads.keys()].sort(
      (a, b) => keys[heads.get(a)!]! - keys[heads.get(b)!]! || a - b
    );
    const shown = new Map(blocks.map((block, rank) => [block, rank]));
    const order = listed.map((_, index) => index);
    order.sort(
      (a, b) => keys[a]! - keys[b]! || shown.get(blockOf[a]!)! - shown.get(blockOf[b]!)! || a - b
    );
    return order.map((index) => listed[index]!);
  };
  for (let at = points[0]!.length - 1; at >= 0; at -= 1) {
    const source = points[0]![at]!.source;
    const splits = points.map((list) => splitAtIn(list, source));
    if (splits.some((split) => split === null)) continue;
    const waiting = missing.length;
    const own = splitKeys(
      doc,
      points.map((list) => list.at(-1)!.at),
      places,
      missing,
      false
    );
    if (own) return sorted(own);
    if (missing.length > waiting) return null;
    const keys = splitKeys(doc, splits as string[], places, missing);
    return keys ? sorted(keys) : null;
  }
  return null;
}

/**
 * Whether `item` lists again the paragraph `removed` listed, as an undo or redo does, and not
 * a paragraph listed anew. Only the paragraph's record tells, because a collected entry keeps
 * no ID: the record the removed entry's author wrote before that entry is still the record.
 * A new paragraph's record comes with its first entry, after every entry its author saw.
 */
function listedAgain(nodes: Y.Map<unknown> | null, item: Y.Item, removed: Y.Item): boolean {
  if (!nodes || item.deleted) return false;
  const record = mapEntry(nodes, headId(item) as string);
  return (
    record !== undefined &&
    record.id.client === removed.id.client &&
    record.id.clock < removed.id.clock
  );
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
 * What one block shows first: the copies of its first paragraph that is still listed, when a
 * split listed it there. A deleted paragraph has no text to read, so a paragraph split off it
 * stands for it; a block moved after it has copies of its own, which tell nothing of a split.
 * A block whose first listed paragraph no split listed there shows no copies: a paragraph split
 * off that one tells where it goes after it, not where the block goes.
 */
function blockCopies(
  block: Block,
  textOf: (id: LogicalId) => Y.Text | null,
  keyed: (item: Y.Item) => boolean
): Identity[] {
  for (const item of block.items) {
    if (item.deleted) continue;
    if (!keyed(item)) return [];
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
 * any. A paragraph split off a deleted one keeps the deleted one's split point. A block whose
 * first listed paragraph no split listed there has none, as with its copies.
 */
function blockPoints(
  block: Block,
  pointsOf: (id: LogicalId) => readonly SplitPoint[],
  keyed: (item: Y.Item) => boolean
): readonly SplitPoint[] {
  for (const item of block.items) {
    if (item.deleted) continue;
    if (!keyed(item)) return [];
    const points = pointsOf(headId(item));
    if (points.length > 0) return points;
  }
  return [];
}

/**
 * Whether this replica holds the character an identity names, live, deleted, or collected.
 * One it does not hold yet can still arrive and stand in a live text.
 */
export function identityArrived(doc: Y.Doc, identity: string): boolean {
  const [client, clock] = identity.split(':').map(Number);
  return clock! < Y.getState(doc.store, client!);
}

/**
 * Whether the character `first` names comes before the one `second` names, or null when
 * this replica cannot tell alike with every other: both stand in one live text, or one author
 * typed or loaded both, whose clocks go up in text order within one insert. The clocks decide
 * only when this replica holds both characters and they do not stand in one live text, so
 * every replica that holds all updates reads the same answer, whatever their arrival order.
 * A character not received yet goes to `missing`, and the answer is null until it arrives.
 */
function identityBefore(
  doc: Y.Doc | null,
  first: string,
  second: string,
  places: Map<Y.Text, Map<string, number>>,
  missing: string[]
): boolean | null {
  if (first === second) return null;
  const keys = splitKeys(doc, [first, second], places, missing);
  return keys && keys[0] !== keys[1] ? keys[0]! < keys[1]! : null;
}

/**
 * Comparable places for split points (`client:clock`, or `client:clock+` for just after that
 * character), or null when this replica cannot place them alike with every other: all stand
 * in one live text, or one author typed or loaded all of them, whose clocks go up in text order
 * within one insert. The clocks decide only when this replica holds every character and they
 * do not all stand in one live text, so every replica that holds all updates reads the same
 * places, whatever their arrival order. A character not received yet goes to `missing`, and
 * the answer is null until it arrives.
 */
function splitKeys(
  doc: Y.Doc | null,
  points: readonly string[],
  places: Map<Y.Text, Map<string, number>>,
  missing: string[],
  /** Whether one author's clocks may decide when the places are in different texts. */
  byClock = true
): number[] | null {
  if (!doc) return null;
  const parsed = points.map((point) => ({
    identity: point.endsWith('+') ? point.slice(0, -1) : point,
    after: point.endsWith('+') ? 0.5 : 0,
  }));
  const absent = parsed
    .map(({ identity }) => identity)
    .filter((identity) => !identityArrived(doc, identity));
  if (absent.length > 0) {
    missing.push(...absent);
    return null;
  }
  const placed = parsed.map(({ identity }) => sourcePlace(doc, identity, places));
  if (placed.every((place) => place && place.text === placed[0]!.text))
    return placed.map((place, at) => place!.at + parsed[at]!.after);
  if (!byClock) return null;
  const clocks = parsed.map(({ identity }) => identity.split(':').map(Number));
  if (clocks.every(([client]) => client === clocks[0]![0]))
    return clocks.map(([, clock], at) => clock! + parsed[at]!.after);
  return null;
}

/**
 * Whether block `first` goes before block `second` by the split points they recorded: the
 * nearest split of one paragraph both name decides, by where its first moved character stands.
 * Null when they name none in common, the same character, or characters this replica cannot
 * order, as a release without the field leaves them.
 */
function splitBefore(
  doc: Y.Doc | null,
  first: readonly SplitPoint[],
  second: readonly SplitPoint[],
  places: Map<Y.Text, Map<string, number>>,
  missing: string[]
): boolean | null {
  for (let at = first.length - 1; at >= 0; at -= 1) {
    const other = splitAtIn(second, first[at]!.source);
    if (other === null) continue;
    return identityBefore(doc, first[at]!.at, other, places, missing);
  }
  return null;
}

/** The blocks of one concurrent run in the order the rule shows them, or null when unchanged. */
function orderOf(
  run: readonly Block[],
  textOf: (id: LogicalId) => Y.Text | null,
  doc: Y.Doc | null,
  pointsOf: (id: LogicalId) => readonly SplitPoint[],
  missing: string[],
  /** Whether an item's paragraph may stand for its block: a split listed it there. */
  keyed: (item: Y.Item) => boolean
): Block[] | null {
  const points = run.map((block) => blockPoints(block, pointsOf, keyed));
  const copies = run.map((block) => blockCopies(block, textOf, keyed));
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
      // A block whose entries are all removed shows nothing, so nothing orders past it.
      if (run[earlier]!.items.every((item) => item.deleted)) {
        [order[back - 1], order[back]] = [later, earlier];
        continue;
      }
      const recorded = splitBefore(doc, points[later]!, points[earlier]!, places, missing);
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
  /** The split characters the order named that had not arrived. Usually empty. */
  readonly missing: readonly string[];
}

/**
 * The rule's ranks per parent, read once per listing. A replica can list a paragraph before
 * its text or its marks arrive, when an update waits for another one, so a listing that did
 * not change can still need another order: `takeChanged`, which a view calls once per build,
 * reads a run again when one of its paragraphs that held nothing to order by changed length,
 * or when a split character its order named arrived.
 * Every other read, such as each comparison of document order or each keystroke in a run
 * paragraph, uses the stored order.
 */
export class SplitSiblingOrders {
  private readonly built = new WeakMap<readonly LogicalId[], OrderEntry>();
  /** Parents whose last order read a concurrent run. */
  private readonly withRuns = new Set<LogicalId>();
  /** Parents whose child array changed, with the order they showed before. */
  private readonly recheck = new Map<LogicalId, readonly LogicalId[]>();
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
    for (const [parentId, shown] of this.recheck) {
      this.recheck.delete(parentId);
      const next = this.read(parentId)?.shown ?? this.listingOf(parentId);
      if (next && (next.length !== shown.length || next.some((id, at) => shown[at] !== id)))
        changed.push(parentId);
    }
    for (const parentId of [...this.withRuns]) {
      const listing = this.listingOf(parentId);
      const known = listing ? this.built.get(listing) : undefined;
      if (!listing || !known) {
        this.withRuns.delete(parentId);
        continue;
      }
      const doc = this.nodeOf(parentId)?.doc ?? null;
      const arrived = doc !== null && known.missing.some((id) => identityArrived(doc, id));
      const grew = known.waiting.length > 0 && this.lengthsKey(known.waiting) !== known.lengths;
      if (!arrived && !grew) continue;
      const next = this.build(parentId, listing);
      if (!next || next.shown.some((id, at) => known.shown[at] !== id)) changed.push(parentId);
    }
    return changed;
  }

  /**
   * A parent's child array changed. Its listing can keep the same ids, as when a peer moves a
   * block back to the index it had, while the entries that list them, and so the order the rule
   * reads, changed: the stored order goes, and `takeChanged` reports the parent if it moved.
   */
  forget(parentId: LogicalId): void {
    const listing = this.listingOf(parentId);
    const known = listing ? this.built.get(listing) : undefined;
    if (!listing || !known) return;
    this.built.delete(listing);
    if (!this.recheck.has(parentId)) this.recheck.set(parentId, known.shown);
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
    const missing: string[] = [];
    const ranks = splitSiblingRanks(
      children,
      this.textOf,
      heads,
      (id) => splitPointsOf(this.nodeOf(id)),
      groups,
      missing
    );
    const ids = listing ?? children.toArray();
    const order = splitSiblingOrder(ids, ranks);
    const shown = order ? order.map((index) => ids[index]!) : ids;
    const waiting = heads.filter(
      (id) => splitPointsOf(this.nodeOf(id)).length === 0 && copiesOf(id, this.textOf).length === 0
    );
    const entry = { ranks, shown, waiting, lengths: this.lengthsKey(waiting), groups, missing };
    if (groups.length > 0) this.grouped.add(parentId);
    else this.grouped.delete(parentId);
    if (listing) this.built.set(listing, entry);
    if ((waiting.length > 0 || missing.length > 0) && listing) this.withRuns.add(parentId);
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
