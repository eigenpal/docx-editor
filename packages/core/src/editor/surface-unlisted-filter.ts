// The surface's revision filter with the records the review queue leaves out.

import {
  couldHide,
  hiddenReviewSitesOf,
  type HiddenReviewSites,
} from '../binding/review-item-filter.ts';
import type { ReviewDisplayMode } from '../contracts/editor.ts';
import {
  withHiddenRevisionSites,
  withHiddenRevisionSitesKey,
} from '../layout/revision-hidden-sites.ts';
import type { RevisionAuthorFilter } from '../layout/revision-projection.ts';
import type { ReviewItem } from '../store/store/review-items.ts';

/** The key of a session's last All Markup queue that left records out. */
interface LeftOutBefore {
  readonly key: string;
  /** The queue last checked, and whether it holds no property change at all. */
  checked: readonly ReviewItem[] | null;
  clear: boolean;
}

const leftOutBefore = new WeakMap<object, LeftOutBefore>();

/**
 * The All Markup filter for a queue that leaves `hidden` out.
 *
 * A queue that leaves records out keys its filter by what they were decided against. When its
 * last record goes, as when every change is accepted, the filter keeps that key while the queue
 * is still decided against the same styles and numbering. The layout caches then keep every
 * block that held no change, where a new key would lay the whole document out again.
 *
 * The key is kept only while the queue holds no property change, the one kind of change a
 * queue can leave out. Then no record that a block was cached without is back with a card,
 * and no block cached under the kept key holds a record that a later queue could leave out.
 * A queue with a property change and nothing left out takes the plain filter again, as it
 * always did.
 */
function allMarkupFilter(
  base: RevisionAuthorFilter | undefined,
  hidden: HiddenReviewSites,
  session: { reviewItems(): readonly ReviewItem[] }
): RevisionAuthorFilter | undefined {
  const before = leftOutBefore.get(session);
  if (hidden.sites.size > 0) {
    if (before?.key !== hidden.key)
      leftOutBefore.set(session, { key: hidden.key, checked: null, clear: false });
    return withHiddenRevisionSites(base, hidden);
  }
  if (!before) return base;
  const items = session.reviewItems();
  if (before.checked !== items) {
    before.checked = items;
    before.clear = !items.some(couldHide);
  }
  if (before.key === hidden.key && before.clear)
    return withHiddenRevisionSitesKey(base, before.key);
  leftOutBefore.delete(session);
  return base;
}

/**
 * `base` leaving out the records `session`'s queue has no card for, in the views that paint
 * markup. Other views paint none, so they keep `base` and its fast paths.
 */
export function withUnlistedRecords(
  base: RevisionAuthorFilter | undefined,
  view: ReviewDisplayMode,
  session: { reviewItems(): readonly ReviewItem[] }
): RevisionAuthorFilter | undefined {
  if (view === 'all-markup')
    return allMarkupFilter(base, hiddenReviewSitesOf(session.reviewItems()), session);
  return view === 'simple-markup'
    ? withHiddenRevisionSites(base, hiddenReviewSitesOf(session.reviewItems()), true)
    : base;
}

/**
 * The surface's revision filter: the reviewer filter for `session`, without the records its
 * queue leaves out, under the review view's own settings. Those records paint no markup, so
 * nothing on the page marks a change that has no card.
 */
export function surfaceRevisionFilter(
  reviewView: {
    filter(filter: RevisionAuthorFilter | undefined): RevisionAuthorFilter | undefined;
    view(): ReviewDisplayMode;
  },
  visibility: {
    filterForSession(session: {
      reviewItems(): readonly ReviewItem[];
    }): RevisionAuthorFilter | undefined;
  },
  session: { reviewItems(): readonly ReviewItem[] }
): RevisionAuthorFilter | undefined {
  return reviewView.filter(
    withUnlistedRecords(visibility.filterForSession(session), reviewView.view(), session)
  );
}
