/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import type { ComponentPropsWithoutRef, MouseEvent as ReactMouseEvent } from 'react';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { ACCEPT_ICON, COMMENT_OUTLINE_ICON, REOPEN_ICON, icon } from './review-icons.tsx';
import type { ReviewActionProps } from './DocxEditorReview.tsx';
import type { ReviewItemView, UseReviewReturn } from './useReview.ts';
import { ReviewActionSlot } from './review-action-slot.tsx';

interface ResolutionPartDeps {
  readonly useReview: () => UseReviewReturn;
  readonly useItem: () => ReviewItemView | null;
  readonly useLabel: () => (key: TranslationKey) => string;
  readonly guardMousedown: (event: ReactMouseEvent) => void;
}

interface ResolvedCommentCardProps extends ComponentPropsWithoutRef<'details'> {
  readonly label: string;
}

/** Native disclosure wrapper for a resolved comment icon with a green check. */
export function ResolvedCommentCard({ label, children, ...props }: ResolvedCommentCardProps) {
  return (
    <details {...props}>
      <summary className="docx-review__resolved-toggle" aria-label={label}>
        <span className="docx-review__resolved-icon">
          <span className="docx-review__resolved-comment">{icon(COMMENT_OUTLINE_ICON)}</span>
          <span className="docx-review__resolved-tick">{icon(ACCEPT_ICON)}</span>
        </span>
      </summary>
      {children}
    </details>
  );
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
    const engineDisabled = review.commentResolutionDisabledReason !== null;
    const disabledReason = engineDisabled ? t('editingMode.viewingHint') : null;
    const shared = {
      type: 'button' as const,
      className: `docx-review__action${className ? ` ${className}` : ''}`,
      'data-testid': 'review-resolve',
      'aria-label': label,
      title: disabledReason ?? label,
      disabled: engineDisabled,
      onMouseDown: deps.guardMousedown,
      onClick: (event: ReactMouseEvent) => {
        event.stopPropagation();
        if (engineDisabled) return;
        review.resolve(entry);
      },
    };
    if (asChild) {
      return (
        <ReviewActionSlot
          engineDisabled={engineDisabled}
          disabledReason={disabledReason}
          slotProps={shared}
        >
          {children}
        </ReviewActionSlot>
      );
    }
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
    const engineDisabled = review.commentResolutionDisabledReason !== null;
    const disabledReason = engineDisabled ? t('editingMode.viewingHint') : null;
    const shared = {
      type: 'button' as const,
      className: `docx-review__action${className ? ` ${className}` : ''}`,
      'data-testid': 'review-reopen',
      'aria-label': label,
      title: disabledReason ?? label,
      disabled: engineDisabled,
      onMouseDown: deps.guardMousedown,
      onClick: (event: ReactMouseEvent) => {
        event.stopPropagation();
        if (engineDisabled) return;
        review.reopen(entry);
      },
    };
    if (asChild) {
      return (
        <ReviewActionSlot
          engineDisabled={engineDisabled}
          disabledReason={disabledReason}
          slotProps={shared}
        >
          {children}
        </ReviewActionSlot>
      );
    }
    return <button {...shared}>{glyph ?? children ?? icon(REOPEN_ICON)}</button>;
  }
  ReviewReopen.docxReviewPart = 'Reopen' as const;

  return { ReviewResolve, ReviewReopen };
}
