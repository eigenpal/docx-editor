/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import type { ReviewAuthorInfo } from '@docx-editor.dev/core/editor';
import type { ReviewPartProps } from './DocxEditorReview.tsx';
import type { ReviewItemView } from './useReview.ts';
import { COMPACT_CARD_WIDTH } from './use-rail-geometry.ts';
import { authorCardStyle } from './review-author-styles.ts';

interface ComposePartDeps {
  readonly useRail: () => {
    readonly review: {
      readonly comment: (text: string, author?: string) => boolean;
      readonly reply: (item: ReviewItemView, text: string, author?: string) => boolean;
      readonly setActive: (key: string | null) => boolean;
    };
    readonly endDraft: () => void;
    readonly measure: (node: HTMLElement | null, key: string) => void;
    readonly readOnly: boolean;
    readonly draftAuthor: string | null;
    readonly draftAuthorInfo: ReviewAuthorInfo | undefined;
    readonly draftAuthorSlot: number;
  };
  readonly useItem: () => ReviewItemView | null;
  readonly useLabel: () => (key: TranslationKey) => string;
  readonly guardMousedown: (event: ReactMouseEvent) => void;
  readonly composeKey: string;
}

/** Build the draft and reply compose boxes against the rail's private contexts. */
export function createReviewComposeParts(deps: ComposePartDeps) {
  /** The compose box for a new comment. @public */
  function ReviewDraft({
    top = 0,
    left = null,
    className,
    hidden,
  }: ReviewPartProps & {
    top?: number;
    /**
     * Rail-local `left` for the COMPACT rail, where the strip is 32px wide and a box laid
     * out at column width would be cut by the viewport's edge. Null keeps the box in the
     * rail's own column, which is right whenever the column exists.
     */
    left?: number | null;
  }) {
    const { review, endDraft, measure, readOnly, draftAuthor, draftAuthorInfo, draftAuthorSlot } =
      deps.useRail();
    const t = deps.useLabel();
    const [text, setText] = useState('');
    const [refused, setRefused] = useState(false);
    const fieldRef = useRef<HTMLInputElement | null>(null);
    const fieldId = useId();

    // Mount-only: focus when a new draft opens in an editable document. Mode toggles keep the
    // same compose instance mounted, so this must not track `readOnly` or returning to editing
    // steals focus from the toolbar, a reply box, or the document.
    useEffect(() => {
      if (readOnly) return;
      fieldRef.current?.focus({ preventScroll: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps -- open identity, not mode transitions
    }, []);

    const submit = useCallback(() => {
      if (readOnly || text.trim().length === 0) return;
      const landed = review.comment(text.trim());
      setRefused(!landed);
      if (landed) {
        setText('');
        endDraft();
      }
    }, [readOnly, text, review, endDraft]);

    if (hidden) return null;
    return (
      <div
        className={`docx-review__slot${className ? ` ${className}` : ''}${left === null ? '' : ' docx-review__slot--compact'}`}
        style={{
          position: 'absolute',
          top,
          ...(left === null ? {} : { left, width: COMPACT_CARD_WIDTH }),
        }}
        ref={(node) => {
          measure(node, deps.composeKey);
        }}
      >
        <div
          className="docx-review__card"
          data-testid="review-draft"
          data-draft=""
          {...(draftAuthor
            ? {
                'data-review-author': draftAuthor,
                'data-review-author-slot': draftAuthorSlot,
              }
            : {})}
          style={authorCardStyle(draftAuthor ?? undefined, draftAuthorInfo, draftAuthorSlot)}
        >
          <form
            className="docx-review__reply-box"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label className="docx-editor-sr-only" htmlFor={fieldId}>
              {t('comments.addComment')}
            </label>
            <input
              id={fieldId}
              ref={fieldRef}
              data-testid="review-draft-input"
              className="docx-review__input"
              value={text}
              placeholder={t('comments.addComment')}
              readOnly={readOnly}
              {...(refused ? { 'aria-invalid': true } : {})}
              onChange={(event) => {
                if (readOnly) return;
                setRefused(false);
                setText(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  endDraft();
                  return;
                }
                if (readOnly || event.key !== 'Enter') return;
                event.preventDefault();
                submit();
              }}
            />
            <div className="docx-review__reply-actions">
              <button
                type="button"
                data-testid="review-draft-cancel"
                className="docx-review__text-button"
                onMouseDown={deps.guardMousedown}
                onClick={endDraft}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                data-testid="review-draft-submit"
                className="docx-review__submit"
                disabled={readOnly || text.trim().length === 0}
                title={readOnly ? t('editingMode.viewingHint') : undefined}
              >
                {t('common.comment')}
              </button>
            </div>
            {refused ? (
              <span className="docx-review__refused" role="alert">
                {t('review.commentRefused')}
              </span>
            ) : null}
          </form>
        </div>
      </div>
    );
  }
  ReviewDraft.docxReviewPart = 'Draft' as const;

  /** The reply box on the active card. @public */
  function ReviewReply({ className, hidden, children }: ReviewPartProps) {
    const { review, readOnly } = deps.useRail();
    const entry = deps.useItem();
    const t = deps.useLabel();
    const [draft, setDraft] = useState('');
    const [refused, setRefused] = useState(false);
    const fieldId = useId();

    const submit = useCallback(() => {
      if (!entry || readOnly || draft.trim().length === 0) return;
      const landed = review.reply(entry, draft.trim());
      setRefused(!landed);
      if (landed) setDraft('');
    }, [entry, readOnly, draft, review]);

    if (hidden || !entry || !entry.isActive) return null;
    if (children) return <>{children}</>;

    return (
      <form
        className={`docx-review__reply-box${className ? ` ${className}` : ''}`}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="docx-editor-sr-only" htmlFor={fieldId}>
          {t('comments.replyPlaceholder')}
        </label>
        <input
          id={fieldId}
          data-testid="review-reply-input"
          className="docx-review__input"
          value={draft}
          placeholder={t('comments.replyPlaceholder')}
          readOnly={readOnly}
          {...(refused ? { 'aria-invalid': true, 'data-refused': '' } : {})}
          onChange={(event) => {
            if (readOnly) return;
            setRefused(false);
            setDraft(event.target.value);
          }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (readOnly || event.key !== 'Enter') return;
            event.preventDefault();
            submit();
          }}
        />
        <div className="docx-review__reply-actions">
          <button
            type="button"
            data-testid="review-reply-cancel"
            className="docx-review__text-button"
            onMouseDown={deps.guardMousedown}
            onClick={(event) => {
              event.stopPropagation();
              setDraft('');
              setRefused(false);
              review.setActive(null);
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            data-testid="review-reply-submit"
            className="docx-review__submit"
            disabled={readOnly || draft.trim().length === 0}
            title={readOnly ? t('editingMode.viewingHint') : undefined}
          >
            {t('review.reply')}
          </button>
        </div>
        {refused ? (
          <span className="docx-review__refused" role="alert" data-testid="review-reply-refused">
            {t('review.replyRefused')}
          </span>
        ) : null}
      </form>
    );
  }
  ReviewReply.docxReviewPart = 'Reply' as const;

  return { ReviewDraft, ReviewReply };
}
