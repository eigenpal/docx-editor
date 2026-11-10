/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** @jsxImportSource vue */
import {
  defineComponent,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  type PropType,
} from 'vue';
import { useDocxEditor } from '@docx-editor.dev/vue';
import { commentEditDrafts, type CommentEditDraft } from '../review/comment-edit-drafts.ts';
import type { ReviewItemView } from './useReview.ts';
import { useRail, useReviewLabel } from './review-context.ts';
import { useReviewStableId } from './stable-id.ts';

export const ReviewCommentText = defineComponent({
  name: 'ReviewCommentText',
  props: { entry: { type: Object as PropType<ReviewItemView>, required: true } },
  setup(props) {
    const rail = useRail();
    const t = useReviewLabel();
    const id = useReviewStableId('comment-edit');
    const field = ref<HTMLTextAreaElement | null>(null);
    const editor = useDocxEditor();
    const state = shallowRef<CommentEditDraft | null>(null);
    let unsubscribe: (() => void) | undefined;
    watch(
      () => [editor.value, props.entry.key] as const,
      ([current, key]) => {
        unsubscribe?.();
        const store = current ? commentEditDrafts(current) : null;
        const update = () => {
          state.value = store?.get(key) ?? null;
        };
        update();
        unsubscribe = store?.subscribe(key, update);
      },
      { immediate: true }
    );
    onBeforeUnmount(() => unsubscribe?.());
    const set = (value: CommentEditDraft | null) => {
      if (editor.value) commentEditDrafts(editor.value).set(props.entry.key, value);
    };
    watch(
      () => state.value !== null,
      (editing) => {
        if (editing) void nextTick(() => field.value?.focus({ preventScroll: true }));
      },
      { immediate: true }
    );
    const own = () =>
      Boolean(rail.value.draftAuthor && rail.value.draftAuthor === props.entry.author);
    const stale = () => state.value !== null && props.entry.text !== (state.value?.original ?? '');
    const disabled = () =>
      rail.value.readOnly ||
      !own() ||
      stale() ||
      (state.value?.text ?? '').trim().length === 0 ||
      (state.value?.text ?? '') === (state.value?.original ?? '');
    const close = () => {
      if (editor.value) commentEditDrafts(editor.value).requestFocus(props.entry.key);
      set(null);
    };
    const submit = () => {
      if (disabled()) return;
      const landed = rail.value.review.edit(
        props.entry,
        state.value?.text ?? '',
        state.value?.original ?? ''
      );
      if (landed) close();
      else if (state.value) set({ ...state.value, refused: true });
    };
    return () => {
      const entry = props.entry;
      if (state.value === null) return <span class="docx-review__text">{entry.text}</span>;
      const empty = (state.value?.text ?? '').trim().length === 0;
      const message = stale()
        ? t('comments.editConflict')
        : !own()
          ? t('comments.editPermission')
          : rail.value.readOnly
            ? t('editingMode.viewingHint')
            : (state.value?.refused ?? false)
              ? t('comments.editRefused')
              : empty
                ? t('comments.editEmpty')
                : null;
      return (
        <form
          class="docx-review__edit"
          data-testid="review-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            submit();
          }}
        >
          <label class="docx-editor-sr-only" for={id}>
            {t('comments.editText')}
          </label>
          <textarea
            id={id}
            ref={field}
            class="docx-review__edit-input"
            data-testid="review-edit-input"
            rows={3}
            value={state.value?.text ?? ''}
            readonly={rail.value.readOnly || !own()}
            aria-describedby={message ? `${id}-error` : undefined}
            aria-invalid={empty || stale() || (state.value?.refused ?? false) || undefined}
            onInput={(event) => {
              if (state.value)
                set({
                  ...state.value,
                  text: (event.target as HTMLTextAreaElement).value,
                  refused: false,
                });
            }}
            onKeydown={(event) => {
              event.stopPropagation();
              if (event.isComposing || event.keyCode === 229) return;
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
            <p id={`${id}-error`} role="status" class="docx-review__refused">
              {message}
            </p>
          ) : null}
          <div class="docx-review__reply-actions">
            <button
              type="button"
              class="docx-review__text-button"
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
              class="docx-review__text-button docx-review__submit"
              disabled={disabled()}
            >
              {t('comments.saveEdit')}
            </button>
          </div>
        </form>
      );
    };
  },
});
