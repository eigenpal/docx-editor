// The review queue: every pending decision in the document, derived from the TREE.
//
// Deliberately not from laid-out spans. Layout is a VIEW — the proposed-result mode drops every
// deletion and the original mode drops every insertion — so a queue derived from spans empties
// by half the moment a reader switches view, and the changes that vanished become unreachable
// from the surface that is supposed to resolve them. The queue is a property of the document.
//
// Layout is still consulted, but only for GEOMETRY: where a card sits beside the page. That is
// the one thing the tree cannot answer.

import {
  WML_NAMESPACE_URI,
  collectRevisionSites,
  paragraphOffsetIndex,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
  type RevisionAddress,
} from '@docx-editor.dev/core-contract/store';
import {
  commentAnchorsOfStory,
  commentsOfPart,
  threadStateOfPart,
  type CommentRecord,
  type CommentThreadState,
} from './comment-anchors.ts';

/** A position in the model offset space of one story. */
export interface ReviewPosition {
  readonly paragraphId: string;
  readonly offset: number;
}

/** Where an item is anchored: a range in one story. */
export interface ReviewRange {
  readonly partName: string;
  readonly start: ReviewPosition;
  readonly end: ReviewPosition;
}

/**
 * What kind of decision a revision card represents.
 *
 * Wider than the four content wrappers, because a reviewer has to be shown every pending
 * decision, including the ones that decorate no characters. A card the surface cannot show is
 * a change the reviewer never learns about — and `acceptAllRevisions` refuses if ANY revision
 * in the document is one the engine cannot resolve, so an invisible one makes Accept All fail
 * for a reason nothing on screen explains.
 */
export type ReviewRevisionKind =
  | 'insert'
  | 'delete'
  /**
   * A deletion and an insertion that are one edit: text typed over a selection.
   *
   * Word shows these as a single `Replaced "x" with "y"` card, and resolving one half
   * without the other is never what the reviewer meant — accepting the deletion alone
   * leaves the replacement text unproposed, rejecting it alone leaves both.
   */
  | 'replace'
  | 'moveFrom'
  | 'moveTo'
  /** `w:rPrChange` / `w:pPrChange` — the words are unchanged, their formatting is not. */
  | 'format'
  /** `w:pPr/w:rPr/w:ins|w:del` — a paragraph split or merge. */
  | 'paragraphMark'
  /** A row, cell, section or grid revision. Supported row revisions are resolvable. */
  | 'structural';

export interface ReviewRevisionItem {
  readonly kind: 'revision';
  /** Stable across renders and unique per DECISION, not per site. */
  readonly id: string;
  /** The payload `acceptRevision` / `rejectRevision` take. */
  readonly address: RevisionAddress;
  /**
   * EVERY address this decision covers, `address` first.
   *
   * More than one only for a replacement, whose halves a foreign editor may have written
   * as two independent revisions. Accept and reject walk all of them in one transaction:
   * resolving one half and leaving the other is a state no reviewer asked for.
   */
  readonly addresses: readonly RevisionAddress[];
  /** The words a replacement removes. Empty for every other kind. */
  readonly replacedText: string;
  readonly revisionKind: ReviewRevisionKind;
  readonly author: string;
  readonly date?: string;
  /** Text the revision covers, for the card summary. Empty for changes with no characters. */
  readonly text: string;
  /** Every site this decision touches, in document order. */
  readonly ranges: readonly ReviewRange[];
  /**
   * How many leading `ranges` are the STRUCK half of a replacement.
   *
   * A replacement's card is one decision but its ranges are two colours — red over what is
   * going, green over what takes its place. ABSENT when the halves do not split at a single
   * point, which is what a file recording both under one revision id can produce; a surface
   * then has no basis for two colours and should paint one neutral band rather than guess.
   */
  readonly replacedRangeCount?: number;
  /**
   * True when the engine cannot resolve this kind, so accept and reject must not be offered.
   *
   * Derived HERE rather than from a caller-supplied predicate: the refusal list is internal,
   * and a surface asked to compute it would have to guess. A card that offers a button the
   * engine will refuse is worse than one that explains why it cannot.
   */
  readonly readOnly: boolean;
  /** The other half of a move, or the other side of a delete/insert replacement. */
  readonly pairedWith?: string;
}

