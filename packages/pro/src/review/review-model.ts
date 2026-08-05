/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The review queue DERIVATION: every pending decision in the document, from the TREE.
//
// Lifted from the engine (pro-review-and-custom-nodes). The item vocabulary and its
// pure helpers stay in core's `review-support`; this module is what turns a
// document into a queue, and it reaches the engine through the `EditorModule`
// seam (`reviewModule()` hands `collectReviewItems` to `createDocxEditor`).
//
// Deliberately not from laid-out spans. Layout is a VIEW — the proposed-result mode drops every
// deletion and the original mode drops every insertion — so a queue derived from spans empties
// by half the moment a reader switches view, and the changes that vanished become unreachable
// from the surface that is supposed to resolve them. The queue is a property of the document.

import {
  WML_NAMESPACE_URI,
  collectRevisionSites,
  findNode,
  paragraphOffsetIndex,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
  type RevisionAddress,
} from '@docx-editor.dev/core-contract/store';
import {
  paragraphOrderOfPart,
  reviewItemPositionRank,
  type CommentRecord,
  type CommentThreadState,
  type ReviewCommentItem,
  type ReviewItem,
  type ReviewModelInput,
  type ReviewPosition,
  type ReviewRange,
  type ReviewRevisionItem,
  type ReviewRevisionKind,
} from '@docx-editor.dev/core-contract/layout';
import { commentAnchorsOfStory, commentsOfPart, threadStateOfPart } from './comment-anchors.ts';

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
  const items = revisionItemsFromSites(part, collectRevisionSites(part), located);
  return pairReplacements(items, paragraphOrderOfPart(part));
}

/**
 * Revisions wholly inside one paragraph — for a conservative local review patch after a
 * text-local edit. Walks a paragraph-root part view, not the full story.
 */
export function revisionItemsOfParagraph(
  part: OoxmlPart,
  paragraphId: string
): ReviewRevisionItem[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  const localPart: OoxmlPart = {
    id: part.id,
    name: part.name,
    contentType: part.contentType,
    root: paragraph,
  };
  return revisionItemsOf(localPart);
}

function revisionItemsFromSites(
  part: OoxmlPart,
  sites: ReturnType<typeof collectRevisionSites>,
  located: ReadonlyMap<string, SiteLocation>
): ReviewRevisionItem[] {
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

  return [...byAddress.values()].map(
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

/**
 * Everything the review surface lists, in document order.
 *
 * Order is by paragraph position within the story, then by offset. A comment and the revision
 * it covers therefore arrive together, which is what lets a surface group them. Furniture
 * stories rank after the body in one merged order — their geometry (the page they first paint
 * on) is a layout question the queue deliberately does not answer.
 */
export function collectReviewItems(input: ReviewModelInput): ReviewItem[] {
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
  const order = new Map<string, number>();
  for (const part of parts) {
    revisions.push(...revisionItemsOf(part));
    anchors.push(...commentAnchorsOfStory(part));
    const base = order.size;
    for (const [id, position] of paragraphOrderOfPart(part)) {
      if (!order.has(id)) order.set(id, base + position);
    }
  }

  const items: ReviewItem[] = [...revisions, ...commentItemsOf(comments, anchors, threadState)];
  return items.sort((a, b) => reviewItemPositionRank(a, order) - reviewItemPositionRank(b, order));
}
