/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { computed, defineComponent, h, type PropType, type VNode } from 'vue';
import { Slot, useTranslation, useDocxEditor } from '@docx-editor.dev/vue';
import { useEditorRenderRevision } from './useEditorRenderRevision.ts';
import { ACCEPT_ICON, DELETE_ICON, REJECT_ICON, icon } from './review-icons.tsx';
import { revisionLabelKey } from './review-labels.ts';
import { ReviewActionSlot } from './review-action-slot.tsx';
import { createCommentResolutionParts } from './review-comment-resolution.tsx';
import { createReviewComposeParts } from './review-compose-boxes.tsx';
import {
  COMPOSE_KEY,
  REVIEW_DATE_FORMAT,
  guardMousedown,
  markPart,
  partOverrides,
} from './review-shared.ts';
import { ReviewReplyScope, useRail, useReviewItem, useReviewLabel } from './review-context.ts';
import { useReviewStableId } from './stable-id.ts';
import type { ReviewItemView } from './useReview.ts';
import { authorCardStyle, authorSlot } from './review-author-styles.ts';

const { ReviewResolve, ReviewReopen } = createCommentResolutionParts({
  useRail,
  useItem: useReviewItem,
  useLabel: useReviewLabel,
});

export const { ReviewDraft, ReviewReply } = createReviewComposeParts({
  useRail,
  useItem: useReviewItem,
  useLabel: useReviewLabel,
});

export { COMPOSE_KEY };

/** @public */
export const ReviewEmpty = markPart(
  defineComponent({
    name: 'ReviewEmpty',
    props: { className: String, hidden: Boolean, asChild: Boolean },
    setup(props, { slots }) {
      const t = useReviewLabel();
      return () => {
        if (props.hidden) return null;
        return (
          <div
            class={`docx-review__empty${props.className ? ` ${props.className}` : ''}`}
            data-testid="review-empty"
          >
            {slots.default?.() ?? t('review.empty')}
          </div>
        );
      };
    },
  }),
  'Empty'
);

/** @public */
export const ReviewAvatar = markPart(
  defineComponent({
    name: 'ReviewAvatar',
    props: { className: String, hidden: Boolean, asChild: Boolean },
    setup(props, { slots }) {
      const entryRef = useReviewItem();
      const rail = useRail();
      return () => {
        const entry = entryRef.value;
        if (props.hidden || !entry) return null;
        const custom = slots.default?.();
        if (custom === undefined && !entry.initials) return null;
        const shared = {
          class: `docx-review__avatar${props.className ? ` ${props.className}` : ''}`,
          'data-testid': 'review-avatar',
          'aria-hidden': true,
        };
        if (props.asChild) return <Slot {...shared}>{custom}</Slot>;
        const avatarUrl = rail.value.authorInfo.get(entry.author)?.style?.avatarUrl;
        const face =
          custom ??
          (avatarUrl ? (
            <img
              class="docx-review__avatar-img"
              src={avatarUrl}
              alt=""
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
            />
          ) : undefined) ??
          entry.initials;
        return <span {...shared}>{face}</span>;
      };
    },
  }),
  'Avatar'
);

/** @public */
export const ReviewAuthor = markPart(
  defineComponent({
    name: 'ReviewAuthor',
    props: { className: String, hidden: Boolean, asChild: Boolean },
    setup(props, { slots }) {
      const entryRef = useReviewItem();
      const t = useReviewLabel();
      return () => {
        const entry = entryRef.value;
        if (props.hidden || !entry) return null;
        const author = entry.author || t('comments.unknown');
        const shared = {
          class: `docx-review__author${props.className ? ` ${props.className}` : ''}`,
          'data-testid': 'review-author',
        };
        if (props.asChild) return <Slot {...shared}>{slots.default?.()}</Slot>;
        return <span {...shared}>{slots.default?.() ?? author}</span>;
      };
    },
  }),
  'Author'
);