export interface ReviewCommentItem {
  readonly kind: 'comment';
  readonly id: string;
  readonly comment: CommentRecord;
  readonly range: ReviewRange | null;
  readonly resolved: boolean;
  /** The comment this replies to, absent for a top-level comment. */
  readonly parentId?: string;
  /** Replies to this comment, in document order. Empty for a reply or a childless comment. */
  readonly replyIds: readonly string[];
  /** True when the file gave this comment no usable range. */
  readonly orphaned: boolean;
}

export type ReviewItem = ReviewRevisionItem | ReviewCommentItem;

/** The stable key a surface uses for the active item and for a React list. */
export function reviewItemKey(item: ReviewItem): string {
  return item.kind === 'comment' ? `comment-${item.id}` : `revision-${item.id}`;
}

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
  let text = '';
  for (const child of node.children) text += textUnder(child);
  return text;
}

/** The `w:p` a node sits inside, and the model offset it starts at within that paragraph. */
interface SiteLocation {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Locate every revision site in one walk.
 *
 * One walk rather than a lookup per site: `resolveRevisions` learned the same lesson the hard
 * way, where a per-site tree walk inside a per-site loop made accept-all quadratic.
 *
 * Offsets come from `paragraphOffsetIndex`, which is `segmentsOf`'s walk. A private one here
 * measured a run by summing its text and gave a note reference, an atomic field and a field's
 * instruction text the wrong lengths, so every card in a paragraph holding one reported a
 * range the caret and the ops disagreed with.
 */
function locateSites(part: OoxmlPart): Map<string, SiteLocation> {
  const located = new Map<string, SiteLocation>();
  const walkParagraph = (paragraph: OoxmlParagraphNode): void => {
    // Paragraph-local by construction: every offset here is measured inside this paragraph,
    // so an unchanged paragraph's answer is still true and is reused rather than re-walked.
    // A keystroke otherwise re-derived the location of every node in the document.
    const memo = paragraphLocationsCache.get(paragraph);
    if (memo) {
      for (const [id, location] of memo) located.set(id, location);
      return;
    }
    const own = new Map<string, SiteLocation>();
    locateInParagraph(paragraph, own);
    paragraphLocationsCache.set(paragraph, own);
    for (const [id, location] of own) located.set(id, location);
  };
  const walk = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    if (node.kind === 'paragraph') {
      walkParagraph(node);
      return;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(part.root, 0);

  const anchorTrackedRows = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    if (node.kind === 'tableRow') {
      let paragraph: OoxmlParagraphNode | null = null;
      const firstParagraph = (candidate: OoxmlNode, nestedDepth: number): void => {
        if (paragraph || candidate.kind === 'textValue' || nestedDepth > 64) return;
        if (candidate.kind === 'paragraph') {
          paragraph = candidate;
          return;
        }
        for (const child of candidate.children) firstParagraph(child, nestedDepth + 1);
      };
      firstParagraph(node, 0);
      if (paragraph) {
        const placeMarkers = (
          candidate: OoxmlNode,
          parentName: string | undefined,
          nestedDepth: number
        ): void => {
          if (candidate.kind === 'textValue' || nestedDepth > 64) return;
          if (candidate.kind === 'paragraph') return;
          const rowMarker =
            parentName === 'trPr' &&
            (candidate.localName === 'ins' || candidate.localName === 'del');
          const cellMarker =
            parentName === 'tcPr' &&
            (candidate.localName === 'cellIns' || candidate.localName === 'cellDel');
          if (rowMarker || cellMarker) {
            located.set(candidate.id, { paragraphId: paragraph!.id, start: 0, end: 0 });
          }
          for (const child of candidate.children) {
            placeMarkers(child, candidate.localName, nestedDepth + 1);
          }
        };
        placeMarkers(node, undefined, 0);
      }
    }
    for (const child of node.children) anchorTrackedRows(child, depth + 1);
  };
  anchorTrackedRows(part.root, 0);
  return located;
}

/** Node id → paragraph-local offsets, memoized on the immutable paragraph node. */
const paragraphLocationsCache = new WeakMap<OoxmlNode, ReadonlyMap<string, SiteLocation>>();

function locateInParagraph(
  paragraph: OoxmlParagraphNode,
  located: Map<string, SiteLocation>
): void {
  const offsets = paragraphOffsetIndex(paragraph);
  const place = (node: OoxmlNode, start: number, end: number, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    located.set(node.id, { paragraphId: paragraph.id, start, end });
    for (const child of node.children) place(child, start, end, depth + 1);
  };
  const visit = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    const span = offsets.spanOf(node);
    if (node.kind === 'run') {
      if (!span) return;
      located.set(node.id, { paragraphId: paragraph.id, start: span.start, end: span.end });
      // A run's OWN properties anchor over the run. `w:rPrChange` is a revision that
      // decorates no characters and lives in `w:rPr`, so stopping at the run left it with
      // no geometry at all: its card sorted to the end of the rail, painted no band, and
      // the caret in tracked-formatted text activated nothing while accept and reject
      // stayed on offer.
      for (const child of node.children) {
        if (child.kind === 'runProperties') place(child, span.start, span.end, depth + 1);
      }
      return;
    }
    if (span) located.set(node.id, { paragraphId: paragraph.id, start: span.start, end: span.end });
    for (const child of node.children) visit(child, depth + 1);
  };
  for (const child of paragraph.children) {
    if (child.kind === 'paragraphProperties') continue;
    visit(child, 0);
  }
  // The paragraph MARK is the pilcrow — it sits at the END of the paragraph, not at
  // offset 0 where its `w:pPr` happens to be written. Anchored at 0, a tracked Enter's
  // card never opened when the caret was at the break that made it, `setActiveReviewItem`
  // threw the caret to the paragraph start, and the zero-width range painted no band.
  const properties = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  if (properties) place(properties, offsets.length, offsets.length, 0);
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

/**
 * Every revision in one story, one card per DECISION.
 *
 * Sites sharing an `(id, author, date)` triple are ONE revision — a tracked row insertion is
 * `w:trPr/w:ins` plus `w:cellIns` on every cell — so they coalesce into one card listing every
 * range it touches. Keying per site would show the reviewer four decisions where there is one,
 * and accepting any of them would make the other three vanish.
 */
export function revisionItemsOf(part: OoxmlPart): ReviewRevisionItem[] {
  const located = locateSites(part);
  const byAddress = new Map<
    string,
    {
      address: RevisionAddress;
      revisionKind: ReviewRevisionKind;
      author: string;
      date?: string;
      text: string;
      /** Kept apart from `text`: a replacement needs both halves to word its card. */
      deletedText: string;
      ranges: ReviewRange[];
      readOnly: boolean;
    }
  >();

  for (const site of collectRevisionSites(part)) {
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
      if (kind === 'delete' || kind === 'moveFrom') existing.deletedText += textUnder(site.node);
      else if (kind !== 'format' && kind !== 'paragraphMark') existing.text += textUnder(site.node);
      continue;
    }
    byAddress.set(key, {
      address,
      revisionKind: kind,
      author,
      ...(date === undefined ? {} : { date }),
      text:
        kind === 'format' || kind === 'paragraphMark' || kind === 'delete' || kind === 'moveFrom'
          ? ''
          : textUnder(site.node),
      deletedText: kind === 'delete' || kind === 'moveFrom' ? textUnder(site.node) : '',
      ranges: range ? [range] : [],
      // A format or paragraph-mark change is resolvable; the structural kinds are not, and
      // nor is one with no author to address it by.
      readOnly: site.refused || authorless,
    });
  }

