/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import {
  defineComponent,
  getCurrentInstance,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  type ComputedRef,
  type PropType,
} from 'vue';
import { useDocxEditor } from '@docx-editor.dev/vue';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import type { ReviewRailValue } from './review-context.ts';
import type { ReviewItemView } from './useReview.ts';
import { useReviewStableId } from './stable-id.ts';
import { useEditorRenderRevision } from './useEditorRenderRevision.ts';
import { COMPACT_CARD_WIDTH, COMPOSE_KEY, guardMousedown, markPart } from './review-shared.ts';
import { authorCardStyle } from './review-author-styles.ts';

interface ComposePartDeps {
  readonly useRail: () => ComputedRef<ReviewRailValue>;
  readonly useItem: () => ComputedRef<ReviewItemView | null>;
  readonly useLabel: () => (key: TranslationKey) => string;
}

/** Build the draft and reply compose boxes against the rail's private contexts. */
export function createReviewComposeParts(deps: ComposePartDeps) {
  const ReviewDraft = markPart(
    defineComponent({
      name: 'ReviewDraft',
      props: {
        top: { type: Number, default: 0 },
        left: { type: Number as PropType<number | null>, default: null },
        className: String,
        hidden: Boolean,
      },
      setup(props) {
        const rail = deps.useRail();
        const t = deps.useLabel();
        const text = ref('');
        const refused = ref(false);
        const fieldId = useReviewStableId('draft');
        let measuredBy: ReviewRailValue['measure'] | null = null;

        onMounted(() => {
          const root = getCurrentInstance()?.proxy?.$el;
          if (root instanceof HTMLElement) {
            measuredBy = rail.value.measure;
            measuredBy(root, COMPOSE_KEY);
          }
          if (rail.value.readOnly) return;
          const input =
            root instanceof HTMLElement
              ? root.querySelector('[data-testid="review-draft-input"]')
              : null;
          (input as HTMLInputElement | null)?.focus({ preventScroll: true });
        });
        onBeforeUnmount(() => {
          measuredBy?.(null, COMPOSE_KEY);
        });

        const submit = () => {
          const { review, endDraft, readOnly } = rail.value;
          if (readOnly || text.value.trim().length === 0) return;
          const landed = review.comment(text.value.trim());
          refused.value = !landed;
          if (landed) {
            text.value = '';
            endDraft();
          }
        };

        return () => {
          if (props.hidden) return null;
          const { readOnly, draftAuthor, draftAuthorInfo, draftAuthorSlot } = rail.value;
          return h(
            'div',
            {
              class: `docx-review__slot${props.left === null ? '' : ' docx-review__slot--compact'}${props.className ? ` ${props.className}` : ''}`,
              style: {
                position: 'absolute',
                top: `${props.top}px`,
                ...(props.left === null
                  ? {}
                  : { left: `${props.left}px`, width: `${COMPACT_CARD_WIDTH}px` }),
              },
            },
            [
              h(
                'div',
                {
                  class: 'docx-review__card',
                  'data-testid': 'review-draft',
                  'data-draft': '',
                  ...(draftAuthor
                    ? {
                        'data-review-author': draftAuthor,
                        'data-review-author-slot': draftAuthorSlot,
                      }
                    : {}),
                  style: authorCardStyle(
                    draftAuthor ?? undefined,
                    draftAuthorInfo,
                    draftAuthorSlot
                  ),
                },
                [
                  h(
                    'form',
                    {
                      class: 'docx-review__reply-box',
                      onSubmit: (event: Event) => {
                        event.preventDefault();
                        submit();
                      },
                    },
                    [
                      h(
                        'label',
                        { class: 'docx-editor-sr-only', for: fieldId },
                        t('comments.addComment')
                      ),
                      h('input', {
                        id: fieldId,
                        'data-testid': 'review-draft-input',
                        class: 'docx-review__input',
                        value: text.value,
                        placeholder: t('comments.addComment'),
                        readonly: readOnly,
                        ...(refused.value ? { 'aria-invalid': true } : {}),
                        onInput: (event: Event) => {
                          if (readOnly) return;
                          refused.value = false;
                          text.value = (event.target as HTMLInputElement).value;
                        },
                        onKeydown: (event: KeyboardEvent) => {
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            rail.value.endDraft();
                            return;
                          }
                          if (readOnly || event.key !== 'Enter') return;
                          event.preventDefault();
                          submit();
                        },
                      }),
                      h('div', { class: 'docx-review__reply-actions' }, [
                        h(
                          'button',
                          {
                            type: 'button',
                            'data-testid': 'review-draft-cancel',
                            class: 'docx-review__text-button',
                            onMousedown: guardMousedown,
                            onClick: () => rail.value.endDraft(),
                          },
                          t('common.cancel')
                        ),
                        h(
                          'button',
                          {
                            type: 'submit',
                            'data-testid': 'review-draft-submit',
                            class: 'docx-review__submit',
                            disabled: readOnly || text.value.trim().length === 0,
                            title: readOnly ? t('editingMode.viewingHint') : undefined,
                          },
                          t('common.comment')
                        ),
                      ]),
                      refused.value
                        ? h(
                            'span',
                            { class: 'docx-review__refused', role: 'alert' },
                            t('review.commentRefused')
                          )
                        : null,
                    ]
                  ),
                ]
              ),
            ]
          );
        };
      },
    }),
    'Draft'
  );

  const ReviewReply = markPart(
    defineComponent({
      name: 'ReviewReply',
      props: {
        className: String,
        hidden: Boolean,
      },
      setup(props, { slots }) {
        const rail = deps.useRail();
        const entryRef = deps.useItem();
        const t = deps.useLabel();
        const draft = ref('');
        const refused = ref(false);
        const fieldId = useReviewStableId('reply');
        const editorRevision = useEditorRenderRevision();
        const editorRef = useDocxEditor();

        const submit = (root: ParentNode | null) => {
          const entry = entryRef.value;
          const { review, readOnly, byId } = rail.value;
          const input = root?.querySelector<HTMLInputElement>('[data-testid="review-reply-input"]');
          const text = (input?.value ?? draft.value).trim();
          const live = entry ? (byId.get(entry.id) ?? entry) : null;
          if (!live || readOnly || text.length === 0) return;
          const landed =
            editorRef.value?.replyToReviewItem(live.key, text).ok ?? review.reply(live, text);
          refused.value = !landed;
          if (landed) {
            draft.value = '';
            if (input) input.value = '';
          }
        };

        return () => {
          void editorRevision.value;
          const entry = entryRef.value;
          if (props.hidden || !entry || !entry.isActive) return null;
          const { review, readOnly } = rail.value;
          const custom = slots.default?.();
          if (custom?.length) return custom;

          return (
            <div class={`docx-review__reply-box${props.className ? ` ${props.className}` : ''}`}>
              <label class="docx-editor-sr-only" for={fieldId}>
                {t('comments.replyPlaceholder')}
              </label>
              <input
                id={fieldId}
                data-testid="review-reply-input"
                class="docx-review__input"
                placeholder={t('comments.replyPlaceholder')}
                readonly={readOnly}
                {...(refused.value ? { 'aria-invalid': true, 'data-refused': '' } : {})}
                onInput={(event) => {
                  if (readOnly) return;
                  refused.value = false;
                  draft.value = (event.target as HTMLInputElement).value;
                }}
                onClick={(event) => event.stopPropagation()}
                onKeydown={(event) => {
                  if (readOnly || event.key !== 'Enter') return;
                  event.preventDefault();
                  submit((event.currentTarget as HTMLElement).closest('.docx-review__reply-box'));
                }}
              />
              <div class="docx-review__reply-actions">
                <button
                  type="button"
                  data-testid="review-reply-cancel"
                  class="docx-review__text-button"
                  onMousedown={guardMousedown}
                  onClick={(event) => {
                    event.stopPropagation();
                    draft.value = '';
                    refused.value = false;
                    review.setActive(null);
                  }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  data-testid="review-reply-submit"
                  class="docx-review__submit"
                  disabled={readOnly}
                  title={readOnly ? t('editingMode.viewingHint') : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    submit((event.currentTarget as HTMLElement).closest('.docx-review__reply-box'));
                  }}
                >
                  {t('review.reply')}
                </button>
              </div>
              {refused.value ? (
                <span class="docx-review__refused" role="alert" data-testid="review-reply-refused">
                  {t('review.replyRefused')}
                </span>
              ) : null}
            </div>
          );
        };
      },
    }),
    'Reply'
  );

  return { ReviewDraft, ReviewReply };
}
