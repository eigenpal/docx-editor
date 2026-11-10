/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { useCallback, useSyncExternalStore } from 'react';
import { useDocxEditor } from '@docx-editor.dev/react';
import { commentEditDrafts, type CommentEditDraft } from '../review/comment-edit-drafts.ts';
import { useRail, useReviewLabel } from './review-context.ts';
const EMPTY: readonly (readonly [string, CommentEditDraft])[] = [];

/** A removed target must not take an unsaved draft away with its virtualized card. */
export function ReviewCommentRecovery() {
  const editor = useDocxEditor();
  const rail = useRail();
  const t = useReviewLabel();
  const store = editor ? commentEditDrafts(editor) : null;
  const subscribe = useCallback(
    (notify: () => void) => store?.subscribeAll(notify) ?? (() => {}),
    [store]
  );
  const get = useCallback(() => store?.all() ?? EMPTY, [store]);
  const drafts = useSyncExternalStore(subscribe, get, get);
  const missing = drafts.filter(([key]) => !rail.allItems.some((item) => item.key === key));
  if (missing.length === 0) return null;
  return (
    <section
      className="docx-review__draft-recovery"
      aria-label={t('comments.recoveredDraft')}
      data-testid="review-draft-recovery"
    >
      <p role="status">{t('comments.deletedDraft')}</p>
      {missing.map(([key, draft]) => (
        <div key={key}>
          <textarea
            className="docx-review__edit-input"
            readOnly
            aria-label={t('comments.recoveredDraft')}
            value={draft.text}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <button
            type="button"
            className="docx-review__text-button"
            onClick={() => store?.set(key, null)}
          >
            {t('comments.discardDraft')}
          </button>
        </div>
      ))}
    </section>
  );
}
