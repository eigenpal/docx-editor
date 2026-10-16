// A last pass over the review queue, supplied by the lane that mounts the session.
//
// Some questions about a review item need the style hierarchy, which this lane cannot import.
// The editor attaches the pass to the review model it hands the session, and the session runs
// it on the final queue of every derivation path (full, memoized and locally patched), so
// every reader of `reviewItems()` sees the same queue.

import type { ReviewModuleContribution } from '../contracts/modules.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlElement, OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { ReviewItem } from '../store/store/review-items.ts';

/** What the pass reads besides the queue. */
export interface ReviewItemFilterInputs {
  readonly pkg: OoxmlPackage;
  readonly stylesRoot: OoxmlElement | null;
  readonly numberingRoot: OoxmlElement | null;
}

/**
 * Returns the queue it was given when it removes nothing. A function of the items and the
 * inputs alone, so the session runs it on new items only and keeps what it already filtered
 * while the inputs stay the same.
 */
export type ReviewItemFilter = <T extends ReviewItem>(
  items: readonly T[],
  inputs: ReviewItemFilterInputs
) => readonly T[];

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

/** The filter inputs a queue was derived with, as the session keeps them. */
interface FilteredWith {
  readonly stylesPart: OoxmlPart | undefined;
  readonly numberingRoot: OoxmlElement | null;
}

/**
 * The session's pass for one derivation: `filtered` runs `model`'s filter, or hands the list
 * back when it has none. `sameFilter` says whether `previous` was filtered against the same
 * inputs. The fast paths reuse filtered items, so they hold only while it is true.
 */
export function reviewItemFiltering(
  model: ReviewModuleContribution,
  pkg: OoxmlPackage,
  current: FilteredWith,
  previous: FilteredWith | null
): {
  readonly filtered: <T extends ReviewItem>(list: readonly T[]) => readonly T[];
  readonly sameFilter: boolean;
} {
  const filter = reviewItemFilterOf(model);
  const inputs = {
    pkg,
    stylesRoot: current.stylesPart?.root ?? null,
    numberingRoot: current.numberingRoot,
  };
  return {
    filtered: (list) => (filter ? filter(list, inputs) : list),
    sameFilter:
      previous?.stylesPart === current.stylesPart &&
      previous?.numberingRoot === current.numberingRoot,
  };
}
