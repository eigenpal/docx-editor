// Inline review grouping retains the source sites for independent resolution.
import { normalizeSdtFullDate } from './tree-op-nodes.ts';
import type { RevisionAddress } from './tree-op-types.ts';
import {
  registerRevisionSiteNodeIds,
  revisionSiteNodeIdsOf,
  type ReviewPosition,
  type ReviewRange,
  type ReviewRevisionItem,
} from './review-items.ts';

/** Compare explicit-zone instants without losing sub-millisecond precision. */
function momentKey(date: string | undefined): string {
  if (date === undefined) return 'undated';
  // Unzoned or malformed source values must not depend on the participant's timezone.
  const normalized =
    date.length <= 64 && /(Z|[+-]\d{2}:\d{2})$/.test(date.trim())
      ? normalizeSdtFullDate(date)
      : null;
  if (normalized === null) return `literal:${date}`;
  const instant = Date.parse(normalized);
  if (Number.isNaN(instant)) return `literal:${date}`;
  const fraction = /\.(\d+)/.exec(normalized)?.[1] ?? '';
  const remainder = fraction.slice(3).replace(/0+$/, '');
  return `instant:${instant}:${remainder}`;
}

/** A combined fragment can represent several editing times. */
function replacementMoment(item: ReviewRevisionItem): string | null {
  const moment = momentKey(item.date);
  return item.addresses.every((address) => momentKey(address.date) === moment) ? moment : null;
}

/**
 * Adjacent deletion and insertion fragments form one replacement only when their
 * author, nesting, and editing time agree. Source IDs can differ across fragments.
 * Every source address and site remains attached for atomic resolution.
 */
export function pairReplacements(
  allItems: readonly ReviewRevisionItem[],
  order: ReadonlyMap<string, number>
): ReviewRevisionItem[] {
  const items = mergeAdjacentSameKindEdits(allItems, order, true);
  // Not `ranges.length === 1`. One tracked edit becomes SEVERAL `w:del` elements whenever the
  // struck text crosses something that is not text — an endnote or footnote reference, a
  // field, a break — because those cannot go inside the same wrapper. Requiring a single range
  // meant striking across an endnote mark and typing over it showed a Deleted card and an
  // Inserted card instead of one Replaced, on an edit the user made in one gesture.
  const pairable = items.filter(
    (item) =>
      (item.revisionKind === 'insert' || item.revisionKind === 'delete') &&
      !item.readOnly &&
      item.ranges.length > 0
  );
  const taken = new Set<string>();
  const replacements = new Map<string, ReviewRevisionItem>();

  // Insertions indexed by where their FIRST range starts. Pairing is exact end-to-start
  // position equality — DELETION FIRST, same paragraph only. The cross-paragraph case is
  // gone deliberately: it checked that the insertion's paragraph followed the deletion's,
  // never that the deletion sat at the END of its own, so routine mid-paragraph edits
  // folded into one card. Order matters too: this engine only ever writes
  // delete-then-insert, so an insertion FOLLOWED by a deletion is a foreign file where
  // pairing them would be an invention. The index makes the lookup exact rather than a
  // scan of every insertion per deletion, which was quadratic in a heavily edited document.
  const insertionsByStart = new Map<string, ReviewRevisionItem[]>();
  for (const insertion of pairable) {
    if (insertion.revisionKind !== 'insert') continue;
    const start = insertion.ranges[0]!.start;
    const key = `${start.paragraphId}\u0000${start.offset}`;
    const bucket = insertionsByStart.get(key);
    if (bucket) bucket.push(insertion);
    else insertionsByStart.set(key, [insertion]);
  }

  for (const deletion of pairable) {
    if (deletion.revisionKind !== 'delete' || taken.has(deletion.id)) continue;
    // The deletion's LAST range end: the end that actually meets the insertion's first
    // start when the halves span more than one range each.
    const end = deletion.ranges[deletion.ranges.length - 1]!.end;
    const bucket = insertionsByStart.get(`${end.paragraphId}\u0000${end.offset}`) ?? [];
    // A ZERO-WIDTH insertion is not the replacement, even when it starts exactly here.
    // Several legal shapes cover no characters: an empty run carrying only run properties,
    // a comment reference, a bookmark pair. Taking the first candidate in the bucket paired
    // the deletion with one of those, so the card read Replaced-old-with-nothing while the
    // real insertion beside it was orphaned into an Inserted card of its own. Text-bearing
    // candidates go first; order within each group is preserved.
    const candidates =
      bucket.length > 1
        ? [...bucket].sort((a, b) => (a.text.length > 0 ? 0 : 1) - (b.text.length > 0 ? 0 : 1))
        : bucket;
    for (const insertion of candidates) {
      if (taken.has(insertion.id) || !coversCharacters(insertion)) continue;
      // Author and adjacency do not identify one editing operation.
      const moment = replacementMoment(deletion);
      if (
        insertion.author !== deletion.author ||
        insertion.nesting !== deletion.nesting ||
        moment === null ||
        replacementMoment(insertion) !== moment
      )
        continue;
      taken.add(deletion.id);
      taken.add(insertion.id);
      // Anchored at whichever half comes FIRST, so the card sits where the edit starts.
      const first = before(deletion.ranges[0]!, insertion.ranges[0]!, order) ? deletion : insertion;
      const date = insertion.date;
      replacements.set(
        deletion.id,
        registerRevisionSiteNodeIds(
          {
            ...first,
            id: `replace-${deletion.id}-${insertion.id}`,
            revisionKind: 'replace',
            ...(date === undefined ? {} : { date }),
            // DEDUPED: a replacement this engine wrote before it numbered the halves
            // separately (#691) shares one identity across both, and applying the same
            // `acceptRevision` twice in one transaction refuses the second — which refused the
            // whole thing and left the replacement unresolved.
            addresses: dedupeAddresses([...deletion.addresses, ...insertion.addresses]),
            text: insertion.text,
            replacedText: deletion.text,
            ranges: [...deletion.ranges, ...insertion.ranges],
            // Struck half first, so the split point is simply how many the deletion contributed.
            replacedRangeCount: deletion.ranges.length,
            readOnly: deletion.readOnly || insertion.readOnly,
          },
          [...revisionSiteNodeIdsOf(deletion), ...revisionSiteNodeIdsOf(insertion)]
        )
      );
      break;
    }
  }

  // Restore unpaired source items before broad same-kind grouping. Time-separated
  // zero-width field fragments can overlap and cannot be folded a second time.
  const replacementBySite = new Map<string, ReviewRevisionItem>();
  for (const replacement of replacements.values()) {
    for (const site of revisionSiteNodeIdsOf(replacement)) {
      replacementBySite.set(site, replacement);
    }
  }
  const out: ReviewRevisionItem[] = [];
  const emitted = new Set<string>();
  for (const item of allItems) {
    const replacement = revisionSiteNodeIdsOf(item)
      .map((site) => replacementBySite.get(site))
      .find((candidate) => candidate !== undefined);
    if (!replacement) out.push(item);
    else if (!emitted.has(replacement.id)) {
      out.push(replacement);
      emitted.add(replacement.id);
    }
  }
  return out;
}

