/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The package builds its React and Vue entries together; this file uses Vue's JSX runtime.
/** @jsxImportSource vue */

import {
  computed,
  defineComponent,
  getCurrentInstance,
  h,
  onBeforeUnmount,
  onMounted,
  type PropType,
  type VNode,
} from 'vue';
import { isDomNode, hostDocumentOf, isHTMLElementNode } from '@docx-editor.dev/core/editor';
import { Slot, useTranslation } from '@docx-editor.dev/vue';
import {
  ACCEPT_ICON,
  DELETE_ICON,
  REJECT_ICON,
  icon,
  resolvedCommentIcon,
  reviewBadge,
} from './review-icons.tsx';
import { revisionItemLabel } from './review-labels.ts';
import { reviewRefusalFallbackKey, reviewRefusalLabelKey } from '../review/review-refusal.ts';
import { ReviewActionSlot } from './review-action-slot.tsx';
import { createCommentResolutionParts } from './review-comment-resolution.tsx';
import { createReviewComposeParts } from './review-compose-boxes.tsx';
import {
  COMPOSE_KEY,
  reviewDateFormat,
  guardMousedown,
  markPart,
  partOverrides,
} from './review-shared.ts';
import { ReviewReplyScope, useRail, useReviewItem, useReviewLabel } from './review-context.ts';
import { useReviewStableId } from './stable-id.ts';
import type { ReviewItemView } from './useReview.ts';
import { authorCardStyle, authorSlot } from './review-author-styles.ts';
import { isCardControl, keepsPressFocus } from '../review/card-controls.ts';

const { ReviewResolve, ReviewReopen } = createCommentResolutionParts({
  useRail,
  useItem: useReviewItem,
  useLabel: useReviewLabel,
});

export const { ReviewDraft, ReviewReply, ReviewBalloonReply } = createReviewComposeParts({
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
        if (props.asChild) return <Slot {...shared}>{{ default: () => custom }}</Slot>;
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
        if (props.asChild) return <Slot {...shared}>{{ default: () => slots.default?.() }}</Slot>;
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
      const translation = useTranslation();
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
        if (props.asChild) return <Slot {...shared}>{{ default: () => slots.default?.() }}</Slot>;
        return (
          <time {...shared}>
            {slots.default?.() ?? reviewDateFormat(translation.lang).format(when)}
          </time>
        );
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
        const label = entry.kind !== 'revision' ? null : revisionItemLabel(entry.item, t);
        const replaced = entry.kind === 'revision' && entry.revisionKind === 'replace';
        const shared = {
          class: `docx-review__summary${props.className ? ` ${props.className}` : ''}`,
          'data-testid': 'review-summary',
          'data-review-selectable': '',
        };
        if (props.asChild) return <Slot {...shared}>{{ default: () => slots.default?.() }}</Slot>;
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
                {{ default: () => slots.default?.() }}
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

/**
 * Why the card's last action did not land, when the editor refused it: an external refresh,
 * viewing, protection, or a collaboration session that is not ready. Absent otherwise. A
 * refused reply is shown by the reply line instead.
 *
 * Plain text, readable with the card: the rail's live region is what announces it, because a
 * live region inside a `role="button"` card is not reliably announced. @public
 */
export const ReviewRefusal = markPart(
  defineComponent({
    name: 'ReviewRefusal',
    props: { className: String, hidden: Boolean, asChild: Boolean },
    setup(props, { slots }) {
      const rail = useRail();
      const entryRef = useReviewItem();
      const t = useReviewLabel();
      return () => {
        const entry = entryRef.value;
        const refusal = rail.value.review.lastRefusal;
        if (props.hidden || !entry || !refusal) return null;
        if (refusal.key !== entry.key || refusal.action === 'reply') return null;
        const shared = {
          class: `docx-review__refused${props.className ? ` ${props.className}` : ''}`,
          'data-testid': 'review-refusal',
          'data-refusal-code': refusal.code,
        };
        if (props.asChild) return <Slot {...shared}>{{ default: () => slots.default?.() }}</Slot>;
        return (
          <p {...shared}>
            {slots.default?.() ??
              t(reviewRefusalLabelKey(refusal.code, 'review.actionRefused', refusal.final))}
          </p>
        );
      };
    },
  }),
  'Refusal'
);

/**
 * The rail's one live region for refused review writes, so a screen reader hears the cause of
 * any of them: a card action, a reply, or a new comment, from the packaged parts or from a
 * host's own controls over `useReview()`.
 *
 * Re-keyed per refusal, so the same refusal twice is announced twice.
 */
export const ReviewRefusalAnnouncer = defineComponent({
  name: 'ReviewRefusalAnnouncer',
  setup() {
    const rail = useRail();
    const t = useReviewLabel();
    return () => {
      const refusal = rail.value.review.lastRefusal;
      return (
        <span class="docx-editor-sr-only" aria-live="polite" data-testid="review-refusal-live">
          {refusal ? (
            <span key={refusal.sequence}>
              {t(
                reviewRefusalLabelKey(
                  refusal.code,
                  reviewRefusalFallbackKey(refusal.action),
                  refusal.final
                )
              )}
            </span>
          ) : null}
        </span>
      );
    };
  },
});

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
              {{ default: () => slots.default?.() }}
            </ReviewActionSlot>
          );
        }
        return <button {...shared}>{props.icon ?? slots.default?.() ?? icon(DELETE_ICON)}</button>;
      };
    },
  }),
  'Delete'
);