  const items = [...byAddress.values()].map(
    (entry): ReviewRevisionItem => ({
      kind: 'revision' as const,
      id: `${entry.revisionKind}-${addressKey(entry.address)}`,
      address: entry.address,
      addresses: [entry.address],
      revisionKind: entry.revisionKind,
      author: entry.author,
      ...(entry.date === undefined ? {} : { date: entry.date }),
      // A pure deletion shows the words it removes as its text; a replacement shows what
      // takes their place, with the removed half beside it.
      text: entry.revisionKind === 'replace' ? entry.text : entry.text || entry.deletedText,
      replacedText: entry.revisionKind === 'replace' ? entry.deletedText : '',
      ranges: entry.ranges,
      readOnly: entry.readOnly,
    })
  );
  return pairReplacements(items, paragraphOrderOfPart(part));
}

/**
 * Fold an adjacent deletion and insertion by one author into a single replacement.
 *
 * Typing over a selection is ONE edit, and Word shows it as one `Replaced "x" with "y"`
 * card. Whether the file records it as one revision or two is the writer's choice — Word
 * mints separate ids for the halves — so the pairing is done on ADJACENCY here rather than
 * on identity, which is the only thing that works for a file this engine did not write.
 *
 * Both addresses ride along, so accept and reject resolve the pair in one transaction.
 * Resolving half a replacement is never what the reviewer meant.
 */
