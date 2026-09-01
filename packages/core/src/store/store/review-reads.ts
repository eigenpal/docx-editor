// The review queue: every pending decision in the document, derived from the TREE.
//
// Deliberately not from laid-out spans. Layout is a VIEW — the proposed-result mode drops every
// deletion and the original mode drops every insertion — so a queue derived from spans empties
// by half the moment a reader switches view, and the changes that vanished become unreachable
// from the surface that is supposed to resolve them. The queue is a property of the document.
//
// SO IT IS DERIVED IN THE STORE LANE, where every lane can reach it. The review rail asks this
// question to draw cards, and an automation host asks it to answer "what comments does this
// document hold" to a script; a lane that could not import the derivation would have written a
// second one, and two derivations of a reviewer's queue disagree eventually — a comment listed
// on screen and missing from the object model, or a change the pane offers to accept and the
// script cannot find. Layout re-exports what is here and adds only GEOMETRY: where a card sits
// beside the page, which is the one thing the tree cannot answer.

import { WML_NAMESPACE_URI } from '../package/ooxml-tree.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { hardBreakText } from '../package/hard-break.ts';
import { isInstrText } from '../package/field-nodes.ts';
import { collectRevisionSites } from './tree-op-revisions.ts';
import type { RevisionAddress } from './tree-op-types.ts';
import {
  commentAnchorsOfStory,
  commentsOfPart,
  threadStateOfPart,
  type CommentRecord,
  type CommentThreadState,
} from './comment-reads.ts';
import { locateSites } from './review-site-locations.ts';
import { createRecentRootCache } from './recent-root-cache.ts';
// The vocabulary this derivation speaks — the item shapes and their pure helpers — lives in
// `review-items.ts`, where the binding and layout lanes can reach it too.
import {
  reviewItemPositionRank,
  type ReviewCommentItem,
  type ReviewItem,
  type ReviewModelInput,
  type ReviewPosition,
  type ReviewRange,
  type ReviewRevisionItem,
  type ReviewRevisionKind,
} from './review-items.ts';

export { locateSites } from './review-site-locations.ts';

/** `EG_ParaRPrTrackChanges` by element name: the four decisions a paragraph mark can carry. */
const MARK_DIRECTIONS: Readonly<Record<string, 'insert' | 'delete' | 'moveFrom' | 'moveTo'>> = {
  ins: 'insert',
  del: 'delete',
  moveFrom: 'moveFrom',
  moveTo: 'moveTo',
};

/** Plain text of a comment's body, so a card never re-implements the run walk. */
export function commentBodyText(comment: CommentRecord): string {
  const parts: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') {
      parts.push(node.value);
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const block of comment.blocks) visit(block);
  return parts.join('');
}

