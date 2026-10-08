// Query-time narrowing of the review queue: revision-kind exclusion and opt-in replacement
// pairing for `getReviewItems(query)`.
//
// A pair is a READ-SIDE decision. The store keeps the deletion and the insertion as two
// revisions; a pair item lists both halves' addresses and canonical sites, so resolving it
// issues the same accept/reject ops a host would issue for the halves, in one transaction.

import type { ReviewItemPlacement, ReviewItemQuery } from '../contracts/editor.ts';
import {
  registerRevisionSiteNodeIds,
  reviewItemKey,
  revisionSiteNodeIdsOf,
  type ReviewItem,
  type ReviewRevisionItem,
} from '../store/store/review-items.ts';

/** Store revision ids start with their kind and a dash, so this prefix cannot collide. */
const PAIR_ID_PREFIX = 'replace:';
const PAIR_KEY_PREFIX = `revision-${PAIR_ID_PREFIX}`;

/** The two store revisions one paired replacement stands for. */
export interface ReplacementHalves {
  readonly deletion: ReviewRevisionItem;
  readonly insertion: ReviewRevisionItem;
}

const halvesOf = new WeakMap<object, ReplacementHalves>();

/** The halves of a paired replacement, or null for every other item. */
export function replacementPairHalves(item: ReviewItem | undefined): ReplacementHalves | null {
  return item ? (halvesOf.get(item) ?? null) : null;
}

/** The item followed by its halves when it is a pair, for checks that must hold for all. */
export function reviewItemWithHalves(item: ReviewItem): readonly ReviewItem[] {
  const halves = halvesOf.get(item);
  return halves ? [item, halves.deletion, halves.insertion] : [item];
}

/** The deletion ends exactly where the insertion starts, in the same paragraph. */
function touches(deletion: ReviewRevisionItem, insertion: ReviewRevisionItem): boolean {
  const end = deletion.ranges[deletion.ranges.length - 1];
  const start = insertion.ranges[0];
  return (
    end !== undefined &&
    start !== undefined &&
    end.partName === start.partName &&
    end.end.paragraphId === start.start.paragraphId &&
    end.end.offset === start.start.offset
  );
}

function pairable(deletion: ReviewRevisionItem, insertion: ReviewRevisionItem): boolean {
  return (
    deletion.revisionKind === 'delete' &&
    insertion.revisionKind === 'insert' &&
    deletion.author === insertion.author &&
    deletion.readOnly === insertion.readOnly &&
    deletion.nesting === insertion.nesting &&
    touches(deletion, insertion)
  );
}

/** Pairs by deletion, so one queue revision yields the same pair object on every read. */
const pairCache = new WeakMap<ReviewRevisionItem, ReviewRevisionItem>();

function pairOf(deletion: ReviewRevisionItem, insertion: ReviewRevisionItem): ReviewRevisionItem {
  const cached = pairCache.get(deletion);
  if (cached && halvesOf.get(cached)?.insertion === insertion) return cached;
  const date = insertion.date ?? deletion.date;
  const pair: ReviewRevisionItem = {
    kind: 'revision',
    id: `${PAIR_ID_PREFIX}${deletion.id}+${insertion.id}`,
    address: deletion.address,
    addresses: [...deletion.addresses, ...insertion.addresses],
    replacedText: deletion.text,
    revisionKind: 'replace',
    author: insertion.author,
    ...(date !== undefined ? { date } : {}),
    text: insertion.text,
    ranges: [...deletion.ranges, ...insertion.ranges],
    nesting: deletion.nesting,
    replacedRangeCount: deletion.ranges.length,
    readOnly: deletion.readOnly || insertion.readOnly,
    replyIds: [...deletion.replyIds, ...insertion.replyIds],
  };
  halvesOf.set(pair, { deletion, insertion });
  pairCache.set(deletion, pair);
  return registerRevisionSiteNodeIds(pair, [
    ...revisionSiteNodeIdsOf(deletion),
    ...revisionSiteNodeIdsOf(insertion),
  ]);
}

/**
 * Replace each deletion that is followed, among the queue's revisions, by a touching
 * insertion from the same author with one `replace` item at the deletion's position.
 */
