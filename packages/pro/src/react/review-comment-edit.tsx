/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { useDocxEditor } from '@docx-editor.dev/react';
import { commentEditDrafts } from '../review/comment-edit-drafts.ts';
import type { ReviewItemView } from './useReview.ts';
import { useRail, useReviewLabel } from './review-context.ts';

/** The default summary keeps the edit beside the text, including replies and resolved threads. */
export function ReviewCommentText({ entry }: { readonly entry: ReviewItemView }) {
  const rail = useRail();
  const t = useReviewLabel();
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const editor = useDocxEditor();
  const store = editor ? commentEditDrafts(editor) : null;
  const subscribe = useCallback(
    (notify: () => void) => store?.subscribe(entry.key, notify) ?? (() => {}),
    [store, entry.key]
  );
  const get = useCallback(() => store?.get(entry.key) ?? null, [store, entry.key]);
  const state = useSyncExternalStore(subscribe, get, get);
  const editing = state !== null;
  const draft = state?.text ?? '';
  const original = state?.original ?? '';
  const refused = state?.refused ?? false;
  const own = Boolean(rail.draftAuthor && rail.draftAuthor === entry.author);
  const stale = editing && entry.text !== original;
  const empty = draft.trim().length === 0;
  const disabled = rail.readOnly || !own || stale || empty || draft === original;
  useEffect(() => {
    if (editing) {
      field.current?.focus({ preventScroll: true });
      field.current?.setSelectionRange(draft.length, draft.length);
    }
    // Focus follows opening and closing, never each keystroke or a remote update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const close = () => {
    store?.requestFocus(entry.key);
    store?.set(entry.key, null);
  };
  const submit = () => {
    if (disabled) return;
    const landed = rail.review.edit(entry, draft, original);
    if (landed) close();
    else if (state) store?.set(entry.key, { ...state, refused: true });
  };
  if (!editing) return <span className="docx-review__text">{entry.text}</span>;
  const message = stale
    ? t('comments.editConflict')
    : !own
      ? t('comments.editPermission')
      : rail.readOnly
        ? t('editingMode.viewingHint')
        : refused
          ? t('comments.editRefused')
          : empty
            ? t('comments.editEmpty')
            : null;
  return (
    <form
      className="docx-review__edit"
      data-testid="review-edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        submit();
      }}
    >
      <label className="docx-editor-sr-only" htmlFor={id}>
        {t('comments.editText')}
      </label>
      <textarea
        id={id}
        ref={field}
        className="docx-review__edit-input"
        data-testid="review-edit-input"
        rows={3}
        value={draft}
        readOnly={rail.readOnly || !own}
        aria-describedby={message ? `${id}-error` : undefined}
        aria-invalid={empty || stale || refused || undefined}
        onChange={(event) => {
          if (state)
            store?.set(entry.key, { ...state, text: event.currentTarget.value, refused: false });
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      {message ? (
        <p id={`${id}-error`} role="status" className="docx-review__refused">
          {message}
        </p>
      ) : null}
      <div className="docx-review__reply-actions">
        <button
          type="button"
          className="docx-review__text-button"
          onClick={(event) => {
            event.stopPropagation();
            close();
          }}
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          onClick={(event) => event.stopPropagation()}
          className="docx-review__text-button docx-review__submit"
          disabled={disabled}
        >
          {t('comments.saveEdit')}
        </button>
      </div>
    </form>
  );
}