/** @public */
export const ReviewTime = markPart(
  defineComponent({
    name: 'ReviewTime',
    props: { className: String, hidden: Boolean, asChild: Boolean },
    setup(props, { slots }) {
      const entryRef = useReviewItem();
      return () => {
        const entry = entryRef.value;
        if (props.hidden || !entry) return null;
        const raw = entry.date;
        if (!raw) return null;
        const when = new Date(raw);
        if (Number.isNaN(when.getTime())) return null;
        const shared = {
          class: `docx-review__time${props.className ? ` ${props.className}` : ''}`,
          'data-testid': 'review-time',
          datetime: raw,
        };
        if (props.asChild) return <Slot {...shared}>{slots.default?.()}</Slot>;
        return <time {...shared}>{slots.default?.() ?? REVIEW_DATE_FORMAT.format(when)}</time>;
      };
    },
  }),
  'Time'
);

/** @public */
export const ReviewSummary = markPart(
  defineComponent({
    name: 'ReviewSummary',
    props: { className: String, hidden: Boolean, asChild: Boolean },
    setup(props, { slots }) {
      const entryRef = useReviewItem();
      const t = useReviewLabel();
      return () => {
        const entry = entryRef.value;
        if (props.hidden || !entry) return null;
        const text = entry.text;
        const label =
          entry.kind !== 'revision'
            ? null
            : t(revisionLabelKey(entry.revisionKind, entry.item.markDirection));
        const replaced = entry.kind === 'revision' && entry.revisionKind === 'replace';
        const shared = {
          class: `docx-review__summary${props.className ? ` ${props.className}` : ''}`,
          'data-testid': 'review-summary',
          'data-review-selectable': '',
        };
        if (props.asChild) return <Slot {...shared}>{slots.default?.()}</Slot>;
        const custom = slots.default?.();
        if (custom) return <div {...shared}>{custom}</div>;
        return (
          <div {...shared}>
            {replaced ? (
              <span class="docx-review__text">
                {t('review.replaced')}{' '}
                <span class="docx-review__removed">&quot;{entry.replacedText}&quot;</span>{' '}
                {t('review.replacedWith')}{' '}
                <span class="docx-review__added">&quot;{text}&quot;</span>
              </span>
            ) : (
              <>
                {label ? (
                  <span
                    class="docx-review__label"
                    data-kind={entry.kind === 'revision' ? entry.revisionKind : 'revision'}
                  >
                    {label}
                  </span>
                ) : null}
                {text ? <span class="docx-review__text">{text}</span> : null}
              </>
            )}
          </div>
        );
      };
    },
  }),
  'Summary'
);

function createActionPart(
  name: string,
  part: string,
  testId: string,
  labelKey: Parameters<ReturnType<typeof useReviewLabel>>[0],
  defaultIcon: string,
  run: (review: ReturnType<typeof useRail>['value']['review'], entry: ReviewItemView) => void,
  visible: (entry: ReviewItemView) => boolean
) {
  return markPart(
    defineComponent({
      name,
      props: {
        className: String,
        asChild: Boolean,
        hidden: Boolean,
        icon: { type: [Object, String] as PropType<VNode | string>, default: undefined },
      },
      setup(props, { slots }) {
        const rail = useRail();
        const entryRef = useReviewItem();
        const t = useReviewLabel();
        return () => {
          const entry = entryRef.value;
          const { readOnly, review } = rail.value;
          if (props.hidden || !entry || !visible(entry)) return null;
          const label = t(labelKey);
          const disabledReason = readOnly ? t('editingMode.viewingHint') : null;
          const shared = {
            type: 'button' as const,
            class: `docx-review__action${props.className ? ` ${props.className}` : ''}`,
            'data-testid': testId,
            'aria-label': label,
            title: disabledReason ?? label,
            disabled: readOnly,
            onMousedown: guardMousedown,
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              if (readOnly) return;
              run(review, entry);
            },
          };
          if (props.asChild) {
            return (
              <ReviewActionSlot
                engineDisabled={readOnly}
                disabledReason={disabledReason}
                slotProps={shared}
              >
                {slots.default?.()}
              </ReviewActionSlot>
            );
          }
          return (
            <button {...shared}>{props.icon ?? slots.default?.() ?? icon(defaultIcon)}</button>
          );
        };
      },
    }),
    part
  );
}

/** @public */
export const ReviewAccept = createActionPart(
  'ReviewAccept',
  'Accept',
  'review-accept',
  'review.accept',
  ACCEPT_ICON,
  (review, entry) => review.accept(entry),
  (entry) => entry.kind === 'revision' && !entry.readOnly
);