/** Author initials for an avatar, from `@w:initials` or the name. */
export function commentInitials(comment: CommentRecord): string {
  if (comment.initials && comment.initials.trim().length > 0) return comment.initials.trim();
  const words = comment.author.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

function wmlAttribute(node: OoxmlElement, localName: string): string | undefined {
  for (const attribute of node.attributes) {
    if (attribute.localName === localName && attribute.namespaceUri === WML_NAMESPACE_URI) {
      return attribute.value;
    }
  }
  return undefined;
}

/** Text under a node, counting `w:t` and `w:delText` alike. */
function textUnder(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  // A tab or a break carries no text value, so a card derived from a tracked one read as
  // EMPTY — the reviewer was asked to accept content they were never shown, and a tab
  // replacing a word presented as a pure deletion. Project the same characters the offset
  // model counts for them.
  if (node.kind === 'tab') return '\t';
  if (node.kind === 'hardBreak') return hardBreakText(node);
  // A field's instruction is CODE, not content: it measures nothing in the offset model,
  // and a tracked page field would otherwise present its ` PAGE ` source as inserted
  // words. `isInstrText` covers all three spellings — the typed kind, the parse-demoted
  // generic, and `w:delInstrText`, which a struck field's card would otherwise read out.
  if (isInstrText(node)) return '';
  let text = '';
  for (const child of node.children) text += textUnder(child);
  return text;
}

function addressKey(address: RevisionAddress): string {
  return `${address.id}\u0000${address.author}\u0000${address.date ?? ''}`;
}

const CONTENT_KINDS: Readonly<Record<string, ReviewRevisionKind>> = {
  revisionInsert: 'insert',
  revisionDelete: 'delete',
  revisionMoveFrom: 'moveFrom',
  revisionMoveTo: 'moveTo',
};

/** @internal */
export interface ReviewDerivationDependencies {
  readonly retainRevisionItems: boolean;
  readonly revisionSites: typeof collectRevisionSites;
  readonly locations: typeof locateSites;
  readonly commentAnchors: typeof commentAnchorsOfStory;
  readonly deepOrder: (part: OoxmlPart) => ReadonlyMap<string, number>;
}

/**
 * Every revision in one story, one card per DECISION.
 *
 * Sites sharing an `(id, author, date)` triple are ONE revision — a tracked row insertion is
 * `w:trPr/w:ins` plus `w:cellIns` on every cell — so they coalesce into one card listing every
 * range it touches. Keying per site would show the reviewer four decisions where there is one,
 * and accepting any of them would make the other three vanish.
 *
 * Memoized per part root like the indexes it reads, and for the same reason: a heavily
 * tracked document produces tens of thousands of cards, and rebuilding them per read cost
 * more than everything the memos above saved. The paragraph-scoped view the local review
 * patch derives (`revisionItemsOfParagraph`'s synthetic paragraph-root part) is NOT cached:
 * each keystroke would insert a fresh root and churn the bounded ring. The instance is
 * SHARED, so the return type is readonly.
 */
export function revisionItemsOf(part: OoxmlPart): readonly ReviewRevisionItem[] {
  return revisionItemsOfWith(part, interactiveReviewDerivation);
}

function revisionItemsOfWith(
  part: OoxmlPart,
  dependencies: ReviewDerivationDependencies
): readonly ReviewRevisionItem[] {
  const cacheable = part.root.kind !== 'paragraph';
  if (cacheable && dependencies.retainRevisionItems) {
    const cached = revisionItemsCache.get(part.root);
    // The name rides along because the items embed it (`ranges[*].partName`): a root is
    // the cache key, and serving one part's items to another part that shares the root
    // under a different name would stamp every range with the wrong part.
    if (cached && cached.name === part.name) return cached.items;
  }
  const items = computeRevisionItemsOf(part, dependencies);
  if (cacheable && dependencies.retainRevisionItems) {
    revisionItemsCache.set(part.root, { name: part.name, items });
  }
  return items;
}

/** Revision cards per part root, bounded like the site index above. */
const revisionItemsCache = createRecentRootCache<{
  readonly name: string;
  readonly items: readonly ReviewRevisionItem[];
}>(8);

function computeRevisionItemsOf(
  part: OoxmlPart,
  dependencies: ReviewDerivationDependencies
): ReviewRevisionItem[] {
  // Sites FIRST, and the site index only when there is at least one. `locateSites` merges
  // an O(document) index per fresh root, and a structural keystroke on an untracked
  // document paid that merge for a list this function was about to answer "empty" over.
  // The site walk itself is per-subtree memoized, so it is the cheap half.
  const sites = dependencies.revisionSites(part);
  if (sites.length === 0) return [];
  const located = dependencies.locations(part);
  const byAddress = new Map<
    string,
    {
      address: RevisionAddress;
      revisionKind: ReviewRevisionKind;
      markDirection?: 'insert' | 'delete' | 'moveFrom' | 'moveTo';
      author: string;
      date?: string;
      text: string;
      /** Kept apart from `text`: a replacement needs both halves to word its card. */
      deletedText: string;
      ranges: ReviewRange[];
      readOnly: boolean;
      /** The DEEPEST site in the group: the reading a caret in this text gets. */
      nesting: number;
    }
  >();

  for (const site of sites) {
    const id = wmlAttribute(site.node, 'id');
    if (id === undefined) continue;
    // `@w:author` is REQUIRED by `CT_TrackChange`, and files from other generators omit it
    // anyway. Skipping those made the revision invisible in the pane AND invisible to
    // Accept All, which then reported success over a document that still held tracked
    // markup. It is listed instead, read-only, because there is no author to resolve it as.
    const author = wmlAttribute(site.node, 'author') ?? '';
    const authorless = wmlAttribute(site.node, 'author') === undefined;
    const date = wmlAttribute(site.node, 'date');
    const address: RevisionAddress = date === undefined ? { id, author } : { id, author, date };

    const kind: ReviewRevisionKind = site.propertyChange
      ? 'format'
      : site.paragraphMark
        ? 'paragraphMark'
        : (CONTENT_KINDS[site.node.kind] ?? 'structural');
    // The element name IS the decision for a mark, and it is the only place the direction
    // survives: `w:pPr/w:rPr` holds the revision as a bare element, not as a wrapper kind.
    const markDirection = site.paragraphMark ? MARK_DIRECTIONS[site.node.localName] : undefined;

    const where = located.get(site.node.id);
    const range: ReviewRange | null = where
      ? {
          partName: part.name,
          start: { paragraphId: where.paragraphId, offset: where.start },
          end: { paragraphId: where.paragraphId, offset: where.end },
        }
      : null;

    // Keyed on the ELEMENT too. `@w:id` has no uniqueness constraint and Word writes one
    // date per editing burst, so an insertion and a deletion can legally share the triple —
    // and grouping on it alone showed them as one `insert` card with both texts run together,
    // whose Accept deleted the half the card claimed to be inserting.
    const key =
      kind === 'structural'
        ? `structural\u0000${addressKey(address)}`
        : `${site.node.localName}\u0000${addressKey(address)}`;
    const existing = byAddress.get(key);
    if (existing) {
      if (
        range &&
        !existing.ranges.some(
          (candidate) =>
            candidate.partName === range.partName &&
            candidate.start.paragraphId === range.start.paragraphId &&
            candidate.start.offset === range.start.offset &&
            candidate.end.paragraphId === range.end.paragraphId &&
            candidate.end.offset === range.end.offset
        )
      ) {
        existing.ranges.push(range);
      }
      if (kind !== 'structural' && existing.revisionKind === 'structural') {
        existing.revisionKind = kind;
      }
      // An address holding BOTH an insertion and a deletion is one edit that replaced text:
      // this engine writes a replacement that way on purpose, so the halves cannot drift
      // apart and one Accept resolves them together.
      if (
        (kind === 'insert' && existing.revisionKind === 'delete') ||
        (kind === 'delete' && existing.revisionKind === 'insert') ||
        existing.revisionKind === 'replace'
      ) {
        existing.revisionKind = 'replace';
      }
      // ANY refused site refuses the whole decision, matching `resolveRevisions`: resolving
      // only the sites the engine understands would leave a row half-tracked.
      existing.readOnly ||= site.refused || authorless;
      // The deepest site speaks for the decision. A group's sites can sit at different
      // depths, and the shallowest would make an enclosed change look unenclosed.
      if (site.nesting > existing.nesting) existing.nesting = site.nesting;
      if (kind === 'delete' || kind === 'moveFrom') existing.deletedText += textUnder(site.node);
      else if (kind !== 'format' && kind !== 'paragraphMark') existing.text += textUnder(site.node);
      continue;
    }
    byAddress.set(key, {
      address,
      revisionKind: kind,
      ...(markDirection ? { markDirection } : {}),
      author,
      ...(date === undefined ? {} : { date }),
      text:
        kind === 'format' || kind === 'paragraphMark' || kind === 'delete' || kind === 'moveFrom'
          ? ''
          : textUnder(site.node),
      deletedText: kind === 'delete' || kind === 'moveFrom' ? textUnder(site.node) : '',
      ranges: range ? [range] : [],
      nesting: site.nesting,
      // A format or paragraph-mark change is resolvable; the structural kinds are not, and
      // nor is one with no author to address it by.
      readOnly: site.refused || authorless,
    });
  }

  const items = [...byAddress.values()].map(
    (entry): ReviewRevisionItem => ({
      kind: 'revision' as const,
      // The PART is in the id, because `@w:id` is unique only within one. A body `w:ins`
      // and a header `w:ins` numbered 1 by the same author on the same date produced one
      // id for two decisions: the rail's `byId` map kept whichever came last, so one card
      // was unreachable, its replies were attached to the other, and React saw two
      // children under one key.
      id: `${entry.revisionKind}-${part.name}\u0000${addressKey(entry.address)}`,
      address: entry.address,
      addresses: [entry.address],
      revisionKind: entry.revisionKind,
      ...(entry.markDirection ? { markDirection: entry.markDirection } : {}),
      author: entry.author,
      ...(entry.date === undefined ? {} : { date: entry.date }),
      // A pure deletion shows the words it removes as its text; a replacement shows what
      // takes their place, with the removed half beside it.
      text: entry.revisionKind === 'replace' ? entry.text : entry.text || entry.deletedText,
      replacedText: entry.revisionKind === 'replace' ? entry.deletedText : '',
      ranges: entry.ranges,
      nesting: entry.nesting,
      readOnly: entry.readOnly,
      // Filled by `collectReviewItems`, which is the only place that sees the comments too.
      replyIds: [],
    })
  );
  return pairReplacements(items, dependencies.deepOrder(part));
}

/**
 * Fold an adjacent deletion and insertion by one author into a single replacement.
 *
 * Typing over a selection is ONE edit, and Word shows it as one `Replaced "x" with "y"`
 * card. Whether the file records it as one revision or two is the writer's choice — Word
 * mints separate ids for the halves — so the pairing is done on ADJACENCY here rather than
 * on identity, which is the only thing that works for a file this engine did not write.
 *
 * The same argument folds runs of one KIND first: a word struck in three gestures is three
 * `w:del` elements under three ids, and listing `Deleted "Le"`, `Deleted "gor"`, `Deleted
 * "a"` reads one edit as three. Adjacent same-kind, same-author items merge into one card
 * before the halves pair, so the pair is whole-word against whole-word.
 *
 * Every address rides along, so accept and reject resolve the pair in one transaction.
 * Resolving half a replacement is never what the reviewer meant.
 */
function pairReplacements(
  allItems: readonly ReviewRevisionItem[],
  order: ReadonlyMap<string, number>
): ReviewRevisionItem[] {
  const items = mergeAdjacentSameKindEdits(allItems);
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
      if (taken.has(insertion.id)) continue;
      // Same AUTHOR is the whole predicate, deliberately. A time window used to sit here
      // too, but Word itself pairs on adjacency alone: a reviewer who strikes text one day
      // and types its replacement the next still sees one `Replaced` card in Word, and the
      // halves of a foreign file routinely carry timestamps hours or days apart. Splitting
      // those into a Deleted and an Inserted card misread one edit as two.
      if (insertion.author !== deletion.author) continue;
      taken.add(deletion.id);
      taken.add(insertion.id);
      // Anchored at whichever half comes FIRST, so the card sits where the edit starts.
      const first = before(deletion.ranges[0]!, insertion.ranges[0]!, order) ? deletion : insertion;
      // The card is dated when the replacement was COMPLETED: the later half's stamp.
      const date = replacementDate(deletion.date, insertion.date);
      replacements.set(deletion.id, {
        ...first,
        id: `replace-${deletion.id}-${insertion.id}`,
        revisionKind: 'replace',
        ...(date === undefined ? {} : { date }),
        // DEDUPED: when this engine wrote the replacement both halves share one identity,
        // and applying the same `acceptRevision` twice in one transaction refuses the second
        // — which refused the whole thing and left the replacement unresolved.
        addresses: dedupeAddresses([...deletion.addresses, ...insertion.addresses]),
        text: insertion.text,
        replacedText: deletion.text,
        ranges: [...deletion.ranges, ...insertion.ranges],
        // Struck half first, so the split point is simply how many the deletion contributed.
        replacedRangeCount: deletion.ranges.length,
        readOnly: deletion.readOnly || insertion.readOnly,
      });
      break;
    }
  }

  const out: ReviewRevisionItem[] = [];
  for (const item of items) {
    const replacement = replacements.get(item.id);
    if (replacement) {
      out.push(replacement);
      continue;
    }
    if (!taken.has(item.id)) out.push(item);
  }
  return out;
}

