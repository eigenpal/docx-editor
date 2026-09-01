// Where every node of a story sits, in the model offset space its paragraph defines.
//
// Split from `review-reads.ts` (which stays the review QUEUE derivation) purely along the
// "where is this node" seam: this module owns the site index, its per-paragraph and
// per-row memos, and the tracked-row anchors; the queue asks it for ranges.

import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { paragraphOffsetIndex, transientParagraphOffsetIndex } from './tree-op-segments.ts';
import { createRecentRootCache } from './recent-root-cache.ts';

/** The `w:p` a node sits inside, and the model offset it starts at within that paragraph. */
export interface SiteLocation {
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
export function locateSites(part: OoxmlPart): ReadonlyMap<string, SiteLocation> {
  return locateSitesWithPolicy(part, true);
}

function locateSitesWithPolicy(
  part: OoxmlPart,
  retainAcrossReads: boolean
): ReadonlyMap<string, SiteLocation> {
  // Memoized on the immutable root: the merged index is a pure function of the tree, and
  // every caller in one derivation pass — the revision cards, the pro custom-node cards, an
  // automation read — asks for the same one. Rebuilding it merged 80k+ entries per call on
  // a long document. The instance is SHARED, so the return type is ReadonlyMap: a caller
  // mutating it would poison every later reader of this root, undo included.
  const merged = retainAcrossReads ? locatedSitesCache.get(part.root) : undefined;
  if (merged) return merged;
  const located = new Map<string, SiteLocation>();
  const walkParagraph = (paragraph: OoxmlParagraphNode): void => {
    // Paragraph-local by construction: every offset here is measured inside this paragraph,
    // so an unchanged paragraph's answer is still true and is reused rather than re-walked.
    // A keystroke otherwise re-derived the location of every node in the document.
    const memo = retainAcrossReads ? paragraphLocationsCache.get(paragraph) : undefined;
    if (memo) {
      for (const [id, location] of memo) located.set(id, location);
      return;
    }
    const own = new Map<string, SiteLocation>();
    locateInParagraph(paragraph, own, retainAcrossReads);
    if (retainAcrossReads) paragraphLocationsCache.set(paragraph, own);
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
    // A paragraph CAN hold table rows — a textbox in a run holds block content, tables
    // included — so paragraph subtrees are walked, not pruned. Memoized per paragraph
    // like the location walk above: the ordinary paragraph with no textbox costs one
    // cached empty answer instead of a descent through every run.
    if (node.kind === 'paragraph') {
      let entries = retainAcrossReads ? paragraphRowAnchorsCache.get(node) : undefined;
      if (!entries) {
        const own: (readonly [string, SiteLocation])[] = [];
        collectRowAnchorEntries(node, 0, own, retainAcrossReads);
        entries = own;
        if (retainAcrossReads) paragraphRowAnchorsCache.set(node, entries);
      }
      for (const [markerId, location] of entries) located.set(markerId, location);
      return;
    }
    if (node.kind === 'tableRow') {
      // Row-local by the same argument as the paragraph memo: the markers and the first
      // paragraph that anchors them all live inside the row subtree. A nested row's
      // markers are recorded by the OUTER row's walk too, anchored to the outer row's
      // first paragraph — and then overwritten when the walk below reaches the nested row
      // itself, whose own anchor wins. The per-row entries replay in that same order.
      let entries = retainAcrossReads ? rowMarkerAnchorsCache.get(node) : undefined;
      if (!entries) {
        entries = computeRowMarkerAnchors(node);
        if (retainAcrossReads) rowMarkerAnchorsCache.set(node, entries);
      }
      for (const [markerId, location] of entries) located.set(markerId, location);
    }
    for (const child of node.children) anchorTrackedRows(child, depth + 1);
  };
  anchorTrackedRows(part.root, 0);
  if (retainAcrossReads) locatedSitesCache.set(part.root, located);
  return located;
}

/**
 * Every row-marker anchor under a node, in the same emit order the outer walk uses —
 * outer rows first, nested rows after, so a later entry for the same marker wins.
 */
function collectRowAnchorEntries(
  node: OoxmlNode,
  depth: number,
  out: (readonly [string, SiteLocation])[],
  retainAcrossReads: boolean
): void {
  if (node.kind === 'textValue' || depth > 64) return;
  if (node.kind === 'tableRow') {
    let entries = retainAcrossReads ? rowMarkerAnchorsCache.get(node) : undefined;
    if (!entries) {
      entries = computeRowMarkerAnchors(node);
      if (retainAcrossReads) rowMarkerAnchorsCache.set(node, entries);
    }
    for (const entry of entries) out.push(entry);
  }
  for (const child of node.children) {
    collectRowAnchorEntries(child, depth + 1, out, retainAcrossReads);
  }
}

/** Tracked row/cell marker anchors of one row subtree, memoized on the immutable row. */
function computeRowMarkerAnchors(row: OoxmlNode): readonly (readonly [string, SiteLocation])[] {
  let paragraph: OoxmlParagraphNode | null = null;
  const firstParagraph = (candidate: OoxmlNode, nestedDepth: number): void => {
    if (paragraph || candidate.kind === 'textValue' || nestedDepth > 64) return;
    if (candidate.kind === 'paragraph') {
      paragraph = candidate;
      return;
    }
    for (const child of candidate.children) firstParagraph(child, nestedDepth + 1);
  };
  firstParagraph(row, 0);
  if (!paragraph) return EMPTY_ROW_ANCHORS;
  const anchor: SiteLocation = {
    paragraphId: (paragraph as OoxmlParagraphNode).id,
    start: 0,
    end: 0,
  };
  const entries: (readonly [string, SiteLocation])[] = [];
  const placeMarkers = (
    candidate: OoxmlNode,
    parentName: string | undefined,
    nestedDepth: number
  ): void => {
    if (candidate.kind === 'textValue' || nestedDepth > 64) return;
    if (candidate.kind === 'paragraph') return;
    const rowMarker =
      parentName === 'trPr' && (candidate.localName === 'ins' || candidate.localName === 'del');
    const cellMarker =
      parentName === 'tcPr' &&
      (candidate.localName === 'cellIns' || candidate.localName === 'cellDel');
    if (rowMarker || cellMarker) entries.push([candidate.id, anchor]);
    for (const child of candidate.children) {
      placeMarkers(child, candidate.localName, nestedDepth + 1);
    }
  };
  placeMarkers(row, undefined, 0);
  return entries;
}

const EMPTY_ROW_ANCHORS: readonly (readonly [string, SiteLocation])[] = [];

/** Node id → paragraph-local offsets, memoized on the immutable paragraph node. */
const paragraphLocationsCache = new WeakMap<OoxmlNode, ReadonlyMap<string, SiteLocation>>();

/**
 * The merged site index per part root, bounded to recent roots.
 *
 * Bounded because the undo history retains old roots by reference: a plain WeakMap would
 * keep one O(document) index alive per retained root. Per-NODE memos above are exempt —
 * unchanged nodes are shared across roots, so those caches stay O(document) in total.
 */
const locatedSitesCache = createRecentRootCache<Map<string, SiteLocation>>(8);

/** Marker anchors per immutable table row. */
const rowMarkerAnchorsCache = new WeakMap<
  OoxmlNode,
  readonly (readonly [string, SiteLocation])[]
>();

/** Row-marker anchors under one immutable paragraph (a textbox can hold a table). */
const paragraphRowAnchorsCache = new WeakMap<
  OoxmlNode,
  readonly (readonly [string, SiteLocation])[]
>();

function locateInParagraph(
  paragraph: OoxmlParagraphNode,
  located: Map<string, SiteLocation>,
  retainAcrossReads: boolean
): void {
  const offsets = retainAcrossReads
    ? paragraphOffsetIndex(paragraph)
    : transientParagraphOffsetIndex(paragraph);
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