function pairReplacements(
  items: readonly ReviewRevisionItem[],
  order: ReadonlyMap<string, number>
): ReviewRevisionItem[] {
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

  for (const deletion of pairable) {
    if (deletion.revisionKind !== 'delete' || taken.has(deletion.id)) continue;
    for (const insertion of pairable) {
      if (insertion.revisionKind !== 'insert' || taken.has(insertion.id)) continue;
      if (insertion.author !== deletion.author) continue;
      // Same MOMENT, not just the same author. Adjacency alone folded two edits an hour
      // apart into one card, and accepting it then resolved a revision the reviewer was not
      // looking at. The window matches the write side's.
      if (!sameMoment(deletion.date, insertion.date)) continue;
      // The deletion's LAST range against the insertion's FIRST: the two ends that actually
      // meet when the halves span more than one range each.
      if (!touching(deletion.ranges[deletion.ranges.length - 1]!, insertion.ranges[0]!)) continue;
      taken.add(deletion.id);
      taken.add(insertion.id);
      // Anchored at whichever half comes FIRST, so the card sits where the edit starts.
      const first = before(deletion.ranges[0]!, insertion.ranges[0]!, order) ? deletion : insertion;
      replacements.set(deletion.id, {
        ...first,
        id: `replace-${deletion.id}-${insertion.id}`,
        revisionKind: 'replace',
        // DEDUPED: when this engine wrote the replacement both halves share one identity,
        // and applying the same `acceptRevision` twice in one transaction refuses the second
        // — which refused the whole thing and left the replacement unresolved.
        addresses: sameAddress(deletion.address, insertion.address)
          ? [deletion.address]
          : [deletion.address, insertion.address],
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
 * Two ranges meet end-to-start, in the same paragraph.
 *
 * DELETION FIRST, and same paragraph only. The cross-paragraph case is gone: it checked that
 * the insertion's paragraph followed the deletion's, never that the deletion sat at the END
 * of its own — so "deleted something mid-paragraph, then inserted at the start of the next",
 * which is routine in a reviewed document, folded into one card, and one Accept then
 * resolved a revision the reviewer was not looking at. Order matters too: this engine only
 * ever writes delete-then-insert, so an insertion FOLLOWED by a deletion is a foreign file
 * where pairing them would be an invention.
 */
function touching(a: ReviewRange, b: ReviewRange): boolean {
  return a.end.paragraphId === b.start.paragraphId && a.end.offset === b.start.offset;
}

/** Two addresses naming one revision. */
function sameAddress(a: RevisionAddress, b: RevisionAddress): boolean {
  return a.id === b.id && a.author === b.author && (a.date ?? '') === (b.date ?? '');
}

/** The same editing moment, by the same rule the writer coalesces on. */
function sameMoment(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  const from = Date.parse(a);
  const to = Date.parse(b);
  if (Number.isNaN(from) || Number.isNaN(to)) return a === b;
  return Math.abs(to - from) <= PAIR_WINDOW_MS;
}

const PAIR_WINDOW_MS = 60_000;

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

export interface ReviewModelInput {
  /** The story the ranges live in — the main document, a header, a note. */
  readonly storyPart: OoxmlPart;
  /** `word/comments.xml`, absent when the package has none. */
  readonly commentsPart?: OoxmlPart | undefined;
  /** `word/commentsExtended.xml`, absent when the package has none. */
  readonly commentsExtendedPart?: OoxmlPart | undefined;
}

/**
 * Everything the review surface lists, in document order.
 *
 * Order is by paragraph position within the story, then by offset. A comment and the revision
 * it covers therefore arrive together, which is what lets a surface group them.
 */
export function collectReviewItems(input: ReviewModelInput): ReviewItem[] {
  const revisions = revisionItemsOf(input.storyPart);
  const comments = input.commentsPart ? commentsOfPart(input.commentsPart) : [];
  const anchors = commentAnchorsOfStory(input.storyPart);
  const threadState = input.commentsExtendedPart
    ? threadStateOfPart(input.commentsExtendedPart)
    : new Map<string, CommentThreadState>();

  const order = paragraphOrderOfPart(input.storyPart);
  const items: ReviewItem[] = [...revisions, ...commentItemsOf(comments, anchors, threadState)];
  return items.sort((a, b) => positionRank(a, order) - positionRank(b, order));
}

/** Paragraph node id → document position, from the TREE rather than from a layout. */
export function paragraphOrderOfPart(part: OoxmlPart): Map<string, number> {
  const order = new Map<string, number>();
  const walk = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    if (node.kind === 'paragraph') {
      if (!order.has(node.id)) order.set(node.id, order.size);
      return;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(part.root, 0);
  return order;
}

/** Every range a decision touches. One card can cover several, in different paragraphs. */
function rangesOf(item: ReviewItem): readonly ReviewRange[] {
  if (item.kind === 'comment') return item.range ? [item.range] : [];
  return item.ranges;
}

function firstRange(item: ReviewItem): ReviewRange | null {
  return rangesOf(item)[0] ?? null;
}

/**
 * A single comparable number for document order.
 *
 * Paragraph index dominates offset, so a revision spanning paragraphs still sorts by where it
 * STARTS. An item with no resolvable range sorts last rather than to position zero, which is
 * where an orphan used to land — tearing an orphaned reply out of its own thread.
 */
function positionRank(item: ReviewItem, order: ReadonlyMap<string, number>): number {
  const range = firstRange(item);
  if (!range) return Number.MAX_SAFE_INTEGER;
  const paragraph = order.get(range.start.paragraphId);
  if (paragraph === undefined) return Number.MAX_SAFE_INTEGER;
  return paragraph * 1_000_000 + Math.min(range.start.offset, 999_999);
}

/** Width of one range in document-order units, for the innermost-wins tie-break. */
function rangeWidth(range: ReviewRange, order: ReadonlyMap<string, number>): number {
  const start = order.get(range.start.paragraphId);
  const end = order.get(range.end.paragraphId);
  if (start === undefined || end === undefined) return Number.MAX_SAFE_INTEGER;
  // A real distance, not a sentinel: a cross-paragraph range used to score MAX_SAFE_INTEGER,
  // which lost every comparison, so placing the caret in a multi-paragraph insertion activated
  // nothing at all.
  return (end - start) * 1_000_000 + (range.end.offset - range.start.offset);
}

function rangeCovers(
  range: ReviewRange,
  position: ReviewPosition,
  order: ReadonlyMap<string, number>
): boolean {
  const target = order.get(position.paragraphId);
  const start = order.get(range.start.paragraphId);
  const end = order.get(range.end.paragraphId);
  if (target === undefined || start === undefined || end === undefined) return false;
  if (target < start || target > end) return false;
  // BOTH boundaries count. A caret resting at the end of a range is visually on that range's
  // last character; requiring it to be strictly inside makes the last character feel dead.
  if (target === start && position.offset < range.start.offset) return false;
  if (target === end && position.offset > range.end.offset) return false;
  return true;
}

/**
 * The narrowest range of this item that covers the position, or null.
 *
 * EVERY range is asked, not just the first. Sites sharing a triple coalesce into one card, so a
 * revision that touches two paragraphs carries two ranges — checking only the first left the
 * caret in the second paragraph activating nothing.
 */
function coveringWidth(
  item: ReviewItem,
  position: ReviewPosition,
  order: ReadonlyMap<string, number>
): number | null {
  let best: number | null = null;
  for (const range of rangesOf(item)) {
    if (!rangeCovers(range, position, order)) continue;
    const width = rangeWidth(range, order);
    if (best === null || width < best) best = width;
  }
  return best;
}

/**
 * Every item covering a position, innermost first.
 *
 * Returning the whole stack rather than one winner is what lets a surface offer cycling, a
 * stacked card, or a "1 of 3" affordance. A comment wrapping a revision used to be unreachable
 * because only the tightest range was ever returned.
 */
export function reviewItemsAt(
  items: readonly ReviewItem[],
  position: ReviewPosition,
  order: ReadonlyMap<string, number>
): ReviewItem[] {
  const covering: { item: ReviewItem; width: number }[] = [];
  for (const item of items) {
    const width = coveringWidth(item, position, order);
    if (width !== null) covering.push({ item, width });
  }
  return covering
    .sort((a, b) => {
      if (a.width !== b.width) return a.width - b.width;
      // At equal width a comment outranks a revision: it is a question waiting on the reader,
      // while the revision is also reachable from the toolbar.
      if (a.item.kind !== b.item.kind) return a.item.kind === 'comment' ? -1 : 1;
      return 0;
    })
    .map((entry) => entry.item);
}

/**
 * The item the caret is in, or null.
 *
 * A resolved comment never activates: a settled thread must not reopen itself as the reviewer
 * types near it.
 *
 * A REPLY resolves to the thread it belongs to. A reply is anchored over its parent's range,
 * so both cover the caret — and the reply, being newer, wins the innermost test. It is not a
 * card of its own (it renders inside its parent's), so the thread would have gone active with
 * nothing on screen showing it: the reply box vanished from a comment the moment somebody
 * replied to it.
 */
export function activeReviewItem(
  items: readonly ReviewItem[],
  position: ReviewPosition,
  order: ReadonlyMap<string, number>
): ReviewItem | null {
  const covering = reviewItemsAt(items, position, order).filter(
    (item) => !(item.kind === 'comment' && item.resolved)
  );
  const found = covering[0];
  if (!found) return null;
  return found.kind === 'comment' ? threadRootOf(items, found) : found;
}

/** Walk a reply up to the comment that heads its thread. Guarded against a cyclic file. */
function threadRootOf(items: readonly ReviewItem[], comment: ReviewCommentItem): ReviewItem {
  const byId = new Map<string, ReviewCommentItem>();
  for (const item of items) if (item.kind === 'comment') byId.set(item.id, item);
  const seen = new Set<string>([comment.id]);
  let current = comment;
  while (current.parentId !== undefined) {
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  return current;
}

/**
 * Where a card belongs beside the page, from LAYOUT RECORDS.
 *
 * The one question the tree cannot answer, and the one a surface must not answer for itself:
 * measuring painted DOM puts the sidebar a repaint behind the document and breaks outright
 * while pagination is in flight.
 *
 * Returns null when the item has no resolvable range, or when its paragraph is not in this
 * layout — a comment anchored in a header belongs to a story the body layout never saw.
 */
/** Where one paragraph sits, resolved once so a card is an O(1) lookup. */
export interface ReviewParagraphAnchor {
  readonly pageIndex: number;
  /** Sheet-absolute y of the page's content box. */
  readonly contentY: number;
  /** The fragment's own y, measured from that content box. */
  readonly fragmentY: number;
  readonly lines?: readonly {
    readonly range: { readonly end: number };
    readonly box: { readonly y: number };
  }[];
}

/**
 * Paragraph id to its place on the page, in ONE pass over the layout.
 *
 * Built once per layout and reused by every card. The straightforward version — scan the
 * pages until the paragraph turns up, per card — is a full-document walk per card, and a
 * contract with two hundred comments walked the document two hundred times every time the
 * caret moved. Toggling the pane was visibly slow for exactly that reason.
 */
export function reviewAnchorIndex<
  TPage extends { readonly index: number; readonly contentBox: { readonly y: number } },
>(
  layout: { readonly pages: readonly TPage[] },
  paragraphFragments: (page: TPage) => readonly {
    readonly paragraphId: string;
    readonly box: { readonly y: number };
    readonly lines?: readonly {
      readonly range: { readonly end: number };
      readonly box: { readonly y: number };
    }[];
  }[]
): Map<string, ReviewParagraphAnchor> {
  const index = new Map<string, ReviewParagraphAnchor>();
  for (const page of layout.pages) {
    for (const fragment of paragraphFragments(page)) {
      // FIRST fragment wins: a paragraph split across a page break is anchored where it
      // starts, which is where its comment marker was written.
      if (index.has(fragment.paragraphId)) continue;
      index.set(fragment.paragraphId, {
        pageIndex: page.index,
        contentY: page.contentBox.y,
        fragmentY: fragment.box.y,
        ...(fragment.lines ? { lines: fragment.lines } : {}),
      });
    }
  }
  return index;
}

/**
 * Where a card belongs beside the page, from LAYOUT RECORDS.
 *
 * The one question the tree cannot answer, and the one a surface must not answer for itself:
 * measuring painted DOM puts the sidebar a repaint behind the document and breaks outright
 * while pagination is in flight.
 *
 * Returns null when the item has no resolvable range, or when its paragraph is not in this
 * layout — a comment anchored in a header belongs to a story the body layout never saw.
 */
export function reviewItemGeometry(
  item: ReviewItem,
  index: ReadonlyMap<string, ReviewParagraphAnchor>
): { readonly pageIndex: number; readonly y: number } | null {
  const range = firstRange(item);
  if (!range) return null;
  const anchor = index.get(range.start.paragraphId);
  if (!anchor) return null;
  // TWO coordinate spaces meet here. A fragment's box is relative to the page CONTENT box;
  // a page's content box is absolute in the sheet stack. Using the fragment's own y alone
  // put every card from page two onwards at the top of the rail, all of them claiming to
  // annotate the first inch of the document.
  //
  // The LINE the range starts on, not the paragraph's top: a comment on the last line of a
  // twelve-line paragraph belongs beside that line, which is where Word puts it.
  const line = anchor.lines?.find((entry) => range.start.offset < entry.range.end);
  return {
    pageIndex: anchor.pageIndex,
    y: anchor.contentY + (line ? line.box.y : anchor.fragmentY),
  };
}
