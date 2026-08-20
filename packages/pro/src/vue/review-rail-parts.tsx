/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import {
  computed,
  defineComponent,
  getCurrentInstance,
  h,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type CSSProperties,
  type PropType,
  type VNode,
} from 'vue';
import { Slot } from '@docx-editor.dev/vue';
import { cloneReviewCard, partitionReviewChildren } from './review-composition.ts';
import {
  MARKER_STEP,
  REVIEW_DATE_FORMAT,
  guardMousedown,
  idsOf,
  initialsOf,
  isThreadedReply,
  markPart,
} from './review-shared.ts';
import { ReviewItemScope, ReviewReplyScope, useRail, useReviewLabel } from './review-context.ts';
import type { ReviewItemView } from './useReview.ts';
import {
  ReviewAccept,
  ReviewAuthor,
  ReviewAvatar,
  ReviewCard,
  ReviewEmpty,
  ReviewReject,
  ReviewSummary,
  ReviewTime,
} from './review-card-parts.tsx';
import { ADD_COMMENT_ICON, icon, markerIconPath, resolvedCommentIcon } from './review-icons.tsx';
import { revisionLabelKey } from './review-labels.ts';
import { authorAccent, authorCardStyle, authorSlot } from './review-author-styles.ts';

/** @public */
export const ReviewList = markPart(
  defineComponent({
    name: 'ReviewList',
    props: {
      stack: { type: Boolean, default: true },
      positions: { type: Object as PropType<ReadonlyMap<string, number>>, default: undefined },
      collapsed: { type: Object as PropType<ReadonlySet<string>>, default: undefined },
      scale: { type: Number, default: 1 },
      offset: { type: Number, default: 0 },
      window: {
        type: Object as PropType<{ top: number; bottom: number } | null>,
        default: null,
      },
      className: String,
      hidden: Boolean,
    },
    setup(props, { slots }) {
      const rail = useRail();
      return () => {
        if (props.hidden) return null;
        const { review, cardClassName } = rail.value;

        const defaultNodes = slots.default?.() ?? [];
        const itemSlot = slots.item;
        const listChildren = itemSlot ? null : partitionReviewChildren(defaultNodes, 'list');
        const present = idsOf(review.items);
        const roots = review.items.filter((entry) => !isThreadedReply(entry, present));

        if (roots.length === 0) {
          if (itemSlot) return null;
          return listChildren?.parts.Empty ?? <ReviewEmpty />;
        }

        return h(
          'div',
          { class: `docx-review__list${props.className ? ` ${props.className}` : ''}` },
          roots.map((entry) => {
            const anchor = props.stack
              ? (props.positions?.get(entry.key) ?? entry.anchorY)
              : entry.anchorY;
            const top =
              anchor === null || anchor === undefined ? null : props.offset + anchor * props.scale;
            if (
              top !== null &&
              props.window &&
              (top < props.window.top || top > props.window.bottom)
            ) {
              return null;
            }
            const style: CSSProperties =
              top === null ? {} : { position: 'absolute', top: `${top}px` };
            return h(
              ReviewItemScope,
              {
                key: entry.key,
                entry,
                measureKey: entry.key,
                collapsed: props.collapsed?.has(entry.key),
                style,
              },
              () =>
                itemSlot
                  ? itemSlot({ item: entry })
                  : listChildren?.parts.Card
                    ? cloneReviewCard(listChildren.parts.Card, cardClassName)
                    : h(
                        ReviewCard,
                        cardClassName ? { className: cardClassName } : {},
                        () => listChildren?.rest
                      )
            );
          })
        );
      };
    },
  }),
  'List'
);