/** A reply's own author hooks, so it draws in its author's colour inside another's card. */
function replyAuthorAttributes(
  author: string,
  rail: ReturnType<typeof useRail>['value']
): Record<string, unknown> {
  if (!author) return {};
  const info = rail.authorInfo.get(author);
  const slot = rail.authorSlots.get(author) ?? 0;
  return {
    'data-review-author': author,
    'data-review-author-slot': authorSlot(info, slot),
    style: authorCardStyle(author, info, slot),
  };
}

/** @public */
export const ReviewReplies = markPart(
  defineComponent({
    name: 'ReviewReplies',
    props: { className: String, hidden: Boolean },
    setup(props) {
      const rail = useRail();
      const entryRef = useReviewItem();
      return () => {
        const entry = entryRef.value;
        if (props.hidden || !entry || entry.kind === 'custom') return null;
        const live = rail.value.byId.get(entry.id) ?? entry;
        const replies = live.replyIds
          .map((id) => rail.value.byId.get(id))
          .filter((reply): reply is NonNullable<typeof reply> => reply !== undefined);
        if (replies.length === 0) return null;
        return (
          <ol class={`docx-review__replies${props.className ? ` ${props.className}` : ''}`}>
            {replies.map((reply) => (
              <ReviewReplyScope key={reply.key} entry={reply}>
                {{
                  default: () => (
                    <li
                      class="docx-review__reply"
                      data-testid="review-reply"
                      // Each reply draws in its OWN author's colour, not the thread's.
                      {...replyAuthorAttributes(reply.author, rail.value)}
                    >
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
                  ),
                }}
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
                {take('Delete', entry.kind === 'comment' ? <ReviewDelete /> : null)}
              </div>
            ) : null}
          </div>
          {take('Summary', <ReviewSummary />)}
          {take('Refusal', <ReviewRefusal />)}
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
      const t = useReviewLabel();
      let resolvedDetailsNode: HTMLDetailsElement | null = null;
      const bindResolvedDetails = (vnode: VNode) => {
        resolvedDetailsNode =
          isHTMLElementNode(vnode.el) && vnode.el.localName === 'details'
            ? (vnode.el as HTMLDetailsElement)
            : resolvedDetailsNode;
      };
      const closeOnOutsidePointer = (event: PointerEvent) => {
        if (
          resolvedDetailsNode?.open &&
          isDomNode(event.target) &&
          !resolvedDetailsNode.contains(event.target)
        ) {
          rail.value.setExpandedResolvedKey(null);
          rail.value.review.setActive(null);
          resolvedDetailsNode.open = false;
        }
      };
      // The card's own document: a rail in a pop-out window dismisses on presses there.
      let listening: Document | null = null;
      const instance = getCurrentInstance();
      onMounted(() => {
        listening = hostDocumentOf(instance?.proxy?.$el as Node | null);
        listening.addEventListener('pointerdown', closeOnOutsidePointer, true);
      });
      onBeforeUnmount(() => {
        listening?.removeEventListener('pointerdown', closeOnOutsidePointer, true);
        listening = null;
      });
      return () => {
        const entry = entryRef.value;
        if (props.hidden || !entry) return null;
        const {
          review,
          authorSlots,
          authorInfo,
          expandedResolvedKey,
          setExpandedResolvedKey,
          commentMarkers,
        } = rail.value;
        const slot = authorSlots.get(entry.author) ?? 0;
        const resolvedCollapsible = !props.asChild && entry.kind === 'comment' && entry.resolved;
        const shared = {
          class: `docx-review__card${props.className ? ` ${props.className}` : ''}`,
          'data-testid': 'review-card',
          ...(!resolvedCollapsible
            ? { 'aria-labelledby': `${cardId}-author ${cardId}-summary` }
            : {}),
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
          ...(resolvedCollapsible ? { 'data-resolved-miniature': '' } : {}),
          style: authorCardStyle(entry.author, authorInfo.get(entry.author), slot),
          ...(!resolvedCollapsible ? { tabIndex: 0, role: 'button' as const } : {}),
          id: cardId,
          ...(!resolvedCollapsible
            ? {
                onMousedown: (event: MouseEvent) => {
                  if (keepsPressFocus(event.target)) return;
                  (event.currentTarget as HTMLElement).focus({ preventScroll: true });
                },
                onClick: (event: MouseEvent) => {
                  if (isCardControl(event.target)) return;
                  if (!entry.isActive) review.setActive(entry.key);
                },
                onKeydown: (event: KeyboardEvent) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  review.setActive(entry.key);
                },
              }
            : {}),
        };
        if (props.asChild) return <Slot {...shared}>{{ default: () => slots.default?.() }}</Slot>;
        if (resolvedCollapsible) {
          return h(
            'details',
            {
              ...shared,
              open: expandedResolvedKey === entry.key,
              onVnodeMounted: bindResolvedDetails,
              onVnodeUpdated: bindResolvedDetails,
              onVnodeBeforeUnmount: () => {
                resolvedDetailsNode = null;
              },
              onToggle: (event: Event) => {
                const next = (event.currentTarget as HTMLDetailsElement).open;
                setExpandedResolvedKey(next ? entry.key : null);
                review.setActive(next ? entry.key : null);
              },
            },
            [
              h(
                'summary',
                {
                  class: 'docx-review__resolved-toggle',
                  'aria-label': t('review.showResolvedComment'),
                },
                [
                  h('span', { class: 'docx-review__resolved-status' }, t('review.resolved')),
                  commentMarkers === 'initials' ? reviewBadge('', 0, true) : resolvedCommentIcon(),
                ]
              ),
              h(ReviewCardPreset, null, { default: () => slots.default?.() }),
            ]
          );
        }
        return (
          <div {...shared}>{h(ReviewCardPreset, null, { default: () => slots.default?.() })}</div>
        );
      };
    },
  }),
  'Card'
);

export { ReviewResolve, ReviewReopen };
