// Review pane settings and the decision whether the pane opens by itself.
//
// Split out of `docx-editor.ts`, which is at its line cap. The settings are view state of
// one editor instance (see `contracts/review-pane.ts`): never saved, never shared.

import type { ExecResult } from '../contracts/editor.ts';
import {
  resolveReviewPane,
  type ResolvedReviewPane,
  type ReviewPaneOptions,
} from '../contracts/review-pane.ts';
import type { ReviewItem } from '../store/store/review-items.ts';
import { PRO_REVIEW_REASON } from './opening-editing-mode.ts';

export interface ReviewPaneState {
  /** The settings in force. The same reference until a setting changes. */
  current(): ResolvedReviewPane;
  /**
   * Merge `options`. Refused, and nothing changes, without a review module or for an
   * invalid setting.
   */
  set(options: ReviewPaneOptions): ExecResult;
  /** Whether the pane lists at least one of these items under the current settings. */
  shows(items: readonly ReviewItem[]): boolean;
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
  host: {
    readonly enabled: boolean;
    changed(value: ResolvedReviewPane, previous: ResolvedReviewPane): void;
  }
): ReviewPaneState {
  let value = resolveReviewPane(initial);
  return {
    current: () => value,
    set(options) {
      // Like every other review write: without the module there is no pane to configure.
      if (!host.enabled) return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
      let next: ResolvedReviewPane;
      try {
        next = resolveReviewPane(options, value);
      } catch (error) {
        return { ok: false, code: 'invalidArgs', reason: (error as Error).message };
      }
      // `changed` reports whether a setting moved, so a host can tell a no-op from a switch.
      if (next === value) return { ok: true, changed: false };
      const previous = value;
      value = next;
      host.changed(value, previous);
      return { ok: true, changed: true };
    },
    shows: (items) => items.some((item) => paneShows(value, item)),
    // An empty pane is not worth opening: under balloons a document with tracked changes
    // and no comments has nothing to list.
    opensOnLoad: (items) =>
      value.opening === 'auto' && items.some((item) => paneShows(value, item)),
    opensOnTrackedChange: () => value.opening === 'auto' && value.revisionsIn === 'pane',
  };
}
