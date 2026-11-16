/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { useEffect, useId, useRef, useState } from 'react';
import { useDocxEditor } from '@docx-editor.dev/react';
import { commentEditDrafts } from '../review/comment-edit-drafts.ts';
import {
  afterCommentDelete,
  restoreCommentActions,
  focusCommentDraft,
  positionCommentMenu,
  commentMenuItems,
  commentMenuKey,
  observeCommentMenu,
} from '../review/comment-actions-menu.ts';
import { useRail, useReviewLabel } from './review-context.ts';
import type { ReviewItemView } from './useReview.ts';

export function ReviewCommentActions({
  entry,
  hideDelete = false,
}: {
  readonly entry: ReviewItemView;
  readonly hideDelete?: boolean;
}) {
  const rail = useRail();
  const t = useReviewLabel();
  const editor = useDocxEditor();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const last = useRef(false);
  const id = useId();
  const own = Boolean(rail.draftAuthor && rail.draftAuthor === entry.author);
  const label = t(
    entry.kind === 'comment' && entry.parentId !== undefined
      ? 'comments.replyActions'
      : 'comments.actions'
  );
  useEffect(() => {
    if (!editor) return;
    const drafts = commentEditDrafts(editor);
    const restore = () => {
      if (!drafts.get(entry.key))
        restoreCommentActions(trigger.current, entry.key, () => drafts.takeFocus(entry.key));
    };
    restore();
    return drafts.subscribe(entry.key, restore);
  }, [editor, entry.key]);
  useEffect(() => {
    if (!open || !root.current || !panel.current) return;
    positionCommentMenu(root.current, panel.current);
    const items = commentMenuItems(panel.current);
    (last.current ? items.at(-1) : items[0])?.focus({ preventScroll: true });
    return observeCommentMenu(root.current, () => setOpen(false));
  }, [open]);
  useEffect(() => {
    if (rail.readOnly) setOpen(false);
  }, [rail.readOnly]);
  if (!own && hideDelete) return null;
  return (
    <div className="docx-review__comment-menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="docx-review__action docx-review__comment-menu-trigger"
        data-testid="review-comment-actions"
        data-comment-key={entry.key}
        aria-label={label}
        title={rail.readOnly ? t('editingMode.viewingHint') : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={rail.readOnly}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          last.current = false;
          if (open) trigger.current?.focus({ preventScroll: true });
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            last.current = event.key === 'ArrowUp';
            setOpen(true);
          }
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="5" cy="12" r="2" fill="currentColor" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <circle cx="19" cy="12" r="2" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <div
          ref={panel}
          id={id}
          role="menu"
          aria-label={label}
          className="docx-review__comment-menu-panel"
          onKeyDown={(event) => {
            if (panel.current && trigger.current)
              commentMenuKey(event, panel.current, trigger.current, () => setOpen(false));
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {own ? (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="docx-review__comment-menu-item"
              data-testid="review-edit"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                if (!editor || rail.readOnly) return;
                const drafts = commentEditDrafts(editor);
                if (!drafts.get(entry.key))
                  drafts.set(entry.key, { text: entry.text, original: entry.text, refused: false });
                focusCommentDraft(root.current);
              }}
            >
              {t('comments.edit')}
            </button>
          ) : null}
          {!hideDelete ? (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="docx-review__comment-menu-item"
              data-destructive=""
              data-testid="review-delete"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                const restore = afterCommentDelete(trigger.current, () => {
                  editor?.focus();
                });
                if (!rail.readOnly) rail.review.remove(entry);
                restore();
              }}
            >
              {t('comments.delete')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