function pairReplacements(items: readonly ReviewItem[]): {
  readonly items: readonly ReviewItem[];
  readonly renamed: ReadonlyMap<string, string>;
} {
  const revisions = items.filter((item): item is ReviewRevisionItem => item.kind === 'revision');
  const pairs = new Map<ReviewItem, ReviewRevisionItem>();
  const absorbed = new Set<ReviewItem>();
  const renamed = new Map<string, string>();
  for (let index = 0; index + 1 < revisions.length; index += 1) {
    const deletion = revisions[index]!;
    const insertion = revisions[index + 1]!;
    if (!pairable(deletion, insertion)) continue;
    const pair = pairOf(deletion, insertion);
    pairs.set(deletion, pair);
    absorbed.add(insertion);
    renamed.set(deletion.id, pair.id);
    renamed.set(insertion.id, pair.id);
    index += 1;
  }
  if (pairs.size === 0) return { items, renamed };
  const next: ReviewItem[] = [];
  for (const item of items) {
    if (absorbed.has(item)) continue;
    next.push(pairs.get(item) ?? item);
  }
  return { items: next, renamed };
}

/**
 * Apply a query's revision-kind exclusion and replacement pairing to the queue.
 *
 * Excluded kinds leave first, so an excluded deletion or insertion never pairs. Pairs then
 * honor an exclusion of `'replace'`. A comment answering a half answers its pair, and a
 * comment answering a change the query dropped becomes a top-level card again.
 */
export function narrowReviewItems(
  items: readonly ReviewItem[],
  query: ReviewItemQuery | undefined
): readonly ReviewItem[] {
  const excluded = new Set(query?.excludeRevisionKinds ?? []);
  const keep = (item: ReviewItem): boolean =>
    item.kind !== 'revision' || !excluded.has(item.revisionKind);
  let next = excluded.size > 0 ? items.filter(keep) : items;
  let renamed: ReadonlyMap<string, string> = new Map();
  if (query?.pairReplacements === true) {
    const paired = pairReplacements(next);
    renamed = paired.renamed;
    next = excluded.size > 0 ? paired.items.filter(keep) : paired.items;
  }
  if (excluded.size === 0 && renamed.size === 0) return next;
  // A comment that answers a change this QUERY dropped is a top-level card again. The link is
  // only a reason to render the comment inside the change's card, so publishing it beside a
  // change the caller cannot see makes the comment unrenderable: the rail skips it as a reply
  // and no card claims it. The rail hides `format` and `structural` by default, and a tracked
  // formatting change anchors on exactly the run it decorates, so this is the ordinary case.
  const present = new Set(next.filter((item) => item.kind === 'revision').map((item) => item.id));
  return next.map((item) => {
    if (item.kind !== 'comment' || item.parentRevisionId === undefined) return item;
    const parent = renamed.get(item.parentRevisionId) ?? item.parentRevisionId;
    if (present.has(parent)) {
      return parent === item.parentRevisionId ? item : { ...item, parentRevisionId: parent };
    }
    const { parentRevisionId: _dropped, ...rest } = item;
    return rest;
  });
}

/** True for a key only a paired query produces. */
export function isReplacementPairKey(key: string): boolean {
  return key.startsWith(PAIR_KEY_PREFIX);
}

/**
 * The placement a key names, for key-addressed verbs that need the item and not its geometry.
 * A paired key only exists in a paired read, so it is looked up there directly, whatever
 * query produced it. One read per call, without the layout pass.
 */
export function findReviewPlacement(
  placements: (query?: ReviewItemQuery) => readonly ReviewItemPlacement[],
  key: string
): ReviewItemPlacement | undefined {
  const query: ReviewItemQuery = isReplacementPairKey(key)
    ? { placement: false, pairReplacements: true }
    : { placement: false };
  return placements(query).find((entry) => entry.key === key);
}

/** The store keys a resolution must cover: the halves of a pair, else the item itself. */
export function resolutionKeysOf(item: ReviewItem): readonly string[] {
  const halves = halvesOf.get(item);
  return halves
    ? [reviewItemKey(halves.deletion), reviewItemKey(halves.insertion)]
    : [reviewItemKey(item)];
}

/**
 * The key `query` reads for the review item whose store key is `key`: under
 * `pairReplacements`, the pair a deletion or insertion belongs to; otherwise `key` itself.
 */
export function keyUnderQuery(
  placements: (query?: ReviewItemQuery) => readonly ReviewItemPlacement[],
  key: string | null,
  query: ReviewItemQuery | undefined
): string | null {
  if (key === null || query?.pairReplacements !== true) return key;
  const pair = placements({ ...query, placement: false }).find(
    (entry) =>
      isReplacementPairKey(entry.key) && resolutionKeysOf(entry.item as ReviewItem).includes(key)
  );
  return pair?.key ?? key;
}