/** @public */
export const ReviewMarkers = markPart(
  defineComponent({
    name: 'ReviewMarkers',
    props: {
      scale: { type: Number, default: 1 },
      offset: { type: Number, default: 0 },
      window: {
        type: Object as PropType<{ top: number; bottom: number } | null>,
        default: null,
      },
      className: String,
      hidden: Boolean,
      icon: {
        type: [Object, Function] as PropType<
          VNode | ((item: ReviewItemView) => VNode | null | undefined)
        >,
        default: undefined,
      },
    },
    setup(props) {
      const rail = useRail();
      const t = useReviewLabel();
      const stacked = computed(() => {
        const { review } = rail.value;
        const present = idsOf(review.items);
        const entries = review.items.filter((entry) => !isThreadedReply(entry, present));
        const tops = new Map<string, number>();
        let cursor = Number.NEGATIVE_INFINITY;
        for (const entry of entries) {
          if (entry.anchorY === null) continue;
          const top = Math.max(props.offset + entry.anchorY * props.scale, cursor);
          tops.set(entry.key, top);
          cursor = top + MARKER_STEP;
        }
        return { roots: entries, stackedTops: tops };
      });

      return () => {
        if (props.hidden) return null;
        const { review, authorSlots, authorInfo } = rail.value;
        const { roots, stackedTops } = stacked.value;
        return (
          <div class={`docx-review__markers${props.className ? ` ${props.className}` : ''}`}>
            {roots.map((entry) => {
              const top = stackedTops.get(entry.key);
              if (top === undefined) return null;
              if (props.window && (top < props.window.top || top > props.window.bottom)) {
                return null;
              }
              return (
                <button
                  key={entry.key}
                  type="button"
                  class="docx-review__marker"
                  data-testid="review-marker"
                  data-kind={entry.kind === 'revision' ? entry.revisionKind : entry.kind}
                  {...(entry.author
                    ? {
                        'data-review-author': entry.author,
                        'data-review-author-slot': authorSlot(
                          authorInfo.get(entry.author),
                          authorSlots.get(entry.author) ?? 0
                        ),
                      }
                    : {})}
                  style={{
                    position: 'absolute',
                    top: `${top}px`,
                    ...(entry.author
                      ? ({
                          '--doc-review-author-current': authorAccent(
                            authorInfo.get(entry.author),
                            authorSlots.get(entry.author) ?? 0
                          ),
                        } as CSSProperties)
                      : {}),
                  }}
                  title={entry.author ? `${entry.author}: ${entry.text}` : entry.text}
                  aria-label={`${t('review.showPane')}: ${entry.author ? `${entry.author}. ` : ''}${entry.text}`}
                  onMousedown={guardMousedown}
                  onClick={() => {
                    review.setPaneOpen(true);
                    review.setActive(entry.key);
                  }}
                >
                  {(typeof props.icon === 'function' ? props.icon(entry) : props.icon) ??
                    (entry.kind === 'comment' && entry.resolved
                      ? resolvedCommentIcon()
                      : icon(markerIconPath(entry)))}
                </button>
              );
            })}
          </div>
        );
      };
    },
  }),
  'Markers'
);

/** @public */
export const ReviewAddComment = markPart(
  defineComponent({
    name: 'ReviewAddComment',
    props: {
      top: { type: Number as PropType<number | null>, default: null },
      drafting: { type: Boolean, default: false },
      className: String,
      hidden: Boolean,
    },
    setup(props, { slots }) {
      const rail = useRail();
      const t = useReviewLabel();
      return () => {
        const { beginDraft, composeTop, readOnly } = rail.value;
        if (props.hidden || props.drafting || composeTop === null || readOnly) return null;
        const shared = {
          type: 'button' as const,
          class: `docx-review__add${props.className ? ` ${props.className}` : ''}`,
          'data-testid': 'review-add-comment',
          style: { position: 'absolute' as const, top: `${composeTop}px` },
          'aria-label': t('common.comment'),
          title: t('common.comment'),
          onMousedown: guardMousedown,
          onClick: beginDraft,
        };
        const custom = slots.default?.();
        if (custom?.length) return h(Slot as never, shared, () => custom);
        return h('button', shared, icon(ADD_COMMENT_ICON));
      };
    },
  }),
  'AddComment'
);

interface BalloonAnchor {
  readonly revisionId: string;
  readonly author: string;
  readonly date?: string;
  readonly kind?: string;
  readonly structuralSite: boolean;
  readonly paragraphId?: string;
  readonly start?: number;
  readonly end?: number;
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
  readonly above: boolean;
}

const BalloonTime = defineComponent({
  name: 'BalloonTime',
  props: { raw: { type: String, required: true } },
  setup(props) {
    return () => {
      const when = new Date(props.raw);
      if (Number.isNaN(when.getTime())) return null;
      return (
        <time class="docx-review__time" datetime={props.raw}>
          {REVIEW_DATE_FORMAT.format(when)}
        </time>
      );
    };
  },
});

