// The rail's fixed quantities: its geometry constants, and the three pure helpers every
// collection in it asks.
//
// Extracted from `DocxEditorReview.tsx` to keep that file under the max-lines gate. Nothing
// here touches React state or the review model, which is exactly why it was the part that
// could leave: a constant and a set membership test read the same wherever they are called.

import type { ReviewItemQuery } from '@docx-editor.dev/core/contracts/editor';
import type { ReviewItemView } from './useReview';

/** Where the rail is, in the coordinates of its positioning container. */
export interface RailMetrics {
  /** Layout points to CSS pixels, from the engine. */
  readonly scale: number;
  /** The painted surface's own top offset, so chrome above the pages does not shift cards. */
  readonly top: number;
  /** Left edge, one gutter right of the sheet; null until there is a surface to measure. */
  readonly left: number | null;
}

export const INITIAL_METRICS: RailMetrics = { scale: 96 / 72, top: 0, left: null };

/** Space between the page edge and the cards. */
export const RAIL_GUTTER = 16;

/** The compose affordance's place in the stacking run. Not a review item; never rendered. */
export const COMPOSE_KEY = '\u0000compose';

/**
 * How far outside the visible scroll window a card still mounts, in pixels.
 *
 * Enough that a normal scroll or a pane toggle never shows an empty gutter, small enough
 * that a document with two hundred comments mounts a handful of cards rather than all of
 * them. Rendering every card was the toggle's lag: two hundred cards' worth of DOM, plus a
 * `top` transition on each, in one frame.
 */
export const RAIL_OVERSCAN = 600;

/** How many author slots the token ramp defines; past it, colours repeat. */
export const AUTHOR_SLOTS = 8;

/** What an unmeasured, uncollapsed card reserves in the stacking run, in CSS px. */
export const DEFAULT_CARD_HEIGHT = 72;
/** A collapsed card: the head row and its padding, in CSS px. */
export const COLLAPSED_CARD_HEIGHT = 64;
/**
 * How far (CSS px) a card may be pushed below its own text before it collapses to a
 * header. Roughly half a viewport: nearer than that the eye still connects card to text;
 * further, a full card reads as annotating whatever happens to be beside it.
 */
export const COLLAPSE_DISPLACEMENT_PX = 480;

/** Stable query for the balloon's unplaced queue read — never allocate per render. */
export const NO_PLACEMENT_REVIEW_QUERY = Object.freeze({
  placement: false,
}) satisfies ReviewItemQuery;

/**
 * Whether this entry renders INSIDE another card rather than as one of its own.
 *
 * Two kinds of reply, one rule. A threaded reply belongs in the comment it answers; a reply to
 * a TRACKED CHANGE is also a comment — OOXML gives `w:ins` and `w:del` no body, so the text is
 * written over the change's own range — and belongs in the change's card. Everywhere the rail
 * lists roots asks this, because a filter that checked only `parentId` drew a reply to a
 * revision twice: once inside the change and once beside it.
 */
export function isThreadedReply(entry: ReviewItemView, present: ReadonlySet<string>): boolean {
  if (entry.kind !== 'comment') return false;
  // A parent this list does not hold is not a parent HERE. The engine already drops a link
  // its own `excludeRevisionKinds` filter broke, but a consumer's `filter` prop can break one
  // too, and a comment excluded as a reply to a card nobody draws is a comment that vanishes.
  // Falling back to root is the only answer that always renders it somewhere.
  if (entry.parentId !== undefined) return present.has(entry.parentId);
  if (entry.parentRevisionId !== undefined) return present.has(entry.parentRevisionId);
  return false;
}

/** Ids of everything the rail is working from, for the reply/root test above. */
export function idsOf(items: readonly ReviewItemView[]): ReadonlySet<string> {
  return new Set(items.map((entry) => entry.id));
}

/** Keeps the caret: a mousedown that bubbles to the editor moves it. Inputs are exempt. */
export function guardMousedown(event: React.MouseEvent): void {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
}
