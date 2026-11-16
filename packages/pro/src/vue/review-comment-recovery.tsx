/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** @jsxImportSource vue */
import { defineComponent, onBeforeUnmount, shallowRef, watch } from 'vue';
import { useDocxEditor } from '@docx-editor.dev/vue';
import { commentEditDrafts, type CommentEditDraft } from '../review/comment-edit-drafts.ts';
import { useRail, useReviewLabel } from './review-context.ts';

export const ReviewCommentRecovery = defineComponent({
  name: 'ReviewCommentRecovery',
  setup() {
    const editor = useDocxEditor();
    const rail = useRail();
    const t = useReviewLabel();
    const drafts = shallowRef<readonly (readonly [string, CommentEditDraft])[]>([]);
    let unsubscribe: (() => void) | undefined;
    watch(
      editor,
      (current) => {
        unsubscribe?.();
        const store = current ? commentEditDrafts(current) : null;
        const update = () => {
          drafts.value = store?.all() ?? [];
        };
        update();
        unsubscribe = store?.subscribeAll(update);
      },
      { immediate: true }
    );
    onBeforeUnmount(() => unsubscribe?.());
    return () => {
      const missing = drafts.value.filter(
        ([key]) => !rail.value.allItems.some((item) => item.key === key)
      );
      if (missing.length === 0) return null;
      return (
        <section
          class="docx-review__draft-recovery"
          aria-label={t('comments.recoveredDraft')}
          data-testid="review-draft-recovery"
        >
          <p role="status">{t('comments.deletedDraft')}</p>
          {missing.map(([key, draft]) => (
            <div key={key}>
              <textarea
                class="docx-review__edit-input"
                readonly
                aria-label={t('comments.recoveredDraft')}
                value={draft.text}
                onKeydown={(event) => event.stopPropagation()}
              />
              <button
                type="button"
                class="docx-review__text-button"
                onClick={() => {
                  if (editor.value) commentEditDrafts(editor.value).set(key, null);
                }}
              >
                {t('comments.discardDraft')}
              </button>
            </div>
          ))}
        </section>
      );
    };
  },
});
