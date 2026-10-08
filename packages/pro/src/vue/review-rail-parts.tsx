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
import { Slot, useDocxEditor, useEditorEvent, useEditorState } from '@docx-editor.dev/vue';
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
  ReviewBalloonReply,
  ReviewCard,
  ReviewEmpty,
  ReviewReject,
  ReviewReplies,
  ReviewSummary,
  ReviewTime,
} from './review-card-parts.tsx';
import {
  ADD_COMMENT_ICON,
  icon,
  markerIconPath,
  resolvedCommentIcon,
  reviewBadge,
} from './review-icons.tsx';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { revisionItemLabel, revisionLabelKey } from './review-labels.ts';
import { authorAccent, authorCardStyle, authorSlot } from './review-author-styles.ts';
import {
  activeItemNeedsBalloon,
  anchorFromRevisionElement,
  balloonServesRevisionKind,
  findPaintedRevisionElement,
  matchBalloonReviewItem,
  type BalloonAnchor,
} from './review-balloon-anchor.ts';

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
        const { review, authorSlots, authorInfo, setExpandedResolvedKey, commentMarkers } =
          rail.value;
        const { roots, stackedTops } = stacked.value;
        return (
          <div class={`docx-review__markers${props.className ? ` ${props.className}` : ''}`}>
            {roots.map((entry) => {
              const top = stackedTops.get(entry.key);
              if (top === undefined) return null;
              if (props.window && (top < props.window.top || top > props.window.bottom)) {
                return null;
              }
              const custom = typeof props.icon === 'function' ? props.icon(entry) : props.icon;
              const badge =
                custom == null && commentMarkers === 'avatar' && entry.kind === 'comment';
              return (
                <button
                  key={entry.key}
                  type="button"
                  class="docx-review__marker"
                  data-testid="review-marker"
                  data-kind={entry.kind === 'revision' ? entry.revisionKind : entry.kind}
                  {...(badge ? { 'data-marker': 'avatar' } : {})}
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
                  aria-label={markerLabel(entry, t)}
                  onMousedown={guardMousedown}
                  onClick={() => {
                    if (entry.kind === 'comment' && entry.resolved) {
                      setExpandedResolvedKey(entry.key);
                    }
                    review.setPaneOpen(true);
                    review.setActive(entry.key);
                  }}
                >
                  {custom ??
                    (entry.kind !== 'comment'
                      ? icon(markerIconPath(entry))
                      : badge
                        ? reviewBadge(entry.initials, entry.replyIds.length, entry.resolved)
                        : entry.resolved
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

/** A marker's accessible name: what opening it shows, whose it is, and its thread state. */
function markerLabel(entry: ReviewItemView, t: (key: TranslationKey) => string): string {
  const parts = [
    `${t('review.showPane')}: ${entry.author ? `${entry.author}. ` : ''}${entry.text}`,
  ];
  if (entry.kind === 'comment' && entry.resolved) parts.push(t('review.resolved'));
  if (entry.kind === 'comment' && entry.replyIds.length > 0) {
    parts.push(t('review.replyCount').replace('{count}', String(entry.replyIds.length)));
  }
  return parts.join('. ');
}

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

type BalloonEntry = Extract<ReviewItemView, { readonly kind: 'revision' }>;

/**
 * What a change balloon says the change did: the verb, then the words themselves — added
 * words as added, removed words struck, and a replacement as both in one line. Kinds with
 * no words of their own keep the card's summary. The words render as text, never markup.
 */
const BalloonChangeSummary = defineComponent({
  name: 'BalloonChangeSummary',
  props: { entry: { type: Object as PropType<BalloonEntry>, required: true } },
  setup(props) {
    const t = useReviewLabel();
    return () => {
      const entry = props.entry;
      const kind = entry.revisionKind;
      const shared = {
        class: 'docx-review__summary',
        'data-testid': 'review-summary',
        'data-review-selectable': '',
      };
      if (kind === 'replace') {
        return h('div', shared, [
          h('span', { class: 'docx-review__label', 'data-kind': 'replace' }, t('review.replaced')),
          ' ',
          h('del', { class: 'docx-review__removed' }, entry.replacedText ?? ''),
          ' ',
          h('ins', { class: 'docx-review__added' }, entry.text),
        ]);
      }
      const added = kind === 'insert' || kind === 'moveTo';
      if (!added && kind !== 'delete' && kind !== 'moveFrom') return h(ReviewSummary);
      return h('div', shared, [
        h(
          'span',
          { class: 'docx-review__label', 'data-kind': kind },
          revisionItemLabel(entry.item, t)
        ),
        ' ',
        h(
          added ? 'ins' : 'del',
          { class: `docx-review__${added ? 'added' : 'removed'}` },
          entry.text
        ),
      ]);
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
      const editorRef = useDocxEditor();
      const anchor = ref<BalloonAnchor | null>(null);
      const navigationAnchorKey = ref<string | null>(null);
      const displayMode = useEditorState((snapshot) => snapshot.reviewDisplayMode ?? 'all-markup');
      // Whether the active item was opened on purpose (Next/Previous Change, `setActive`)
      // rather than by a caret that happened to land in it.
      const activatedKey = useEditorState(() => editorRef.value?.getActivatedReviewKey() ?? null);
      watch(displayMode, () => {
        navigationAnchorKey.value = null;
        anchor.value = null;
      });
      // Counts `reviewItemReveal` events. Next/Previous Change and `setActive` fire one on every
      // landing, the active item included, so a balloon the reader closed opens again even
      // though the active key did not move. A caret move fires none.
      const revealCount = ref(0);
      useEditorEvent('reviewItemReveal', () => {
        revealCount.value += 1;
      });
      const openRef = ref(false);
      const hadEntry = ref(false);

      watch(anchor, (next) => {
        openRef.value = next !== null;
      });

      const close = (): void => {
        navigationAnchorKey.value = null;
        anchor.value = null;
        instance?.proxy?.$forceUpdate();
      };

      let balloonCleanup: (() => void) | undefined;
      onMounted(() => {
        const host = getCurrentInstance()?.proxy?.$el ?? instance?.proxy?.$el;
        const railEl = host?.closest('.docx-review') as HTMLElement | null;
        const scroller = (railEl?.closest('.docx-editor__scroll-container') ??
          railEl?.offsetParent) as HTMLElement | null;
        if (!host || !railEl || !scroller) return;

        const onDown = (event: Event): void => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (host.contains(target)) return;
          const element = target.closest('[data-revision-id]');
          if (element instanceof HTMLElement && scroller.contains(element)) {
            const structuralSite = element.classList.contains('docx-table-row--revision');
            if (
              element.dataset.revisionKind === 'format' ||
              structuralSite ||
              rail.value.revisionsIn === 'balloons'
            ) {
              navigationAnchorKey.value = null;
              anchor.value = anchorFromRevisionElement(element, railEl, structuralSite);
              instance?.proxy?.$forceUpdate();
              return;
            }
          }
          if (openRef.value) close();
        };
        // Typing never happens under a change balloon. The reply line's own input is exempt.
        const onInput = (event: Event): void => {
          if (rail.value.revisionsIn !== 'balloons' || !openRef.value) return;
          if (event.target instanceof Node && host.contains(event.target)) return;
          close();
        };
        // Bubble phase, and only when no other control already handled the key.
        // Only a key from this editor counts: the page, a dialog, or another editor keeps its
        // own Escape. A key that ends an IME composition is the input method's.
        const onKey = (event: KeyboardEvent): void => {
          if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
          if (rail.value.revisionsIn !== 'balloons' || !openRef.value) return;
          if (!(event.target instanceof Node) || !scroller.contains(event.target)) return;
          // Focus inside the balloon would land on `<body>` once it unmounts.
          const hadFocus = host.contains(host.ownerDocument.activeElement);
          close();
          if (hadFocus) editorRef.value?.focus();
        };

        scroller.addEventListener('pointerdown', onDown, true);
        scroller.addEventListener('mousedown', onDown, true);
        scroller.addEventListener('beforeinput', onInput, true);
        host.ownerDocument.addEventListener('keydown', onKey);
        balloonCleanup = () => {
          scroller.removeEventListener('pointerdown', onDown, true);
          scroller.removeEventListener('mousedown', onDown, true);
          scroller.removeEventListener('beforeinput', onInput, true);
          host.ownerDocument.removeEventListener('keydown', onKey);
        };
      });
      onUnmounted(() => balloonCleanup?.());

      const served = computed((): BalloonEntry | null => {
        const current = anchor.value;
        const candidate = current ? matchBalloonReviewItem(current, rail.value.allItems) : null;
        return candidate &&
          balloonServesRevisionKind(candidate.revisionKind, rail.value.revisionsIn)
          ? candidate
          : null;
      });

      const navigationActive = computed(
        () => rail.value.allItems.find((entry) => entry.isActive) ?? null
      );
      const navigationActiveKey = computed(() => navigationActive.value?.key ?? null);
      const navigationNeedsBalloon = computed(
        () =>
          navigationActive.value !== null &&
          activeItemNeedsBalloon(
            navigationActive.value,
            rail.value.review.items,
            rail.value.review.paneOpen,
            rail.value.revisionsIn,
            activatedKey.value !== null
          )
      );
      watch(
        [navigationActiveKey, navigationNeedsBalloon, () => rail.value.revisionsIn, revealCount],
        ([activeKey, needsBalloon, revisionsIn], _previous, onCleanup) => {
          const active = navigationActive.value;
          const host = instance?.proxy?.$el as HTMLElement | undefined;
          const railEl = host?.closest('.docx-review') as HTMLElement | null;
          const scroller = (railEl?.closest('.docx-editor__scroll-container') ??
            railEl?.offsetParent) as HTMLElement | null;
          if (!activeKey || !active) {
            if (navigationAnchorKey.value === null) return;
            close();
            return;
          }
          if (!needsBalloon) {
            // The caret following a click into the change the balloon already shows keeps it.
            if (revisionsIn === 'balloons' && served.value?.key === active.key) return;
            close();
            return;
          }
          if (!railEl || !scroller) return;
          // A reveal of the decision already open keeps its balloon rather than redrawing it.
          if (openRef.value && navigationAnchorKey.value === active.key) return;
          navigationAnchorKey.value = active.key;
          anchor.value = null;
          let cancelled = false;
          const frame = requestAnimationFrame(() => {
            if (cancelled) return;
            const element = findPaintedRevisionElement(scroller, active);
            if (!element) {
              anchor.value = null;
              instance?.proxy?.$forceUpdate();
              return;
            }
            anchor.value = anchorFromRevisionElement(
              element,
              railEl,
              element.classList.contains('docx-table-row--revision')
            );
            instance?.proxy?.$forceUpdate();
          });
          onCleanup(() => {
            cancelled = true;
            cancelAnimationFrame(frame);
          });
        },
        { flush: 'post' }
      );

      // Resolving the decision removes it from the queue; the balloon it was resolved from
      // must not linger over the text the accept just changed.
      watch(served, (next) => {
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
        const { review, authorSlots, authorInfo, revisionsIn } = rail.value;
        const current = anchor.value;
        const fallbackKind =
          current?.kind === 'format' ? ('format' as const) : ('structural' as const);
        const matched = served.value;
        // An unmatched TEXT change has nothing honest to show: its label would claim a structure.
        const unmatchedContent =
          current !== null && !matched && current.kind !== 'format' && !current.structuralSite;
        const changeBalloon = revisionsIn === 'balloons' && matched !== null;

        const balloonBody =
          current === null ||
          displayMode.value !== 'all-markup' ||
          unmatchedContent ||
          (matched && review.items.some((item) => item.id === matched.id) && review.paneOpen)
            ? null
            : h(
                'div',
                {
                  class: 'docx-review__balloon',
                  'data-testid': 'review-balloon',
                  ...(changeBalloon ? { 'data-variant': 'change' } : {}),
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
                          ...(changeBalloon
                            ? { role: 'dialog', 'aria-label': t('review.trackedChange') }
                            : {}),
                          style: authorCardStyle(
                            matched.author,
                            authorInfo.get(matched.author),
                            authorSlots.get(matched.author) ?? 0
                          ),
                          // A change balloon is already open on its change; activating it again
                          // would move the caret out from under the reply line being typed into.
                          ...(changeBalloon
                            ? {}
                            : { onClick: () => review.setActive(matched.key) }),
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
                          changeBalloon
                            ? h(BalloonChangeSummary, { entry: matched })
                            : h(ReviewSummary),
                          ...(changeBalloon
                            ? [
                                h(ReviewReplies),
                                h(ReviewBalloonReply, { key: matched.key, entry: matched }),
                              ]
                            : []),
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
