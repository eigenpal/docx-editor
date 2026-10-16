// A last pass over the review queue, supplied by the lane that mounts the session.
//
// Some questions about a review item need the style hierarchy, which this lane cannot import.
// The editor attaches the pass to the review model it hands the session, and the session runs
// it on the final queue of every derivation path (full, memoized and locally patched), so
// every reader of `reviewItems()` sees the same queue.

import type { ReviewModuleContribution } from '../contracts/modules.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import type { ReviewItem } from '../store/store/review-items.ts';

/** What the pass reads besides the queue. */
export interface ReviewItemFilterInputs {
  readonly pkg: OoxmlPackage;
  readonly stylesRoot: OoxmlElement | null;
  readonly numberingRoot: OoxmlElement | null;
}

/** Returns the queue it was given when it removes nothing. */
export type ReviewItemFilter = (
  items: readonly ReviewItem[],
  inputs: ReviewItemFilterInputs
) => readonly ReviewItem[];

const filters = new WeakMap<ReviewModuleContribution, ReviewItemFilter>();

/** Attach `filter` to `model`, and return `model`. */
export function withReviewItemFilter<T extends ReviewModuleContribution>(
  model: T,
  filter: ReviewItemFilter
): T {
  filters.set(model, filter);
  return model;
}

/** The pass attached to `model`, if any. */
export function reviewItemFilterOf(
  model: ReviewModuleContribution | undefined
): ReviewItemFilter | undefined {
  return model ? filters.get(model) : undefined;
}
