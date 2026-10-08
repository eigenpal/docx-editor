/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import type { ReviewAuthorInfo } from '@docx-editor.dev/core/editor';
import type { ReviewPartProps } from './review-types.ts';
import type { ReviewItemView } from './useReview.ts';
import { COMPACT_CARD_WIDTH } from './use-rail-geometry.ts';
import { authorCardStyle } from './review-author-styles.ts';
import { SEND_ICON, icon } from './review-icons.tsx';
import { initialsOf } from './review-shared.ts';

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

  /** Draft state and submission for one reply line, held by whichever part owns it. */
  function useReplyDraft(entry: ReviewItemView | null) {
    const { review, readOnly } = deps.useRail();
    const [draft, setDraft] = useState('');
    const [refused, setRefused] = useState(false);
    const submit = useCallback(() => {
      if (!entry || readOnly || draft.trim().length === 0) return;
      const landed = review.reply(entry, draft.trim());
      setRefused(!landed);
      if (landed) setDraft('');
    }, [entry, readOnly, draft, review]);
    return { draft, setDraft, refused, setRefused, submit };
  }

  /**
   * The compact reply line the open card and the change balloon share: the configured
   * author's avatar, a borderless field, Cancel only while there is text, and a round send
   * button. Enter sends too.
   */
  function ReplyLine({
    state,
    className,
    onCancel,
  }: {
    readonly state: ReturnType<typeof useReplyDraft>;
    readonly className?: string;
    readonly onCancel?: () => void;
  }) {
    const { readOnly, draftAuthor, draftAuthorInfo, draftAuthorSlot } = deps.useRail();
    const t = deps.useLabel();
    const fieldId = useId();
    const { draft, setDraft, refused, setRefused, submit } = state;
    const avatarUrl = draftAuthorInfo?.style?.avatarUrl;
    return (
      <form
        className={`docx-review__reply-box${className ? ` ${className}` : ''}`}
        data-reply-line=""
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="docx-editor-sr-only" htmlFor={fieldId}>
          {t('comments.replyPlaceholder')}
        </label>
        {draftAuthor ? (
          <span
            className="docx-review__avatar docx-review__reply-avatar"
            data-testid="review-reply-avatar"
            aria-hidden="true"
            style={authorCardStyle(draftAuthor, draftAuthorInfo, draftAuthorSlot)}
          >
            {avatarUrl ? (
              <img
                className="docx-review__avatar-img"
                src={avatarUrl}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : (
              initialsOf(draftAuthor)
            )}
          </span>
        ) : null}
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
            // The first Escape clears a draft, so a stray key never loses it with the card or
            // balloon. On an empty line it closes the card; in a balloon it bubbles to the
            // balloon, which closes itself.
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
              if (draft.length > 0) {
                event.preventDefault();
                setDraft('');
                setRefused(false);
                return;
              }
              if (onCancel) {
                event.preventDefault();
                onCancel();
                return;
              }
            }
            if (readOnly || event.key !== 'Enter') return;
            event.preventDefault();
            submit();
          }}
        />
        {draft.length > 0 ? (
          <button
            type="button"
            data-testid="review-reply-cancel"
            className="docx-review__text-button"
            onMouseDown={deps.guardMousedown}
            onClick={(event) => {
              event.stopPropagation();
              setDraft('');
              setRefused(false);
              onCancel?.();
            }}
          >
            {t('common.cancel')}
          </button>
        ) : null}
        <button
          type="submit"
          data-testid="review-reply-submit"
          className="docx-review__send"
          aria-label={t('review.reply')}
          disabled={readOnly || draft.trim().length === 0}
          title={readOnly ? t('editingMode.viewingHint') : t('review.reply')}
        >
          {icon(SEND_ICON)}
        </button>
        {refused ? (
          <span className="docx-review__refused" role="alert" data-testid="review-reply-refused">
            {t('review.replyRefused')}
          </span>
        ) : null}
      </form>
    );
  }

  /** The reply box on the active card. @public */
  function ReviewReply({ className, hidden, children }: ReviewPartProps) {
    const { review } = deps.useRail();
    const entry = deps.useItem();
    // Held here, not in the line: the draft survives the card closing and reopening.
    const state = useReplyDraft(entry);
    if (hidden || !entry || !entry.isActive || (entry.kind === 'comment' && entry.resolved)) {
      return null;
    }
    if (children) return <>{children}</>;
    return (
      <ReplyLine state={state} className={className} onCancel={() => review.setActive(null)} />
    );
  }
  ReviewReply.docxReviewPart = 'Reply' as const;

  /** The change balloon's reply line. Open whenever the balloon is; not a rail part. */
  function ReviewBalloonReply({ entry }: { readonly entry: ReviewItemView }) {
    const state = useReplyDraft(entry);
    return <ReplyLine state={state} />;
  }

  return { ReviewDraft, ReviewReply, ReviewBalloonReply };
}
