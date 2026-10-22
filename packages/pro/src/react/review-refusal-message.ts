/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { useCallback } from 'react';
import { reviewRefusalMessage, type ReviewWriteRefusal } from '../review/review-refusal.ts';
import { useReviewLabel } from './review-context.ts';

/**
 * The packaged sentence for a refused review write, in the reader's language, for a host's own
 * card or balloon. It honors the review pane's `t` overrides, as the packaged cards do.
 *
 * @example
 * ```tsx
 * const { lastRefusal } = useReview();
 * const refusalMessage = useReviewRefusalMessage();
 * return lastRefusal?.key === item.key ? <p role="alert">{refusalMessage(lastRefusal)}</p> : null;
 * ```
 *
 * @public
 */
export function useReviewRefusalMessage(): (refusal: ReviewWriteRefusal) => string {
  const t = useReviewLabel();
  return useCallback((refusal: ReviewWriteRefusal) => reviewRefusalMessage(refusal, t), [t]);
}