/** @public */
export const ReviewReject = createActionPart(
  'ReviewReject',
  'Reject',
  'review-reject',
  'review.reject',
  REJECT_ICON,
  (review, entry) => review.reject(entry),
  (entry) => entry.kind === 'revision' && !entry.readOnly
);

/** @public */
export const ReviewDelete = markPart(
  defineComponent({
    name: 'ReviewDelete',
    props: {
      className: String,
      asChild: Boolean,
      hidden: Boolean,
      icon: { type: [Object, String] as PropType<VNode | string>, default: undefined },
    },
    setup(props, { slots }) {
      const rail = useRail();
      const entryRef = useReviewItem();
      const { t } = useTranslation();
      return () => {
        const entry = entryRef.value;
        const { readOnly, review } = rail.value;
        if (props.hidden || !entry || entry.kind === 'custom') return null;
        if (entry.kind === 'revision' && entry.readOnly) return null;
        const label =
          entry.kind === 'comment' ? t('review.deleteComment') : t('review.discardChange');
        const disabledReason = readOnly ? t('editingMode.viewingHint') : null;
        const shared = {
          type: 'button' as const,
          class: `docx-review__action${props.className ? ` ${props.className}` : ''}`,
          'data-testid': 'review-delete',
          'aria-label': label,
          title: disabledReason ?? label,
          disabled: readOnly,
          onMousedown: guardMousedown,
          onClick: (event: MouseEvent) => {
            event.stopPropagation();
            if (readOnly) return;
            review.remove(entry);
          },
        };
        if (props.asChild) {
          return (
            <ReviewActionSlot
              engineDisabled={readOnly}
              disabledReason={disabledReason}
              slotProps={shared}
            >
              {slots.default?.()}
            </ReviewActionSlot>
          );
        }
        return <button {...shared}>{props.icon ?? slots.default?.() ?? icon(DELETE_ICON)}</button>;
      };
    },
  }),
  'Delete'
);

/** @public */
export const ReviewReplies = markPart(
  defineComponent({
    name: 'ReviewReplies',
    props: { className: String, hidden: Boolean },
    setup(props) {
      const rail = useRail();
      const entryRef = useReviewItem();
      const editorRef = useDocxEditor();
      const editorRevision = useEditorRenderRevision();
      return () => {
        const entry = entryRef.value;
        if (props.hidden || !entry || entry.kind === 'custom') return null;
        void editorRevision.value;
        const editor = editorRef.value;
        const catalog = editor?.getReviewItems() ?? rail.value.allItems;
        const live =
          catalog.find((item) => item.id === entry.id) ?? rail.value.byId.get(entry.id) ?? entry;
        const fromIds = live.replyIds
          .map((id) => catalog.find((item) => item.id === id))
          .filter((reply): reply is NonNullable<typeof reply> => reply !== undefined);
        const replies =
          fromIds.length > 0
            ? fromIds
            : catalog.filter(
                (item) =>
                  item.kind === 'comment' &&
                  'parentRevisionId' in item &&
                  item.parentRevisionId === live.id
              );
        if (replies.length === 0) return null;
        return (
          <ol class={`docx-review__replies${props.className ? ` ${props.className}` : ''}`}>
            {replies.map((reply) => (
              <ReviewReplyScope key={reply.key} entry={reply}>
                <li class="docx-review__reply" data-testid="review-reply">
                  <div class="docx-review__head">
                    <ReviewAvatar />
                    <div class="docx-review__meta">
                      <ReviewAuthor />
                      <ReviewTime />
                    </div>
                    <div class="docx-review__actions">
                      <ReviewDelete />
                    </div>
                  </div>
                  <ReviewSummary />
                </li>
              </ReviewReplyScope>
            ))}
          </ol>
        );
      };
    },
  }),
  'Replies'
);

