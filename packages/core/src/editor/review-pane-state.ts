// Review pane settings and the decision whether the pane opens by itself.
//
// Split out of `docx-editor.ts`, which is at its line cap. The settings are view state of
// one editor instance (see `contracts/review-pane.ts`): never saved, never shared.

import {
  resolveReviewPane,
  type ResolvedReviewPane,
  type ReviewPaneOptions,
} from '../contracts/review-pane.ts';
import type { ReviewItem } from '../store/store/review-items.ts';

export interface ReviewPaneState {
  /** The settings in force. The same reference until a setting changes. */
  current(): ResolvedReviewPane;
  /** Merge `options`. Throws a `TypeError` for an invalid setting and changes nothing. */
  set(options: ReviewPaneOptions): void;
  /** Whether a loaded document with these items opens the pane by itself. */
  opensOnLoad(items: readonly ReviewItem[]): boolean;
  /** Whether a new tracked change opens a closed pane by itself. */
  opensOnTrackedChange(): boolean;
}

/**
 * Whether the pane shows a card for this item. With `revisionsIn: 'balloons'` the pane
 * lists comments and custom cards only; tracked changes open in balloons.
 */
function paneShows(pane: ResolvedReviewPane, item: ReviewItem): boolean {
  return pane.revisionsIn === 'pane' || item.kind !== 'revision';
}

export function createReviewPaneState(
  initial: ReviewPaneOptions | undefined,
  host: { changed(value: ResolvedReviewPane): void }
): ReviewPaneState {
  let value = resolveReviewPane(initial);
  return {
    current: () => value,
    set(options) {
      const next = resolveReviewPane(options, value);
      if (next === value) return;
      value = next;
      host.changed(value);
    },
    // An empty pane is not worth opening: under balloons a document with tracked changes
    // and no comments has nothing to list.
    opensOnLoad: (items) =>
      value.opening === 'auto' && items.some((item) => paneShows(value, item)),
    opensOnTrackedChange: () => value.opening === 'auto' && value.revisionsIn === 'pane',
  };
}
