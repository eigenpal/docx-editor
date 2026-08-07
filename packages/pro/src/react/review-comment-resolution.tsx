/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import type { MouseEvent as ReactMouseEvent } from 'react';
import { Slot } from '@docx-editor.dev/react';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { ACCEPT_ICON, REOPEN_ICON, icon } from './review-icons.tsx';
import type { ReviewActionProps } from './DocxEditorReview.tsx';
import type { ReviewItemView, UseReviewReturn } from './useReview.ts';

interface ResolutionPartDeps {
  readonly useReview: () => UseReviewReturn;
  readonly useItem: () => ReviewItemView | null;
  readonly useLabel: () => (key: TranslationKey) => string;
  readonly guardMousedown: (event: ReactMouseEvent) => void;
}

/** Build the two comment-state parts against the rail's private contexts. */
export function createCommentResolutionParts(deps: ResolutionPartDeps) {
  /** Resolve the comment thread behind this card. @public */
  function ReviewResolve({ className, asChild, hidden, children, icon: glyph }: ReviewActionProps) {
    const review = deps.useReview();
    const entry = deps.useItem();
    const t = deps.useLabel();
    if (hidden || !entry || entry.kind !== 'comment' || entry.resolved) return null;
    const label = t('comments.resolve');
    const disabledReason = review.commentResolutionDisabledReason;
    const shared = {
      type: 'button' as const,
      className: `docx-review__action${className ? ` ${className}` : ''}`,
      'data-testid': 'review-resolve',
      'aria-label': label,
      title: disabledReason ?? label,
      disabled: disabledReason !== null,
      onMouseDown: deps.guardMousedown,
      onClick: (event: ReactMouseEvent) => {
        event.stopPropagation();
        review.resolve(entry);
      },
    };
    if (asChild) return <Slot {...shared}>{children}</Slot>;
    return <button {...shared}>{glyph ?? children ?? icon(ACCEPT_ICON)}</button>;
  }
  ReviewResolve.docxReviewPart = 'Resolve' as const;

  /** Reopen the resolved comment thread behind this card. @public */
  function ReviewReopen({ className, asChild, hidden, children, icon: glyph }: ReviewActionProps) {
    const review = deps.useReview();
    const entry = deps.useItem();
    const t = deps.useLabel();
    if (hidden || !entry || entry.kind !== 'comment' || !entry.resolved) return null;
    const label = t('comments.reopen');
    const disabledReason = review.commentResolutionDisabledReason;
    const shared = {
      type: 'button' as const,
      className: `docx-review__action${className ? ` ${className}` : ''}`,
      'data-testid': 'review-reopen',
      'aria-label': label,
      title: disabledReason ?? label,
      disabled: disabledReason !== null,
      onMouseDown: deps.guardMousedown,
      onClick: (event: ReactMouseEvent) => {
        event.stopPropagation();
        review.reopen(entry);
      },
    };
    if (asChild) return <Slot {...shared}>{children}</Slot>;
    return <button {...shared}>{glyph ?? children ?? icon(REOPEN_ICON)}</button>;
  }
  ReviewReopen.docxReviewPart = 'Reopen' as const;

  return { ReviewResolve, ReviewReopen };
}
