/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { reviewRefusalMessage, type ReviewWriteRefusal } from '../review/review-refusal.ts';
import { useReviewLabel } from './review-context.ts';

/**
 * The function {@link useReviewRefusalMessage} returns: the packaged sentence for a refusal.
 *
 * @public
 */
export interface UseReviewRefusalMessageReturn {
  (refusal: ReviewWriteRefusal): string;
}

/**
 * The packaged sentence for a refused review write, in the reader's language, for a host's own
 * card or balloon. It honors the review pane's `t` overrides, as the packaged cards do. Call it
 * in `setup`.
 *
 * @example
 * ```ts
 * const { lastRefusal } = useReview();
 * const refusalMessage = useReviewRefusalMessage();
 * const notice = computed(() => (lastRefusal.value ? refusalMessage(lastRefusal.value) : ''));
 * ```
 *
 * @public
 */
export function useReviewRefusalMessage(): UseReviewRefusalMessageReturn {
  const t = useReviewLabel();
  return (refusal: ReviewWriteRefusal) => reviewRefusalMessage(refusal, t);
}