const ReviewCardPreset = defineComponent({
  name: 'ReviewCardPreset',
  setup(_props, { slots }) {
    const entryRef = useReviewItem();
    const overrides = computed(() => partOverrides(slots.default?.()));
    return () => {
      const entry = entryRef.value;
      if (!entry) return null;
      const take = (key: string, fallback: VNode | VNode[] | null) =>
        key in overrides.value ? overrides.value[key] : fallback;

      if (entry.kind === 'custom' && entry.item.kind === 'custom') {
        const item = entry.item;
        return (
          <>
            <div class="docx-review__head">
              {take('Avatar', null)}
              <div class="docx-review__meta">
                {take(
                  'Author',
                  <span class="docx-review__author" data-testid="review-custom-title">
                    {item.title}
                  </span>
                )}
              </div>
            </div>
            {take(
              'Summary',
              item.detail ? (
                <div
                  class="docx-review__summary"
                  data-testid="review-summary"
                  data-review-selectable=""
                >
                  <span class="docx-review__text">{item.detail}</span>
                </div>
              ) : null
            )}
            {overrides.value.__extra}
          </>
        );
      }

      const resolvable = entry.kind === 'revision' && !entry.readOnly;
      return (
        <>
          <div class="docx-review__head">
            {take('Avatar', <ReviewAvatar />)}
            <div class="docx-review__meta">
              {take('Author', <ReviewAuthor />)}
              {take('Time', <ReviewTime />)}
            </div>
            {resolvable || entry.kind === 'comment' ? (
              <div class="docx-review__actions">
                {take('Accept', <ReviewAccept />)}
                {take('Reject', <ReviewReject />)}
                {take('Resolve', <ReviewResolve />)}
                {take('Reopen', <ReviewReopen />)}
                {take('Delete', <ReviewDelete />)}
              </div>
            ) : null}
          </div>
          {take('Summary', <ReviewSummary />)}
          {take('Replies', <ReviewReplies />)}
          {take('Reply', <ReviewReply />)}
          {overrides.value.__extra}
        </>
      );
    };
  },
});

/** @public */
export const ReviewCard = markPart(
  defineComponent({
    name: 'ReviewCard',
    props: { className: String, hidden: Boolean, asChild: Boolean },
    setup(props, { slots }) {
      const rail = useRail();
      const entryRef = useReviewItem();
      const cardId = useReviewStableId('card');
      return () => {
        const entry = entryRef.value;
        if (props.hidden || !entry) return null;
        const { review, authorSlots, authorInfo } = rail.value;
        const slot = authorSlots.get(entry.author) ?? 0;
        const shared = {
          class: `docx-review__card${props.className ? ` ${props.className}` : ''}`,
          'data-testid': 'review-card',
          'aria-labelledby': `${cardId}-author ${cardId}-summary`,
          'data-kind': entry.kind === 'revision' ? (entry.revisionKind ?? 'revision') : entry.kind,
          ...(entry.author
            ? {
                'data-review-author': entry.author,
                'data-review-author-slot': authorSlot(authorInfo.get(entry.author), slot),
              }
            : {}),
          ...(entry.kind === 'custom' && entry.item.kind === 'custom'
            ? { 'data-node-name': entry.item.name }
            : {}),
          ...(entry.isActive ? { 'data-active': '' } : {}),
          ...(entry.kind === 'comment' && entry.resolved ? { 'data-resolved': '' } : {}),
          style: authorCardStyle(entry.author, authorInfo.get(entry.author), slot),
          tabIndex: 0,
          role: 'button' as const,
          id: cardId,
          onMousedown: (event: MouseEvent) => {
            if ((event.target as HTMLElement | null)?.closest('[data-review-selectable]')) return;
            (event.currentTarget as HTMLElement).focus({ preventScroll: true });
          },
          onClick: (event: MouseEvent) => {
            if (
              (event.target as HTMLElement | null)?.closest(
                'button, input, textarea, .docx-review__reply-box, [data-review-selectable]'
              )
            ) {
              return;
            }
            if (!entry.isActive) review.setActive(entry.key);
          },
          onKeydown: (event: KeyboardEvent) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            review.setActive(entry.key);
          },
        };
        if (props.asChild) return <Slot {...shared}>{slots.default?.()}</Slot>;
        return (
          <div {...shared}>{h(ReviewCardPreset, null, { default: () => slots.default?.() })}</div>
        );
      };
    },
  }),
  'Card'
);

export { ReviewResolve, ReviewReopen };
