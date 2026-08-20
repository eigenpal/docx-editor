/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { ACCEPT_ICON, REOPEN_ICON, icon, resolvedCommentIcon } from './review-icons.tsx';
import type { ReviewActionProps } from './DocxEditorReview.tsx';
import type { ReviewItemView, UseReviewReturn } from './useReview.ts';
import { ReviewActionSlot } from './review-action-slot.tsx';

interface ResolutionPartDeps {
  readonly useReview: () => UseReviewReturn;
  readonly useItem: () => ReviewItemView | null;
  readonly useLabel: () => (key: TranslationKey) => string;
  readonly guardMousedown: (event: ReactMouseEvent) => void;
}

interface ResolvedEntry {
  readonly key: string;
  readonly kind: string;
  readonly resolved?: boolean;
}

interface ResolvedDisclosureValue {
  readonly key: string | null;
  readonly open: (key: string) => void;
  readonly close: () => void;
}

const ResolvedDisclosureContext = createContext<ResolvedDisclosureValue>({
  key: null,
  open: () => {},
  close: () => {},
});

export function ResolvedDisclosureProvider({
  items,
  children,
}: {
  readonly items: readonly ResolvedEntry[];
  readonly children: ReactNode;
}) {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    if (
      key !== null &&
      !items.some((entry) => entry.key === key && entry.kind === 'comment' && entry.resolved)
    ) {
      setKey(null);
    }
  }, [items, key]);
  const value = useMemo(
    () => ({ key, open: (next: string) => setKey(next), close: () => setKey(null) }),
    [key]
  );
  return (
    <ResolvedDisclosureContext.Provider value={value}>
      {children}
    </ResolvedDisclosureContext.Provider>
  );
}

export function useResolvedDisclosure(): ResolvedDisclosureValue {
  return useContext(ResolvedDisclosureContext);
}

interface ResolvedCommentCardProps extends ComponentPropsWithoutRef<'details'> {
  readonly label: string;
  readonly statusLabel: string;
  readonly entryKey: string;
  readonly onActivate: () => void;
  readonly onDeactivate: () => void;
}

/** Native disclosure wrapper for a resolved comment icon with a green check. */
export function ResolvedCommentCard({
  label,
  statusLabel,
  entryKey,
  onActivate,
  onDeactivate,
  children,
  ...props
}: ResolvedCommentCardProps) {
  const disclosure = useResolvedDisclosure();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        disclosure.close();
        onDeactivate();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [disclosure, onDeactivate]);

  return (
    <details
      ref={detailsRef}
      {...props}
      open={disclosure.key === entryKey}
      onToggle={(event) => {
        if (event.currentTarget.open) {
          disclosure.open(entryKey);
          onActivate();
        } else {
          disclosure.close();
          onDeactivate();
        }
      }}
    >
      <summary className="docx-review__resolved-toggle" aria-label={label}>
        <span className="docx-review__resolved-status">{statusLabel}</span>
        {resolvedCommentIcon()}
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
