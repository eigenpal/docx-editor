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
  /** Whether a loaded document with these items opens the pane by itself. */
  opensOnLoad(items: readonly ReviewItem[]): boolean;
  /** Whether a new tracked change opens a closed pane by itself. */
  opensOnTrackedChange(): boolean;
}

export function createReviewPaneState(
  initial: ReviewPaneOptions | undefined,
  host: { readonly enabled: boolean; changed(value: ResolvedReviewPane): void }
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
      // `changed: false`, as for every view-only call: `changed` answers for the document.
      if (next === value) return { ok: true, changed: false };
      value = next;
      host.changed(value);
      return { ok: true, changed: false };
    },
    opensOnLoad: (items) => value.opening === 'auto' && items.length > 0,
    opensOnTrackedChange: () => value.opening === 'auto',
  };
}