/** @public */
export const ReviewBalloon = markPart(
  defineComponent({
    name: 'ReviewBalloon',
    props: { className: String, hidden: Boolean },
    setup(props) {
      const instance = getCurrentInstance();
      const rail = useRail();
      const t = useReviewLabel();
      const anchor = ref<BalloonAnchor | null>(null);
      const openRef = ref(false);
      const hadEntry = ref(false);

      watch(anchor, (next) => {
        openRef.value = next !== null;
      });

      let balloonCleanup: (() => void) | undefined;
      onMounted(() => {
        const host = getCurrentInstance()?.proxy?.$el;
        const railEl = host?.closest('.docx-review') as HTMLElement | null;
        const scroller = (railEl?.closest('.docx-editor__scroll-container') ??
          railEl?.offsetParent) as HTMLElement | null;
        if (!host || !railEl || !scroller) return;

        const openAt = (element: HTMLElement, structuralSite: boolean): void => {
          const railRect = railEl.getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          const viewportBottom = element.ownerDocument.defaultView?.innerHeight ?? Infinity;
          const start = Number(element.dataset.start);
          const end = Number(element.dataset.end);
          anchor.value = {
            revisionId: element.dataset.revisionId!,
            author: element.dataset.reviewAuthor ?? '',
            ...(element.dataset.revisionDate !== undefined
              ? { date: element.dataset.revisionDate }
              : {}),
            ...(element.dataset.revisionKind !== undefined
              ? { kind: element.dataset.revisionKind }
              : {}),
            structuralSite,
            ...(element.dataset.paragraphId !== undefined
              ? { paragraphId: element.dataset.paragraphId }
              : {}),
            ...(Number.isFinite(start) ? { start } : {}),
            ...(Number.isFinite(end) ? { end } : {}),
            left: rect.left - railRect.left,
            top: rect.top - railRect.top,
            bottom: rect.bottom - railRect.top,
            above: rect.bottom + 220 > viewportBottom,
          };
          instance?.proxy?.$forceUpdate();
        };

        const onDown = (event: Event): void => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (host.contains(target)) return;
          const element = target.closest('[data-revision-id]');
          if (element instanceof HTMLElement && scroller.contains(element)) {
            const structuralSite = element.classList.contains('docx-table-row--revision');
            if (element.dataset.revisionKind === 'format' || structuralSite) {
              openAt(element, structuralSite);
              return;
            }
          }
          if (openRef.value) {
            anchor.value = null;
            instance?.proxy?.$forceUpdate();
          }
        };

        scroller.addEventListener('pointerdown', onDown, true);
        scroller.addEventListener('mousedown', onDown, true);
        balloonCleanup = () => {
          scroller.removeEventListener('pointerdown', onDown, true);
          scroller.removeEventListener('mousedown', onDown, true);
        };
      });
      onUnmounted(() => balloonCleanup?.());

      const served = computed(() => {
        const current = anchor.value;
        if (!current) return null;
        const { allItems } = rail.value;
        let byAuthor: ReviewItemView | null = null;
        let byAuthorAmbiguous = false;
        let byId: ReviewItemView | null = null;
        let byIdAmbiguous = false;
        let byRange: ReviewItemView | null = null;
        let byRangeAmbiguous = false;
        for (const candidate of allItems) {
          if (candidate.kind !== 'revision' || candidate.item.kind !== 'revision') continue;
          for (const address of candidate.item.addresses) {
            if (address.id !== current.revisionId) continue;
            if (address.author === current.author) {
              if (address.date === current.date) return candidate;
              if (byAuthor === null) byAuthor = candidate;
              else if (byAuthor !== candidate) byAuthorAmbiguous = true;
            }
            if (byId === null) byId = candidate;
            else if (byId !== candidate) byIdAmbiguous = true;
          }
          if (
            current.paragraphId !== undefined &&
            current.start !== undefined &&
            current.end !== undefined &&
            (candidate.revisionKind === 'format' || candidate.revisionKind === 'structural')
          ) {
            for (const range of candidate.item.ranges) {
              if (
                range.start.paragraphId === current.paragraphId &&
                range.start.offset < current.end &&
                range.end.offset > current.start
              ) {
                if (byRange === null) byRange = candidate;
                else if (byRange !== candidate) byRangeAmbiguous = true;
                break;
              }
            }
          }
        }
        if (byAuthor !== null && !byAuthorAmbiguous) return byAuthor;
        if (byId !== null && !byIdAmbiguous) return byId;
        if (byRange !== null && !byRangeAmbiguous) return byRange;
        return null;
      });

      const entry = computed(() => {
        const candidate = served.value;
        if (
          candidate &&
          (candidate.revisionKind === 'format' || candidate.revisionKind === 'structural')
        ) {
          return candidate;
        }
        return null;
      });

      watch(entry, (next) => {
        if (next) {
          hadEntry.value = true;
          return;
        }
        if (hadEntry.value) {
          hadEntry.value = false;
          anchor.value = null;
        }
      });

      return () => {
        if (props.hidden) return null;
        const { review, authorSlots, authorInfo } = rail.value;
        const current = anchor.value;
        const fallbackKind =
          current?.kind === 'format' ? ('format' as const) : ('structural' as const);
        const matched = entry.value;

        const balloonBody =
          current === null
            ? null
            : h(
                'div',
                {
                  class: 'docx-review__balloon',
                  'data-testid': 'review-balloon',
                  style: {
                    left: `${current.left}px`,
                    top: `${current.above ? current.top - 6 : current.bottom + 6}px`,
                    transform: current.above ? 'translateY(-100%)' : undefined,
                  },
                  onMousedown: guardMousedown,
                },
                matched
                  ? h(ReviewReplyScope, { entry: matched }, () =>
                      h(
                        'div',
                        {
                          class: 'docx-review__card',
                          'data-testid': 'review-balloon-card',
                          'data-kind': matched.revisionKind ?? 'revision',
                          ...(matched.author
                            ? {
                                'data-review-author': matched.author,
                                'data-review-author-slot': authorSlot(
                                  authorInfo.get(matched.author),
                                  authorSlots.get(matched.author) ?? 0
                                ),
                              }
                            : {}),
                          style: authorCardStyle(
                            matched.author,
                            authorInfo.get(matched.author),
                            authorSlots.get(matched.author) ?? 0
                          ),
                          onClick: () => review.setActive(matched.key),
                        },
                        [
                          h('div', { class: 'docx-review__head' }, [
                            h(ReviewAvatar),
                            h('div', { class: 'docx-review__meta' }, [
                              h(ReviewAuthor),
                              h(ReviewTime),
                            ]),
                            matched.kind === 'revision' && !matched.readOnly
                              ? h('div', { class: 'docx-review__actions' }, [
                                  h(ReviewAccept),
                                  h(ReviewReject),
                                ])
                              : null,
                          ]),
                          h(ReviewSummary),
                        ]
                      )
                    )
                  : h(
                      'div',
                      {
                        class: 'docx-review__card',
                        'data-testid': 'review-balloon-card',
                        'data-kind': fallbackKind,
                        ...(current.author
                          ? {
                              'data-review-author': current.author,
                              'data-review-author-slot': authorSlot(
                                authorInfo.get(current.author),
                                authorSlots.get(current.author) ?? 0
                              ),
                            }
                          : {}),
                        style: authorCardStyle(
                          current.author,
                          authorInfo.get(current.author),
                          authorSlots.get(current.author) ?? 0
                        ),
                      },
                      [
                        h('div', { class: 'docx-review__head' }, [
                          h(
                            'span',
                            { class: 'docx-review__avatar', 'aria-hidden': true },
                            initialsOf(current.author)
                          ),
                          h('div', { class: 'docx-review__meta' }, [
                            h(
                              'span',
                              { class: 'docx-review__author' },
                              current.author || t('comments.unknown')
                            ),
                            current.date ? h(BalloonTime, { raw: current.date }) : null,
                          ]),
                        ]),
                        h('div', { class: 'docx-review__summary' }, [
                          h(
                            'span',
                            { class: 'docx-review__label', 'data-kind': fallbackKind },
                            t(revisionLabelKey(fallbackKind))
                          ),
                        ]),
                      ]
                    )
              );

        return h(
          'div',
          {
            class: `docx-review__balloon-root${props.className ? ` ${props.className}` : ''}`,
          },
          balloonBody === null ? undefined : [balloonBody]
        );
      };
    },
  }),
  'Balloon'
);