/**
 * Fold chains of ADJACENT items of one kind by one author into single cards.
 *
 * A word struck in several gestures — or re-struck around something a `w:del` cannot
 * contain — lands in the file as several sibling elements under distinct ids. They are one
 * decision to the reviewer, and Word shows them as one. Adjacency is the same exact
 * end-to-start test the replacement pairing uses, so an untracked character between two
 * deletions keeps them apart.
 */
function mergeAdjacentSameKindEdits(
  items: readonly ReviewRevisionItem[]
): readonly ReviewRevisionItem[] {
  const mergeable = items.filter(
    (item) =>
      (item.revisionKind === 'insert' || item.revisionKind === 'delete') &&
      !item.readOnly &&
      item.ranges.length > 0
  );
  if (mergeable.length < 2) return items;

  const keyOf = (item: ReviewRevisionItem, position: ReviewPosition): string =>
    `${item.revisionKind}\u0000${item.author}\u0000${position.paragraphId}\u0000${position.offset}`;
  const byStart = new Map<string, ReviewRevisionItem>();
  const endKeys = new Set<string>();
  for (const item of mergeable) {
    byStart.set(keyOf(item, item.ranges[0]!.start), item);
    endKeys.add(keyOf(item, item.ranges[item.ranges.length - 1]!.end));
  }

  const consumed = new Set<string>();
  const merged = new Map<string, ReviewRevisionItem>();
  for (const head of mergeable) {
    if (consumed.has(head.id)) continue;
    // A chain is walked from its HEAD only — an item whose start some sibling's end meets
    // is a tail, and walking it early would split the chain in two.
    if (endKeys.has(keyOf(head, head.ranges[0]!.start))) continue;
    const chain = [head];
    let current = head;
    for (;;) {
      const next = byStart.get(keyOf(current, current.ranges[current.ranges.length - 1]!.end));
      if (!next || next === current || consumed.has(next.id)) break;
      consumed.add(next.id);
      chain.push(next);
      current = next;
    }
    if (chain.length > 1) merged.set(head.id, foldChain(chain));
  }
  if (merged.size === 0) return items;

  const out: ReviewRevisionItem[] = [];
  for (const item of items) {
    if (consumed.has(item.id)) continue;
    out.push(merged.get(item.id) ?? item);
  }
  return out;
}

