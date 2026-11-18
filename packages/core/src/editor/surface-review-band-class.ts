// The class a review band paints in: comment, custom node, or revision, faint until its card
// is the active one. Pure, so the surface and its tests share one rule.

import {
  reviewItemKey,
  type ReviewItem,
  type ReviewRevisionKind,
} from '@docx-editor.dev/core/layout';
import type { OverlayRect } from '@docx-editor.dev/core/output';
import type { ReviewAuthorInfo } from '../output/revision-presentation.ts';
import { reviewItemAuthor } from './surface-review-authors.ts';

/** Separates a decision's key from its per-range index. A NUL cannot occur in either. */
export const RANGE_SUFFIX = '\u0000range\u0000';

/** The class a band draws in, or null when this range should not be drawn at all. */
export function bandClassFor(
  key: string,
  activeKeys: ReadonlySet<string>,
  byKey: ReadonlyMap<string, ReviewItem>
): string | null {
  // A revision's key is suffixed per range when one decision covers several sites, so the
  // active test compares the DECISION, not the site. Split on NUL, which an author name
  // cannot contain — `#` can, and an author called `A#b` never saw their band light up.
  const parts = key.split(RANGE_SUFFIX);
  const decision = parts[0]!;
  const isActive = activeKeys.has(decision);
  if (key.startsWith('comment-')) {
    const item = byKey.get(decision);
    const resolved = item?.kind === 'comment' && item.resolved;
    if (resolved && !isActive) return null;
    return isActive
      ? `docx-comment-band docx-comment-band--active${resolved ? ' docx-comment-band--resolved-active' : ''}`
      : 'docx-comment-band';
  }
  // A custom node's band only while its card is open: the chip tint already marks the
  // node persistently, and the comment band is the right weight for "this is the one".
  if (key.startsWith('custom-')) {
    return isActive ? 'docx-comment-band docx-comment-band--active' : null;
  }
  const item = byKey.get(decision);
  if (!item || item.kind !== 'revision') return null;
  // In the revision's OWN colour — green for text arriving, red for text leaving — so the
  // band never contradicts the decoration beneath it. A REPLACEMENT is one decision in two
  // colours: its leading ranges are the struck half, the rest is what took their place, and
  // painting the pair one neutral grey said "something changed here" about an edit whose
  // two halves the page is already colouring.
  const index = parts.length > 1 ? Number(parts[1]) : 0;
  const kindOf = (revisionKind: ReviewRevisionKind): 'delete' | 'insert' | 'other' => {
    if (revisionKind === 'delete' || revisionKind === 'moveFrom') return 'delete';
    if (revisionKind === 'insert' || revisionKind === 'moveTo') return 'insert';
    if (revisionKind === 'replace' && item.replacedRangeCount !== undefined) {
      return index < item.replacedRangeCount ? 'delete' : 'insert';
    }
    return 'other';
  };
  const kind = kindOf(item.revisionKind);
  // Every pending change carries a band, faint until it is the open one. A tracked page
  // with no tint at all made "which of these is selected" a question about a 1px margin
  // bar; a page where only the active one tints made the others look resolved.
  return `docx-revision-band docx-revision-band--${kind}${isActive ? ' docx-revision-band--active' : ''}`;
}

/** A measured band and the key of the range it draws. */
export type KeyedBandRect = OverlayRect & { readonly key: string };

/** The decision a band belongs to: its key without the per-range index. */
function decisionOf(key: string): string {
  const at = key.indexOf(RANGE_SUFFIX);
  return at === -1 ? key : key.slice(0, at);
}

/**
 * The items the measured bands belong to, by key.
 *
 * A band needs its item for its class and its author. Keying the whole queue for that built
 * one string for every item on every edit, while the bands name only the few items on the
 * visible pages. This reads the queue once, compares ids, and builds keys for the matches
 * alone. A key the queue lists more than once resolves to its last item, as a map over the
 * whole queue would.
 *
 * The answer is kept for one queue and one set of bands, both compared by identity.
 */
export function createBandItemLookup(): (
  items: readonly ReviewItem[],
  rects: readonly KeyedBandRect[]
) => ReadonlyMap<string, ReviewItem> {
  let last: {
    readonly items: readonly ReviewItem[];
    readonly rects: readonly KeyedBandRect[];
    readonly byKey: ReadonlyMap<string, ReviewItem>;
  } | null = null;
  return (items, rects) => {
    if (last && last.items === items && last.rects === rects) return last.byKey;
    const byKey = new Map<string, ReviewItem>();
    if (rects.length > 0) {
      const decisions = new Set<string>();
      for (const rect of rects) decisions.add(decisionOf(rect.key));
      // An item key is its kind, a dash, and its id, so every wanted key ends with a wanted
      // id. The id set is only a filter: the key itself decides.
      const ids = new Set<string>();
      for (const decision of decisions) ids.add(decision.slice(decision.indexOf('-') + 1));
      for (const item of items) {
        if (!ids.has(item.id)) continue;
        const key = reviewItemKey(item);
        if (decisions.has(key)) byKey.set(key, item);
      }
    }
    last = { items, rects, byKey };
    return byKey;
  };
}

/**
 * The bands to paint: each measured rectangle with its class and its author hooks.
 *
 * A rectangle whose class is null is not drawn. The author comes from the decision, as the
 * class does, because a revision covering several sites carries one key per range.
 */
export function reviewBands(
  rects: readonly KeyedBandRect[],
  activeKeys: ReadonlySet<string>,
  byKey: ReadonlyMap<string, ReviewItem>,
  authors: ReadonlyMap<string, ReviewAuthorInfo>
): OverlayRect[] {
  const bands: OverlayRect[] = [];
  for (const rect of rects) {
    const className = bandClassFor(rect.key, activeKeys, byKey);
    if (!className) continue;
    const decision = decisionOf(rect.key);
    const item = byKey.get(decision);
    const name = item ? reviewItemAuthor(item) : null;
    const reviewAuthor = name === null || name === '' ? undefined : authors.get(name);
    // The author's own active background, on the OPEN revision's band only. The active
    // test repeats the class's — the decision, not the site — so a multi-range decision
    // tints every range it covers, and a comment band never takes a revision field.
    const activeBackground =
      item?.kind === 'revision' && activeKeys.has(decision)
        ? reviewAuthor?.style?.activeBackground
        : undefined;
    bands.push({
      ...rect,
      className,
      ...(reviewAuthor ? { reviewAuthor } : {}),
      ...(activeBackground !== undefined ? { activeBackground } : {}),
    });
  }
  return bands;
}