/**
 * Fold chains of ADJACENT items of one kind by one author into single cards.
 *
 * A word struck in several gestures — or re-struck around something a `w:del` cannot
 * contain — lands in the file as several sibling elements under distinct ids. They are one
 * decision to the reviewer. Adjacency uses the same exact
 * end-to-start test the replacement pairing uses, so an untracked character between two
 * deletions keeps them apart.
 *
 * ZERO-WIDTH members are why this is a sweep rather than a lookup keyed by start position.
 * Tracking the removal of a field wraps each `w:fldChar` and each `w:instrText` run in a
 * `w:del` of its own, so a struck form field arrives as several revisions that cover no
 * characters and share one offset with the struck text beside them. They are not separate
 * decisions. A map from start position to item can hold
 * only one of them, which stranded every other one as a blank `Deleted` card. A member
 * covering no characters therefore joins the chain WITHOUT moving its frontier: the
 * revision it sits against still begins where the wrapper does.
 */
export function mergeAdjacentSameKindEdits(
  items: readonly ReviewRevisionItem[],
  order: ReadonlyMap<string, number>,
  separateMoments = false
): readonly ReviewRevisionItem[] {
  const mergeable = items.filter(
    (item) =>
      (item.revisionKind === 'insert' || item.revisionKind === 'delete') &&
      !item.readOnly &&
      item.ranges.length > 0
  );
  if (mergeable.length < 2) return items;

  const keyOf = (position: ReviewPosition): string =>
    `${position.paragraphId}\u0000${position.offset}`;
  // A chain never crosses kinds or authors, so each pair sweeps on its own. The sweep needs
  // each bucket in document order, and `mergeable` almost always already is: the site walk
  // that built the items runs in document order. It is only ALMOST, because an item is
  // positioned by its first LOCATED site, and a site inside a drawing or a text box has no
  // location at all — so a group that starts in one carries a later range than its place in
  // the list claims. Checking costs one pass and sorting is skipped whenever it holds.
  const buckets = new Map<string, ReviewRevisionItem[]>();
  for (const item of mergeable) {
    const moment = separateMoments ? replacementMoment(item) : '';
    const key = JSON.stringify([item.revisionKind, item.author, item.nesting, moment ?? item.id]);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  // Position as a PAIR, not the packed rank the queue itself sorts by: that one folds the
  // offset into a fixed stride and clamps it, so every offset past the clamp in one
  // paragraph scores the same — and a bucket ordered by it would report itself sorted in
  // exactly the paragraph long enough to reach it. Coincident members compare EQUAL, and the
  // sort is stable, so wrappers sharing one offset keep the order the file wrote them in;
  // the sort fixes where a decision SITS, never how two at one offset are stacked. `order`
  // is total over the paragraphs a located site can name, so the fallback below asserts that
  // rather than guarding it: it would rank an unmapped paragraph FIRST, not last.
  const compare = (a: ReviewRevisionItem, b: ReviewRevisionItem): number => {
    const first = a.ranges[0]!.start;
    const second = b.ranges[0]!.start;
    const paragraph = (order.get(first.paragraphId) ?? 0) - (order.get(second.paragraphId) ?? 0);
    return paragraph !== 0 ? paragraph : first.offset - second.offset;
  };
  for (const bucket of buckets.values()) {
    let sorted = true;
    for (let index = 1; index < bucket.length && sorted; index += 1) {
      sorted = compare(bucket[index - 1]!, bucket[index]!) <= 0;
    }
    if (!sorted) bucket.sort(compare);
  }

  const consumed = new Set<string>();
  const merged = new Map<string, ReviewRevisionItem>();
  for (const bucket of buckets.values()) {
    let chain: ReviewRevisionItem[] = [];
    let frontier = '';
    const close = (): void => {
      if (chain.length > 1) {
        merged.set(chain[0]!.id, foldChain(chain));
        for (let index = 1; index < chain.length; index += 1) consumed.add(chain[index]!.id);
      }
      chain = [];
    };
    for (const item of bucket) {
      const start = keyOf(item.ranges[0]!.start);
      if (chain.length > 0 && start !== frontier) close();
      const opening = chain.length === 0;
      chain.push(item);
      // Covering no characters leaves the frontier where it is, so the next member is still
      // measured against the text this wrapper sits in front of. An opening member sets the
      // frontier either way: there is nothing yet for it to sit in front of.
      if (opening || coversCharacters(item)) {
        frontier = keyOf(item.ranges[item.ranges.length - 1]!.end);
      }
    }
    close();
  }
  if (merged.size === 0) return items;

  const out: ReviewRevisionItem[] = [];
  for (const item of items) {
    if (consumed.has(item.id)) continue;
    out.push(merged.get(item.id) ?? item);
  }
  return out;
}

/**
 * Whether a revision covers any text at all.
 *
 * Asked per RANGE rather than of the whole span, because a group's outermost start and end
 * can differ while every range in it is a point: the wrappers a tracked field is made of are
 * empty, and a group that reuses one id across two paragraphs holds two of them.
 */
function coversCharacters(item: ReviewRevisionItem): boolean {
  return item.ranges.some(
    (range) =>
      range.start.paragraphId !== range.end.paragraphId || range.start.offset !== range.end.offset
  );
}

/** One card from a chain of adjacent same-kind halves, in document order. */
function foldChain(chain: readonly ReviewRevisionItem[]): ReviewRevisionItem {
  const first = chain[0]!;
  const addresses = [...first.addresses];
  const ranges = [...first.ranges];
  const siteNodeIds = [...revisionSiteNodeIdsOf(first)];
  let text = first.text;
  let date = first.date;
  for (const next of chain.slice(1)) {
    for (const address of next.addresses) {
      if (!addresses.some((known) => sameAddress(known, address))) addresses.push(address);
    }
    for (const range of next.ranges) ranges.push(range);
    for (const nodeId of revisionSiteNodeIdsOf(next)) siteNodeIds.push(nodeId);
    text += next.text;
    date = laterStamp(date, next.date);
  }
  return registerRevisionSiteNodeIds(
    {
      ...first,
      id: chain.map((item) => item.id).join('+'),
      addresses,
      ranges,
      text,
      ...(date === undefined ? {} : { date }),
    },
    siteNodeIds
  );
}

/** The later of two stamps; the first one when they cannot be compared. */
function laterStamp(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const first = Date.parse(a);
  const second = Date.parse(b);
  if (Number.isNaN(first) || Number.isNaN(second)) return a;
  return second > first ? b : a;
}

/** Every address once, keeping first-seen order. */
function dedupeAddresses(addresses: readonly RevisionAddress[]): RevisionAddress[] {
  const out: RevisionAddress[] = [];
  for (const address of addresses) {
    if (!out.some((known) => sameAddress(known, address))) out.push(address);
  }
  return out;
}

/** Two addresses naming one revision. */
function sameAddress(a: RevisionAddress, b: RevisionAddress): boolean {
  return a.id === b.id && a.author === b.author && (a.date ?? '') === (b.date ?? '');
}

/** Document order of two ranges' starts. */
function before(a: ReviewRange, b: ReviewRange, order: ReadonlyMap<string, number>): boolean {
  const first = order.get(a.start.paragraphId) ?? 0;
  const second = order.get(b.start.paragraphId) ?? 0;
  if (first !== second) return first < second;
  return a.start.offset <= b.start.offset;
}
