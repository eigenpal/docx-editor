// The surface's revision filter with the records the review queue leaves out.

import { hiddenReviewSitesOf, type HiddenReviewSites } from '../binding/review-item-filter.ts';
import type { ReviewDisplayMode } from '../contracts/editor.ts';
import {
  withHiddenRevisionSites,
  withHiddenRevisionSitesKey,
} from '../layout/revision-hidden-sites.ts';
import type { RevisionAuthorFilter } from '../layout/revision-projection.ts';
import type { ReviewItem } from '../store/store/review-items.ts';

/**
 * For each session, the styles and numbering key of its last All Markup queue that left
 * records out.
 *
 * Only All Markup records it, because only its filter key can outlive the records. The Simple
 * Markup key also names the records each paragraph holds, so it changes with every change of
 * them, and that view shares no cached block with All Markup. Its filter can go back to the
 * plain one at no risk.
 */
const leftOutKeys = new WeakMap<object, string>();

/**
 * The All Markup filter for a queue that leaves `hidden` out.
 *
 * A queue that leaves records out keys its filter by the styles and numbering they were
 * decided against. The filter keeps that key after the last record goes, as when every change
 * is accepted, for as long as the styles and numbering stay the same. The layout caches then
 * keep every block that did not change, where a new key would lay the whole document out
 * again.
 *
 * This is safe because, in this view, a left-out record changes one thing: its paragraph
 * projects to another block object, without the record. Each layout cache under the key holds
 * a block by that object or by its content, and a story's list of blocks is built again when
 * the left-out records change. So an entry for the paragraph itself always shows the record,
 * and an entry for the block without it never does. A record can get a card or lose it under
 * one key, and no entry is wrong.
 *
 * A change of the styles or the numbering ends the kept key, and the plain filter lays the
 * document out once. A styles change lays every paragraph out under any key, so nothing is
 * lost there. A numbering change alone lays out only the list paragraphs under the plain key,
 * so the first one after a kept key costs the full layout that the accept did not.
 */
function allMarkupFilter(
  base: RevisionAuthorFilter | undefined,
  hidden: HiddenReviewSites,
  session: object
): RevisionAuthorFilter | undefined {
  if (hidden.sites.size > 0) {
    leftOutKeys.set(session, hidden.key);
    return withHiddenRevisionSites(base, hidden);
  }
  if (leftOutKeys.get(session) === hidden.key) return withHiddenRevisionSitesKey(base, hidden.key);
  leftOutKeys.delete(session);
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