/** One card from a chain of adjacent same-kind halves, in document order. */
function foldChain(chain: readonly ReviewRevisionItem[]): ReviewRevisionItem {
  const first = chain[0]!;
  const addresses = [...first.addresses];
  const ranges = [...first.ranges];
  let text = first.text;
  let date = first.date;
  for (const next of chain.slice(1)) {
    for (const address of next.addresses) {
      if (!addresses.some((known) => sameAddress(known, address))) addresses.push(address);
    }
    for (const range of next.ranges) ranges.push(range);
    text += next.text;
    date = laterStamp(date, next.date);
  }
  return {
    ...first,
    id: chain.map((item) => item.id).join('+'),
    addresses,
    ranges,
    text,
    ...(date === undefined ? {} : { date }),
  };
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

/**
 * When the replacement was completed: the later of the two halves' stamps. Preference goes
 * to the insertion whenever the stamps cannot be compared — the inserted text is the half
 * the reviewer reads as "the edit", and typing it is the gesture that finished the change.
 */
function replacementDate(
  deletion: string | undefined,
  insertion: string | undefined
): string | undefined {
  if (insertion === undefined) return deletion;
  if (deletion === undefined) return insertion;
  const struck = Date.parse(deletion);
  const typed = Date.parse(insertion);
  if (Number.isNaN(struck) || Number.isNaN(typed)) return insertion;
  return struck > typed ? deletion : insertion;
}

/** Document order of two ranges' starts. */
function before(a: ReviewRange, b: ReviewRange, order: ReadonlyMap<string, number>): boolean {
  const first = order.get(a.start.paragraphId) ?? 0;
  const second = order.get(b.start.paragraphId) ?? 0;
  if (first !== second) return first < second;
  return a.start.offset <= b.start.offset;
}

/**
 * Comment cards, threaded however the file says so and flat when nothing says so.
 *
 * ECMA-376 §17.13.4.2 gives `CT_Comment` no parent pointer, so threading is never something
 * the standard states outright. Three sources, strongest first: `@w15:paraIdParent`, then
 * `@w16cid:parentId` — both in namespaces outside Part 1 — and finally a COINCIDENT anchor, a
 * comment whose `w:commentRangeStart`/`End` cover exactly the characters an earlier comment's
 * cover. The ranges are Part 1's own vocabulary and the only part of a thread that survives a
 * producer dropping the extension parts. Coincidence is the last resort and never overrides a
 * stated link.
 *
 * Deliberately not containment. A remark on one word inside another remark's sentence nests
 * without being a reply, and reading that as a thread would bury an independent comment inside
 * someone else's.
 */
export function commentItemsOf(
  comments: readonly CommentRecord[],
  anchors: readonly {
    commentId: string;
    partName: string;
    start: ReviewPosition;
    end: ReviewPosition;
    orphaned: boolean;
  }[],
  threadState: ReadonlyMap<string, CommentThreadState>
): ReviewCommentItem[] {
  const anchorById = new Map(anchors.map((anchor) => [anchor.commentId, anchor]));
  const byParaId = new Map<string, CommentRecord>();
  const byId = new Map<string, CommentRecord>();
  for (const comment of comments) {
    if (comment.paraId) byParaId.set(comment.paraId.toUpperCase(), comment);
    byId.set(comment.id, comment);
  }

  // First comment authored on each exact span, in `comments.xml` order — a later comment on
  // that same span replies to it. Orphans are excluded: an unusable range is not a match.
  const firstOnSpan = new Map<string, string>();
  const coincidentParent = new Map<string, string>();
  for (const comment of comments) {
    const anchor = anchorById.get(comment.id);
    if (!anchor || anchor.orphaned) continue;
    // A ZERO-WIDTH range is evidence of nothing. Two comments that both cover no characters
    // sit at the same offset for any number of reasons — adjacent markers, a range the
    // producer wrote empty — and reading that as a thread put two unrelated authors in one
    // card. Only a range with characters in it can say "these two remarks are about the same
    // words".
    if (
      anchor.start.paragraphId === anchor.end.paragraphId &&
      anchor.start.offset === anchor.end.offset
    ) {
      continue;
    }
    const span =
      `${anchor.start.paragraphId}:${anchor.start.offset}` +
      `|${anchor.end.paragraphId}:${anchor.end.offset}`;
    if (!firstOnSpan.has(span)) firstOnSpan.set(span, comment.id);
    else coincidentParent.set(comment.id, firstOnSpan.get(span)!);
  }

  const parentOf = new Map<string, string>();
  for (const comment of comments) {
    const state = comment.paraId ? threadState.get(comment.paraId.toUpperCase()) : undefined;
    const stated = state?.parentParaId ? byParaId.get(state.parentParaId) : undefined;
    // A parent id pointing at a comment the file never defined is dropped, not carried: it
    // would produce a reply nested under a card that will never be rendered.
    const named = comment.parentCommentId ? byId.get(comment.parentCommentId) : undefined;
    // A `w15:commentEx` record for this comment settles the question either way: a record with
    // no `@paraIdParent` says top-level, and coincidence must not argue with it. Files exist
    // that carry a record per comment purely to hold `@w15:done` on a flat list.
    const shared = state === undefined ? coincidentParent.get(comment.id) : undefined;
    const inferred = shared ? byId.get(shared) : undefined;
    const parent = stated ?? named ?? inferred;
    if (parent && parent.id !== comment.id) parentOf.set(comment.id, parent.id);
  }
  // A file can still describe a cycle (A replies to B, B replies to A). Breaking it here keeps
  // the rail's "top-level cards only" filter from hiding every card in the loop.
  for (const child of [...parentOf.keys()]) {
    const seen = new Set<string>([child]);
    let walk = parentOf.get(child);
    while (walk !== undefined) {
      if (seen.has(walk)) {
        parentOf.delete(child);
        break;
      }
      seen.add(walk);
      walk = parentOf.get(walk);
    }
  }
  const repliesOf = new Map<string, string[]>();
  for (const [child, parent] of parentOf) {
    const bucket = repliesOf.get(parent);
    if (bucket) bucket.push(child);
    else repliesOf.set(parent, [child]);
  }

  return comments.map((comment) => {
    const anchor = anchorById.get(comment.id);
    const state = comment.paraId ? threadState.get(comment.paraId.toUpperCase()) : undefined;
    const parentId = parentOf.get(comment.id);
    return {
      kind: 'comment' as const,
      id: comment.id,
      comment,
      range: anchor ? { partName: anchor.partName, start: anchor.start, end: anchor.end } : null,
      resolved: state?.done ?? false,
      ...(parentId === undefined ? {} : { parentId }),
      replyIds: repliesOf.get(comment.id) ?? [],
      orphaned: anchor === undefined || anchor.orphaned,
    };
  });
}

/**
 * Everything the review surface lists, in document order.
 *
 * Order is by paragraph position within the story, then by offset. A comment and the revision
 * it covers therefore arrive together, which is what lets a surface group them. Furniture
 * stories rank after the body in one merged order — their geometry (the page they first paint
 * on) is a layout question the queue deliberately does not answer.
 */
export function collectReviewItems(input: ReviewModelInput): ReviewItem[] {
  return collectReviewItemsWith(input, interactiveReviewDerivation);
}

/** @internal */
export function collectReviewItemsWith(
  input: ReviewModelInput,
  dependencies: ReviewDerivationDependencies
): ReviewItem[] {
  // The body part deduped against the furniture list, so a caller passing a part twice —
  // or the same shared header under two sections — cannot double every card in it.
  const parts: OoxmlPart[] = [input.storyPart];
  const seen = new Set<string>([input.storyPart.name]);
  for (const part of input.furnitureParts ?? []) {
    if (seen.has(part.name)) continue;
    seen.add(part.name);
    parts.push(part);
  }

  const comments = input.commentsPart ? commentsOfPart(input.commentsPart) : [];
  const threadState = input.commentsExtendedPart
    ? threadStateOfPart(input.commentsExtendedPart)
    : new Map<string, CommentThreadState>();

  // ONE anchor set across every story, then ONE pass over `comments.xml`. Collecting
  // per-story and concatenating listed each comment once per story — anchored in one,
  // orphaned in all the others.
  const revisions: ReviewRevisionItem[] = [];
  const anchors: ReturnType<typeof commentAnchorsOfStory> = [];
  // With one story there is nothing to merge: the memoized per-part order IS the order,
  // and copying it entry-by-entry was a measurable slice of every full derivation.
  const order: ReadonlyMap<string, number> =
    parts.length === 1 ? dependencies.deepOrder(parts[0]!) : new Map<string, number>();
  for (const part of parts) {
    // Loops, not `push(...spread)`: a heavily tracked part yields tens of thousands of
    // items, and spreading them as call arguments overflows the engine's argument limit.
    for (const item of revisionItemsOfWith(part, dependencies)) revisions.push(item);
    for (const anchor of dependencies.commentAnchors(part)) anchors.push(anchor);
    if (parts.length === 1) continue;
    const merged = order as Map<string, number>;
    const base = merged.size;
    for (const [id, position] of dependencies.deepOrder(part)) {
      if (!merged.has(id)) merged.set(id, base + position);
    }
  }

  const items: ReviewItem[] = linkRevisionReplies([
    ...revisions,
    ...commentItemsOf(comments, anchors, threadState),
  ]);
  return items.sort((a, b) => reviewItemPositionRank(a, order) - reviewItemPositionRank(b, order));
}

/**
 * The shape {@link linkRevisionReplies} needs, stated STRUCTURALLY.
 *
 * The store's queue is revisions and comments; the layout lane's adds a third kind for custom
 * nodes, and neither union is assignable to the other. Both lanes have to run this pass — the
 * store on the full derivation, the session on the locally patched list — so the pass is
 * written against the fields it actually reads rather than against either union, and hands
 * back the caller's own item type.
 */
export interface LinkableReviewItem {
  readonly kind: string;
  readonly id: string;
  readonly ranges?: readonly ReviewRange[];
  readonly range?: ReviewRange | null;
  readonly parentId?: string;
  readonly parentRevisionId?: string;
  readonly replyIds?: readonly string[];
  readonly orphaned?: boolean;
  /** How deeply a revision is nested; absent on the kinds that cannot nest. */
  readonly nesting?: number;
}

/** A range as a comparable key, so "exactly these characters" is one lookup. */
function rangeKey(range: ReviewRange): string {
  return (
    `${range.partName}\u0000${range.start.paragraphId}:${range.start.offset}` +
    `|${range.end.paragraphId}:${range.end.offset}`
  );
}

/**
 * Attach each comment that answers a tracked change to the change it answers.
 *
 * The evidence is the RANGE, exactly as it is for a coincident comment thread: replying to a
 * revision writes a comment over that revision's own characters, because OOXML gives `w:ins`
 * and `w:del` nowhere else to put the text. Without this the reply came back as an independent
 * card in the rail, sitting beside the change rather than inside it, and the reader had no way
 * to see which change their answer belonged to.
 *
 * Three things keep it from over-claiming. A ZERO-WIDTH range is evidence of nothing — the same
 * rule the comment threading uses, and a format or paragraph-mark revision decorates no
 * characters at all. A comment already stated to be a REPLY to another comment is not claimed
 * directly, because a stated link always beats an inferred one. And the FIRST revision on a span
 * wins, so a card cannot claim a reply another card already holds.
 *
 * The WHOLE conversation moves, not its head. A change's card renders `replyIds` as a flat list,
 * so linking only the top comment of a thread left every answer to that answer rendered by
 * nobody: reply twice to one change and the second reply existed in `comments.xml` and appeared
 * nowhere on screen. Descendants ride along, in the order they were authored.
 *
 * IDEMPOTENT, and that is load-bearing. The session re-runs this over a list whose comments are
 * ALREADY linked, so a pass that only ever added links left a stale `parentRevisionId` behind
 * when a keystroke shifted the revision's offsets out from under it — the rail filters such a
 * comment out of its roots, and with no revision claiming it any more the card vanished until
 * the next full re-derivation. Every link is rebuilt from the ranges on every pass.
 */
export function linkRevisionReplies<T extends LinkableReviewItem>(items: readonly T[]): T[] {
  const revisionBySpan = new Map<string, { readonly id: string; readonly nesting: number }>();
  for (const item of items) {
    if (item.kind !== 'revision') continue;
    for (const range of item.ranges ?? []) {
      if (
        range.start.paragraphId === range.end.paragraphId &&
        range.start.offset === range.end.offset
      ) {
        continue;
      }
      const key = rangeKey(range);
      const nesting = item.nesting ?? 0;
      const held = revisionBySpan.get(key);
      // DEEPEST wins, not first seen. Two changes can share one exact span — `w:ins` wrapping
      // `w:del` — and the reply has to hang on the same card a click on those characters opens,
      // which is the innermost one. First-seen picked the wrapper, so the card the reader was
      // answering and the card their answer appeared under were different cards.
      if (held === undefined || nesting > held.nesting) {
        revisionBySpan.set(key, { id: item.id, nesting });
      }
    }
  }

  // Comment threads as the derivation stated them, so a claimed head brings its answers.
  const commentRepliesOf = new Map<string, readonly string[]>();
  for (const item of items) {
    if (item.kind === 'comment' && item.replyIds && item.replyIds.length > 0) {
      commentRepliesOf.set(item.id, item.replyIds);
    }
  }
  const descendantsOf = (rootId: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>([rootId]);
    const queue = [...(commentRepliesOf.get(rootId) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      queue.push(...(commentRepliesOf.get(next) ?? []));
    }
    return out;
  };

  const repliesOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const item of items) {
    if (item.kind !== 'comment' || item.parentId !== undefined) continue;
    if (item.orphaned || !item.range) continue;
    const revisionId = revisionBySpan.get(rangeKey(item.range))?.id;
    if (revisionId === undefined) continue;
    const thread = [item.id, ...descendantsOf(item.id)];
    for (const id of thread) parentOf.set(id, revisionId);
    const bucket = repliesOf.get(revisionId);
    if (bucket) bucket.push(...thread);
    else repliesOf.set(revisionId, thread);
  }

  return items.map((item) => {
    if (item.kind === 'revision') {
      const replies = repliesOf.get(item.id) ?? [];
      if (replies.length === 0 && (item.replyIds ?? []).length === 0) return item;
      return { ...item, replyIds: replies };
    }
    if (item.kind === 'comment') {
      const parent = parentOf.get(item.id);
      if (parent === undefined) {
        if (item.parentRevisionId === undefined) return item;
        // Rebuilt, not patched: the key has to GO, and spreading cannot remove one.
        const { parentRevisionId: _dropped, ...rest } = item;
        return rest as T;
      }
      return item.parentRevisionId === parent ? item : { ...item, parentRevisionId: parent };
    }
    return item;
  });
}

/**
 * Paragraph node id → document position, from the TREE rather than from a layout.
 *
 * Memoized on the immutable root: one full derivation pass asks this question three times
 * (replacement pairing, the queue's merged order, the session's cached order), and each
 * answer was a fresh full-tree walk. The instance is SHARED, so the return type is
 * ReadonlyMap: a caller mutating it would poison every later reader of this root.
 */
export function paragraphOrderOfPart(part: OoxmlPart): ReadonlyMap<string, number> {
  const cached = paragraphOrderCache.get(part.root);
  if (cached) return cached;
  const order = new Map<string, number>();
  const walk = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    if (node.kind === 'paragraph') {
      if (!order.has(node.id)) order.set(node.id, order.size);
      return;
    }
    // A table's paragraph sequence is a pure function of the table subtree, so an unchanged
    // table hands back its list instead of being re-descended — an edit outside any table
    // otherwise re-walked every cell of every table in the document.
    if (node.kind === 'table') {
      let ids = tableParagraphIdsCache.get(node);
      if (!ids) {
        const found: string[] = [];
        const collect = (candidate: OoxmlNode, nestedDepth: number): void => {
          if (candidate.kind === 'textValue' || nestedDepth > 64) return;
          if (candidate.kind === 'paragraph') {
            found.push(candidate.id);
            return;
          }
          for (const child of candidate.children) collect(child, nestedDepth + 1);
        };
        for (const child of node.children) collect(child, 0);
        ids = found;
        tableParagraphIdsCache.set(node, ids);
      }
      for (const id of ids) {
        if (!order.has(id)) order.set(id, order.size);
      }
      return;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(part.root, 0);
  paragraphOrderCache.set(part.root, order);
  return order;
}

/** The paragraph order index per part root, bounded like {@link locatedSitesCache}. */
const paragraphOrderCache = createRecentRootCache<Map<string, number>>(8);

/**
 * Like {@link paragraphOrderOfPart}, but descends INTO paragraphs, so paragraphs nested
 * in a run's content — a textbox's `w:txbxContent` — rank right after their host.
 *
 * Review queues and containment checks use this order so a textbox item stays adjacent to its
 * host instead of falling behind later body items. The shallow variant remains for walks that
 * deliberately treat hosted stories as separate lanes.
 */
export function deepParagraphOrderOfPart(part: OoxmlPart): ReadonlyMap<string, number> {
  const cached = deepParagraphOrderCache.get(part.root);
  if (cached) return cached;
  const order = new Map<string, number>();
  for (const id of subtreeDeepParagraphIds(part.root, 0)) {
    if (!order.has(id)) order.set(id, order.size);
  }
  deepParagraphOrderCache.set(part.root, order);
  return order;
}

const interactiveReviewDerivation: ReviewDerivationDependencies = {
  retainRevisionItems: true,
  revisionSites: collectRevisionSites,
  locations: locateSites,
  commentAnchors: commentAnchorsOfStory,
  deepOrder: deepParagraphOrderOfPart,
};

/** One shared empty list for the subtrees that hold no paragraph. */
const EMPTY_DEEP_PARAGRAPH_IDS: readonly string[] = Object.freeze([]);

/**
 * Deep paragraph ids under one immutable node, in document order, memoized per node.
 *
 * The deep order re-derives per fresh root, and a structural keystroke re-walked every
 * node of the document — every run of every paragraph — to relist ids that did not move.
 * Composing from per-subtree memos re-walks only the rebuilt spine.
 *
 * The entry remembers the depth it was computed at, because the 64-level cap makes the
 * list depth-dependent: an op can republish a shared subtree at a different depth (an
 * unwrap rebuilds only the spine ABOVE it), and serving a list computed under the old
 * cap would diverge from a cold walk on hostile >64-deep nesting. A depth mismatch just
 * recomputes, so the memo stays exactly the cold walk's answer.
 */
const subtreeDeepParagraphIdsCache = new WeakMap<
  OoxmlNode,
  { readonly depth: number; readonly ids: readonly string[] }
>();

function subtreeDeepParagraphIds(node: OoxmlNode, depth: number): readonly string[] {
  if (node.kind === 'textValue' || depth > 64) return EMPTY_DEEP_PARAGRAPH_IDS;
  const cached = subtreeDeepParagraphIdsCache.get(node);
  if (cached && cached.depth === depth) return cached.ids;
  let found: string[] | null = null;
  if (node.kind === 'paragraph') (found ??= []).push(node.id);
  for (const child of node.children) {
    const ids = subtreeDeepParagraphIds(child, depth + 1);
    if (ids.length === 0) continue;
    found ??= [];
    for (const id of ids) found.push(id);
  }
  const result: readonly string[] = found ?? EMPTY_DEEP_PARAGRAPH_IDS;
  subtreeDeepParagraphIdsCache.set(node, { depth, ids: result });
  return result;
}

/** The deep paragraph order per part root, bounded like the shallow one above. */
const deepParagraphOrderCache = createRecentRootCache<Map<string, number>>(8);

/** Paragraph ids of one table subtree, in reading order, per immutable table node. */
const tableParagraphIdsCache = new WeakMap<OoxmlNode, readonly string[]>();
