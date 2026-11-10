/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** @jsxImportSource vue */
import { defineComponent, nextTick, onBeforeUnmount, ref, watch, type PropType } from 'vue';
import { useDocxEditor } from '@docx-editor.dev/vue';
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
import { useReviewStableId } from './stable-id.ts';
import type { ReviewItemView } from './useReview.ts';

export const ReviewCommentActions = defineComponent({
  name: 'ReviewCommentActions',
  props: {
    entry: { type: Object as PropType<ReviewItemView>, required: true },
    hideDelete: Boolean,
  },
  setup(props) {
    const rail = useRail();
    const t = useReviewLabel();
    const editor = useDocxEditor();
    const open = ref(false);
    const root = ref<HTMLDivElement | null>(null);
    const panel = ref<HTMLDivElement | null>(null);
    const trigger = ref<HTMLButtonElement | null>(null);
    const id = useReviewStableId('comment-actions');
    let last = false;
    let unsubscribe: (() => void) | undefined;
    let dismiss: (() => void) | undefined;
    watch(
      () => [editor.value, props.entry.key] as const,
      ([current, key]) => {
        unsubscribe?.();
        if (!current) return;
        const drafts = commentEditDrafts(current);
        const restore = () => {
          void nextTick(() => {
            if (!drafts.get(key))
              restoreCommentActions(trigger.value, key, () => drafts.takeFocus(key));
          });
        };
        unsubscribe = drafts.subscribe(key, restore);
        restore();
      },
      { immediate: true }
    );
    watch(open, async (visible) => {
      dismiss?.();
      dismiss = undefined;
      if (!visible) return;
      await nextTick();
      if (!open.value || !root.value || !panel.value) return;
      positionCommentMenu(root.value, panel.value);
      const items = commentMenuItems(panel.value);
      (last ? items.at(-1) : items[0])?.focus({ preventScroll: true });
      dismiss = observeCommentMenu(root.value, () => {
        open.value = false;
      });
    });
    watch(
      () => rail.value.readOnly,
      (readOnly) => {
        if (readOnly) open.value = false;
      }
    );
    onBeforeUnmount(() => {
      unsubscribe?.();
      dismiss?.();
    });
    return () => {
      const entry = props.entry;
      const own = Boolean(rail.value.draftAuthor && rail.value.draftAuthor === entry.author);
      if (!own && props.hideDelete) return null;
      const label = t(
        entry.kind === 'comment' && entry.parentId !== undefined
          ? 'comments.replyActions'
          : 'comments.actions'
      );
      return (
        <div class="docx-review__comment-menu" ref={root}>
          <button
            ref={trigger}
            type="button"
            class="docx-review__action docx-review__comment-menu-trigger"
            data-testid="review-comment-actions"
            data-comment-key={entry.key}
            aria-label={label}
            title={rail.value.readOnly ? t('editingMode.viewingHint') : label}
            aria-haspopup="menu"
            aria-expanded={open.value}
            aria-controls={open.value ? id : undefined}
            disabled={rail.value.readOnly}
            onMousedown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              last = false;
              if (open.value) trigger.value?.focus({ preventScroll: true });
              open.value = !open.value;
            }}
            onKeydown={(event) => {
              event.stopPropagation();
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                last = event.key === 'ArrowUp';
                open.value = true;
              }
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="5" cy="12" r="2" fill="currentColor" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
              <circle cx="19" cy="12" r="2" fill="currentColor" />
            </svg>
          </button>
          {open.value ? (
            <div
              ref={panel}
              id={id}
              role="menu"
              aria-label={label}
              class="docx-review__comment-menu-panel"
              onKeydown={(event) => {
                if (panel.value && trigger.value)
                  commentMenuKey(event, panel.value, trigger.value, () => {
                    open.value = false;
                  });
              }}
              onMousedown={(event) => event.stopPropagation()}
            >
              {own ? (
                <button
                  type="button"
                  role="menuitem"
                  tabindex={-1}
                  class="docx-review__comment-menu-item"
                  data-testid="review-edit"
                  onClick={(event) => {
                    event.stopPropagation();
                    open.value = false;
                    if (!editor.value || rail.value.readOnly) return;
                    const drafts = commentEditDrafts(editor.value);
                    if (!drafts.get(entry.key))
                      drafts.set(entry.key, {
                        text: entry.text,
                        original: entry.text,
                        refused: false,
                      });
                    focusCommentDraft(root.value);
                  }}
                >
                  {t('comments.edit')}
                </button>
              ) : null}
              {!props.hideDelete ? (
                <button
                  type="button"
                  role="menuitem"
                  tabindex={-1}
                  class="docx-review__comment-menu-item"
                  data-destructive=""
                  data-testid="review-delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    open.value = false;
                    const restore = afterCommentDelete(trigger.value, () => {
                      editor.value?.focus();
                    });
                    if (!rail.value.readOnly) rail.value.review.remove(entry);
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
    };
  },
});
