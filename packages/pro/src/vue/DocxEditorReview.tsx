/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import {
  cloneVNode,
  computed,
  defineComponent,
  getCurrentInstance,
  h,
  inject,
  isVNode,
  mergeProps,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  provide,
  ref,
  shallowRef,
  watch,
  watchEffect,
  type ComputedRef,
  type PropType,
  type VNode,
  type VNodeArrayChildren,
} from 'vue';
import type { DocxEditorInstance, ReviewAuthorInfo } from '@docx-editor.dev/core/editor';
import type { ReviewRevisionKind, SelectionPin } from '@docx-editor.dev/core/contracts/editor';
import {
  ReviewRailContext,
  useDocxEditor,
  useEditorState,
  useReviewAuthors,
  useReviewGutter,
  useTranslation,
  REVIEW_PANE_GUTTER,
  type ReviewRailRegistry,
} from '@docx-editor.dev/vue';
import { useReviewWithRevision, type ReviewItemView, type UseReviewReturn } from './useReview.ts';
import { provideEditorRenderRevision, useEditorRenderRevision } from './useEditorRenderRevision.ts';
import { cloneReviewCard, partitionReviewChildren } from './review-composition.ts';
import {
  COLLAPSE_DISPLACEMENT_PX,
  COLLAPSED_CARD_HEIGHT,
  COMPACT_CARD_INSET,
  COMPACT_CARD_WIDTH,
  COMPOSE_KEY,
  DEFAULT_CARD_HEIGHT,
  INITIAL_METRICS,
  NO_PLACEMENT_REVIEW_QUERY,
  RAIL_GUTTER,
  RAIL_OVERSCAN,
  guardMousedown,
  idsOf,
  isThreadedReply,
  selectDocumentAbsent,
  selectDocumentReadOnly,
  type RailMetrics,
} from './review-shared.ts';
import {
  ReviewContextKey,
  ReviewItemScope,
  useReviewItem,
  type ReviewRailValue,
} from './review-context.ts';
import type { ReviewActions } from './review-types.ts';
import { useReviewSlotSizing } from './use-review-slot-sizing.ts';
import { resolveReviewAuthorInfo } from './review-author-styles.ts';
import {
  ReviewAccept,
  ReviewAuthor,
  ReviewAvatar,
  ReviewCard,
  ReviewDelete,
  ReviewDraft,
  ReviewEmpty,
  ReviewReject,
  ReviewReopen,
  ReviewReplies,
  ReviewReply,
  ReviewResolve,
  ReviewSummary,
  ReviewTime,
} from './review-card-parts.tsx';
import {
  ReviewAddComment,
  ReviewBalloon,
  ReviewList,
  ReviewMarkers,
} from './review-rail-parts.tsx';

function takeRoot(key: string, fallback: VNode, parts: Record<string, VNode>): VNode {
  if (!(key in parts)) return fallback;
  const override = parts[key];
  if (!isVNode(override) || !isVNode(fallback)) return override;
  return cloneVNode(override, mergeProps(fallback.props ?? {}, override.props ?? {}));
}

const ReviewDraftMount = defineComponent({
  name: 'ReviewDraftMount',
  props: {
    top: { type: Number, required: true },
    left: { type: Number as PropType<number | null>, default: null },
  },
  setup(props) {
    return () => h(ReviewDraft, { top: props.top, left: props.left });
  },
});

function buildReviewActions(hook: UseReviewReturn, list: readonly ReviewItemView[]): ReviewActions {
  return {
    items: list,
    activeKey: hook.activeKey.value,
    setActive: hook.setActive,
    accept: hook.accept,
    reject: hook.reject,
    resolve: hook.resolve,
    reopen: hook.reopen,
    commentResolutionDisabledReason: hook.commentResolutionDisabledReason.value,
    remove: hook.remove,
    reply: hook.reply,
    selectionAnchorY: hook.selectionAnchorY.value,
    comment: hook.comment,
    paneOpen: hook.paneOpen.value,
    setPaneOpen: hook.setPaneOpen,
    ready: hook.ready.value,
  };
}

const ReviewRoot = defineComponent({
  name: 'DocxEditorReview',
  props: {
    className: String,
    asChild: Boolean,
    hidden: Boolean,
    t: {
      type: Function as PropType<(key: string, params?: Record<string, string | number>) => string>,
      default: undefined,
    },
    card: { type: Object as PropType<{ className?: string }>, default: undefined },
    furniture: { type: [Object, Array] as PropType<VNode | VNode[]>, default: undefined },
    preset: { type: Boolean, default: true },
    stack: { type: Boolean, default: true },
    gap: { type: Number, default: 8 },
    filter: {
      type: Function as PropType<(item: ReviewItemView) => boolean>,
      default: undefined,
    },
    structural: { type: Boolean, default: false },
    formatting: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    const instance = getCurrentInstance();
    const editorRef = useDocxEditor();
    const documentAbsent = useEditorState(selectDocumentAbsent);
    const readOnly = useEditorState(selectDocumentReadOnly);
    const editorRevision = useEditorRenderRevision();

    const excludeRevisionKinds = computed((): readonly ReviewRevisionKind[] | undefined => {
      const excluded: ReviewRevisionKind[] = [];
      if (!props.structural) excluded.push('structural');
      if (!props.formatting) excluded.push('format');
      return excluded.length > 0 ? excluded : undefined;
    });

    const railQuery = computed(() =>
      excludeRevisionKinds.value ? { excludeRevisionKinds: excludeRevisionKinds.value } : undefined
    );

    watch(
      [editorRef, excludeRevisionKinds],
      () => {
        editorRef.value?.setReviewActivationExclusions(excludeRevisionKinds.value ?? null);
      },
      { immediate: true }
    );
    onUnmounted(() => {
      editorRef.value?.setReviewActivationExclusions(null);
    });

    provideEditorRenderRevision(editorRevision);
    const allReview = useReviewWithRevision(NO_PLACEMENT_REVIEW_QUERY, editorRevision);
    const reviewHook = useReviewWithRevision(() => railQuery.value, editorRevision);
    const { t: bundled } = useTranslation();
    const label = (key: string, params?: Record<string, string | number>) =>
      props.t?.(key, params) ?? bundled(key as never, params as never);

    const railRef = shallowRef<HTMLElement | null>(null);
    const railRegistry = inject(
      ReviewRailContext,
      shallowRef<ReviewRailRegistry>({
        mounted: 0,
        register: () => () => {},
        registerCommentDraft: () => () => {},
        requestCommentDraft: () => false,
      })
    );
    const mounted = ref(false);
    let unregisterRail: (() => void) | undefined;
    const syncRailRegistration = () => {
      if (!mounted.value || props.hidden) {
        unregisterRail?.();
        unregisterRail = undefined;
        return;
      }
      unregisterRail ??= railRegistry.value.register();
    };
    onMounted(() => {
      mounted.value = true;
      syncRailRegistration();
    });
    watch(() => props.hidden, syncRailRegistration);

    const open = computed(() => reviewHook.paneOpen.value);
    const gutter = useReviewGutter();
    const measuredGutterEnd = ref<number | null>(null);
    const compact = computed(
      () =>
        open.value &&
        (measuredGutterEnd.value ?? gutter.value.inlineEnd) > 0 &&
        (measuredGutterEnd.value ?? gutter.value.inlineEnd) < REVIEW_PANE_GUTTER
    );
    const expanded = computed(() => open.value && !compact.value);

    const items = computed(() =>
      props.filter
        ? reviewHook.items.value.filter((entry) => props.filter!(entry))
        : reviewHook.items.value
    );

    const authorSlots = computed(() => {
      const slotsMap = new Map<string, number>();
      for (const entry of items.value) {
        if (entry.author && !slotsMap.has(entry.author)) slotsMap.set(entry.author, slotsMap.size);
      }
      return slotsMap;
    });
    const roster = useReviewAuthors();
    const syntheticAuthors = new Map<string, ReviewAuthorInfo>();
    const authorInfo = computed(() =>
      resolveReviewAuthorInfo(
        roster.value,
        items.value,
        authorSlots.value,
        editorRef.value,
        syntheticAuthors
      )
    );

    const byId = computed(() => {
      const map = new Map<string, ReviewItemView>();
      for (const entry of allReview.items.value) map.set(entry.id, entry);
      return map;
    });

    const heights = ref<ReadonlyMap<string, number>>(new Map());
    const measureHeight = (key: string, height: number) => {
      if (height <= 0) return;
      if (heights.value.get(key) === height) return;
      const next = new Map(heights.value);
      next.set(key, height);
      heights.value = next;
    };
    const observeSlot = useReviewSlotSizing(measureHeight);

    const metrics = ref<RailMetrics>(INITIAL_METRICS);
    let metricsCleanup: (() => void) | undefined;
    watch(
      [editorRef, items, documentAbsent, () => props.hidden, railRef, compact],
      () => {
        metricsCleanup?.();
        metricsCleanup = undefined;
        const rail = railRef.value;
        const editor = editorRef.value;
        if (!editor || !rail || documentAbsent.value || props.hidden) return;
        const parent = rail.offsetParent as HTMLElement | null;
        const surface = parent?.querySelector<HTMLElement>('.docx-paginated-surface') ?? null;
        const sync = (): void => {
          if (parent) {
            const reserved = Number.parseFloat(
              getComputedStyle(parent).getPropertyValue('--docx-review-gutter')
            );
            measuredGutterEnd.value = Number.isFinite(reserved) ? reserved : null;
          } else {
            measuredGutterEnd.value = null;
          }
          const box = surface && parent ? surface.getBoundingClientRect() : null;
          const frame = box && parent ? parent.getBoundingClientRect() : null;
          const left =
            box && frame && parent
              ? box.right - frame.left - parent.clientLeft + parent.scrollLeft + RAIL_GUTTER
              : null;
          const next: RailMetrics = {
            scale: editor.getRenderScale(),
            top:
              box && frame && parent
                ? box.top - frame.top - parent.clientTop + parent.scrollTop
                : 0,
            left,
            compactCardLeft:
              left === null || !parent
                ? null
                : parent.scrollLeft +
                  parent.clientWidth -
                  left -
                  COMPACT_CARD_WIDTH -
                  COMPACT_CARD_INSET,
          };
          const previous = metrics.value;
          if (
            previous.scale !== next.scale ||
            previous.top !== next.top ||
            previous.left !== next.left ||
            previous.compactCardLeft !== next.compactCardLeft
          ) {
            metrics.value = next;
          }
        };
        sync();
        const observer = new ResizeObserver(sync);
        if (parent) observer.observe(parent);
        if (surface) observer.observe(surface);
        const mutationObserver =
          parent && typeof MutationObserver !== 'undefined' ? new MutationObserver(sync) : null;
        mutationObserver?.observe(parent!, { attributes: true, attributeFilter: ['style'] });
        if (!compact.value || !parent) {
          metricsCleanup = () => {
            mutationObserver?.disconnect();
            observer.disconnect();
          };
          return;
        }
        let frameId = 0;
        const onScroll = () => {
          if (frameId !== 0) return;
          frameId = requestAnimationFrame(() => {
            frameId = 0;
            sync();
          });
        };
        parent.addEventListener('scroll', onScroll, { passive: true });
        metricsCleanup = () => {
          if (frameId !== 0) cancelAnimationFrame(frameId);
          parent.removeEventListener('scroll', onScroll);
          mutationObserver?.disconnect();
          observer.disconnect();
        };
      },
      { flush: 'post' }
    );
    onUnmounted(() => metricsCleanup?.());

    let dismissCleanup: (() => void) | undefined;
    watch(
      [editorRef, documentAbsent, () => props.hidden, railRef],
      () => {
        dismissCleanup?.();
        dismissCleanup = undefined;
        const rail = railRef.value;
        const editor = editorRef.value;
        if (!editor || !rail || documentAbsent.value || props.hidden) return;
        const onMouseDown = (event: MouseEvent): void => {
          const target = event.target;
          if (!(target instanceof Node) || rail.contains(target)) return;
          const container = rail.offsetParent as HTMLElement | null;
          if (!container || !container.contains(target)) return;
          const surface = container.querySelector('.docx-paginated-surface');
          if (surface?.contains(target)) return;
          editor.setActiveReviewItem(null);
        };
        document.addEventListener('mousedown', onMouseDown, true);
        dismissCleanup = () => document.removeEventListener('mousedown', onMouseDown, true);
      },
      { flush: 'post' }
    );
    onUnmounted(() => dismissCleanup?.());

    const scrollWindow = ref<{ top: number; bottom: number } | null>(null);
    let scrollCleanup: (() => void) | undefined;
    watch(
      [editorRef, documentAbsent, () => props.hidden, railRef],
      () => {
        scrollCleanup?.();
        scrollCleanup = undefined;
        const rail = railRef.value;
        const scroller = rail?.offsetParent as HTMLElement | null;
        if (!scroller || documentAbsent.value || props.hidden) return;
        let frame = 0;
        const sync = (): void => {
          frame = 0;
          const top = scroller.scrollTop - RAIL_OVERSCAN;
          const bottom = scroller.scrollTop + scroller.clientHeight + RAIL_OVERSCAN;
          const previous = scrollWindow.value;
          scrollWindow.value =
            previous && previous.top === top && previous.bottom === bottom
              ? previous
              : { top, bottom };
        };
        let settle = 0;
        const onScroll = (): void => {
          if (frame === 0) frame = requestAnimationFrame(sync);
          rail?.setAttribute('data-scrolling', '');
          window.clearTimeout(settle);
          settle = window.setTimeout(() => rail?.removeAttribute('data-scrolling'), 150);
        };
        sync();
        scroller.addEventListener('scroll', onScroll, { passive: true });
        const observer = new ResizeObserver(onScroll);
        observer.observe(scroller);
        scrollCleanup = () => {
          if (frame !== 0) cancelAnimationFrame(frame);
          window.clearTimeout(settle);
          scroller.removeEventListener('scroll', onScroll);
          observer.disconnect();
        };
      },
      { flush: 'post' }
    );
    onUnmounted(() => scrollCleanup?.());

    const draftAnchorY = ref<number | null>(null);
    const selectionRetainer = shallowRef<{
      editor: DocxEditorInstance;
      pin: SelectionPin;
    } | null>(null);

    const releaseRetainedSelection = () => {
      const retained = selectionRetainer.value;
      if (retained) retained.editor.releaseSelection(retained.pin);
      selectionRetainer.value = null;
      draftAnchorY.value = null;
    };

    watch(
      () => editorRef.value,
      (editor, previous) => {
        if (previous && previous !== editor && selectionRetainer.value?.editor === previous) {
          releaseRetainedSelection();
        }
      }
    );

    const beginDraft = () => {
      const editor = editorRef.value;
      if (!editor || readOnly.value) return;
      const anchorY = editor.getSelectionPlacement()?.anchorY ?? null;
      if (anchorY === null) return;
      releaseRetainedSelection();
      const pin = editor.retainSelection();
      if (!pin) return;
      selectionRetainer.value = { editor, pin };
      reviewHook.setPaneOpen(true);
      draftAnchorY.value = anchorY;
      instance?.proxy?.$forceUpdate();
    };
    let unregisterCommentDraft: (() => void) | undefined;
    const syncCommentDraftRegistration = () => {
      if (!mounted.value || props.hidden) {
        unregisterCommentDraft?.();
        unregisterCommentDraft = undefined;
        return;
      }
      unregisterCommentDraft ??= railRegistry.value.registerCommentDraft(beginDraft);
    };
    onMounted(syncCommentDraftRegistration);
    watch(() => props.hidden, syncCommentDraftRegistration);
    const endDraft = () => {
      releaseRetainedSelection();
      editorRef.value?.focus();
      instance?.proxy?.$forceUpdate();
    };

    watch(open, (paneOpen) => {
      if (paneOpen || draftAnchorY.value === null) return;
      releaseRetainedSelection();
    });

    onBeforeUnmount(() => {
      mounted.value = false;
      unregisterRail?.();
      unregisterRail = undefined;
      unregisterCommentDraft?.();
      unregisterCommentDraft = undefined;
      releaseRetainedSelection();
    });

    const composeAnchorY = computed(() => draftAnchorY.value ?? reviewHook.selectionAnchorY.value);

    const roots = computed(() => {
      const present = idsOf(items.value);
      return items.value.filter((entry) => !isThreadedReply(entry, present));
    });

    const stackInput = computed(() => {
      const draftY = draftAnchorY.value;
      if (draftY === null) return roots.value;
      const at = roots.value.findIndex((entry) => entry.anchorY !== null && entry.anchorY > draftY);
      const compose = { key: COMPOSE_KEY, anchorY: draftY };
      return at === -1
        ? [...roots.value, compose]
        : [...roots.value.slice(0, at), compose, ...roots.value.slice(at)];
    });

    const estimatedHeights = computed(() => {
      const merged = new Map(heights.value);
      for (const entry of roots.value) {
        if (merged.has(entry.key)) continue;
        const textLength =
          entry.text.length + (entry.kind === 'revision' ? (entry.replacedText?.length ?? 0) : 0);
        const lines = Math.min(6, Math.max(1, Math.ceil(textLength / 36)));
        merged.set(entry.key, 64 + lines * 20);
      }
      return merged;
    });

    const stackedLayout = computed(() => {
      const scale = metrics.value.scale;
      const positions = new Map<string, number>();
      const collapsed = new Set<string>();
      let cursor = Number.NEGATIVE_INFINITY;
      for (const entry of stackInput.value) {
        const top =
          entry.anchorY === null
            ? Number.isFinite(cursor)
              ? cursor
              : 0
            : Math.max(entry.anchorY, cursor);
        positions.set(entry.key, top);
        const displacedPx = entry.anchorY === null ? 0 : (top - entry.anchorY) * scale;
        const isActive = 'isActive' in entry && entry.isActive;
        const collapse =
          displacedPx > COLLAPSE_DISPLACEMENT_PX && !isActive && entry.key !== COMPOSE_KEY;
        if (collapse) collapsed.add(entry.key);
        const height = collapse
          ? COLLAPSED_CARD_HEIGHT
          : (estimatedHeights.value.get(entry.key) ?? DEFAULT_CARD_HEIGHT);
        cursor = top + (height + props.gap) / scale;
      }
      return { stacked: positions, collapsedKeys: collapsed };
    });

    const composeTop = computed(() => {
      if (composeAnchorY.value === null) return null;
      return (
        metrics.value.top +
        (compact.value
          ? composeAnchorY.value
          : (stackedLayout.value.stacked.get(COMPOSE_KEY) ?? composeAnchorY.value)) *
          metrics.value.scale
      );
    });

    const reviewActions = computed(() => {
      void reviewHook.commentResolutionDisabledReason.value;
      void reviewHook.selectionAnchorY.value;
      void reviewHook.paneOpen.value;
      void reviewHook.items.value.length;
      return buildReviewActions(reviewHook, items.value);
    });

    const currentRailValue = (): ReviewRailValue => ({
      t: props.t,
      cardClassName: props.card?.className,
      readOnly: readOnly.value,
      composeTop: composeTop.value,
      review: reviewActions.value,
      allItems: allReview.items.value,
      authorSlots: authorSlots.value,
      authorInfo: authorInfo.value,
      byId: byId.value,
      measure: observeSlot,
      beginDraft,
      endDraft,
    });
    const railValue = shallowRef<ReviewRailValue>(currentRailValue());
    watchEffect(() => {
      railValue.value = currentRailValue();
    });
    watch(
      () => editorRevision.value,
      () => {
        railValue.value = currentRailValue();
        instance?.proxy?.$forceUpdate();
      },
      { flush: 'sync' }
    );

    provide(ReviewContextKey, railValue as unknown as ComputedRef<ReviewRailValue>);

    return () => {
      if (props.hidden || documentAbsent.value) return null;
      void editorRevision.value;
      void allReview.items.value;
      void draftAnchorY.value;
      void items.value.length;
      void reviewHook.selectionAnchorY.value;
      void reviewHook.paneOpen.value;
      void reviewHook.commentResolutionDisabledReason.value;
      void composeTop.value;

      const captureRailElement = (vnode: VNode) => {
        railRef.value = vnode.el instanceof HTMLElement ? vnode.el : null;
      };
      const shared = {
        onVnodeMounted: captureRailElement,
        onVnodeUpdated: captureRailElement,
        onVnodeBeforeUnmount: () => {
          railRef.value = null;
        },
        class: `docx-review${props.className ? ` ${props.className}` : ''}`,
        'data-testid': 'review-rail',
        'data-count': items.value.length,
        'data-open': expanded.value ? '' : undefined,
        'data-compact': compact.value ? '' : undefined,
        role: 'complementary' as const,
        'aria-label': label('review.ariaLabel'),
        onMousedown: guardMousedown,
        style:
          metrics.value.left === null
            ? undefined
            : { left: `${metrics.value.left}px`, right: 'auto' },
      };

      const defaultNodes = slots.default?.() ?? [];
      const asChildHost =
        props.asChild && defaultNodes.length === 1 && isVNode(defaultNodes[0])
          ? defaultNodes[0]
          : null;
      const { parts: rootParts, rest: rootRest } = partitionReviewChildren(
        asChildHost ? [] : defaultNodes,
        'root'
      );

      const listProps = {
        stack: props.stack,
        positions: stackedLayout.value.stacked,
        collapsed: stackedLayout.value.collapsedKeys,
        scale: metrics.value.scale,
        offset: metrics.value.top,
        window: scrollWindow.value,
      };

      const markers = h(ReviewMarkers, {
        scale: metrics.value.scale,
        offset: metrics.value.top,
        window: scrollWindow.value,
      });
      const activeRoot = compact.value
        ? (roots.value.find((entry) => entry.key === reviewHook.activeKey.value) ?? null)
        : null;
      const compactTop =
        activeRoot === null
          ? null
          : activeRoot.anchorY !== null
            ? metrics.value.top + activeRoot.anchorY * metrics.value.scale
            : scrollWindow.value !== null
              ? scrollWindow.value.top + RAIL_OVERSCAN + 24
              : null;
      const listParts = partitionReviewChildren(rootRest, 'list');
      const compactCardInner =
        activeRoot && slots.item
          ? slots.item({ item: activeRoot })
          : listParts.parts.Card
            ? cloneReviewCard(listParts.parts.Card, props.card?.className)
            : props.preset
              ? h(
                  ReviewCard,
                  props.card?.className ? { className: props.card.className } : {},
                  () => listParts.rest
                )
              : null;
      const compactCard =
        activeRoot &&
        compactTop !== null &&
        metrics.value.compactCardLeft !== null &&
        compactCardInner
          ? h(
              ReviewItemScope,
              {
                entry: activeRoot,
                className: 'docx-review__slot--compact',
                testId: 'review-compact-card',
                style: {
                  position: 'absolute',
                  top: `${compactTop}px`,
                  left: `${metrics.value.compactCardLeft}px`,
                  width: `${COMPACT_CARD_WIDTH}px`,
                },
              },
              () => compactCardInner
            )
          : null;

      const body = expanded.value
        ? props.preset || 'List' in rootParts
          ? takeRoot(
              'List',
              h(ReviewList, listProps, {
                ...(rootRest.length > 0 ? { default: () => rootRest } : {}),
                ...(slots.item ? { item: slots.item } : {}),
              }),
              rootParts
            )
          : rootRest
        : props.preset || 'Markers' in rootParts
          ? [takeRoot('Markers', markers, rootParts), compactCard]
          : rootRest;
      const content = [
        expanded.value && props.furniture !== undefined
          ? h('div', { class: 'docx-review__furniture', 'data-testid': 'review-furniture' }, [
              props.furniture,
            ])
          : null,
        body,
        ...(props.preset || 'AddComment' in rootParts
          ? [
              takeRoot(
                'AddComment',
                h(ReviewAddComment, {
                  top: composeTop.value,
                  drafting: draftAnchorY.value !== null,
                }),
                rootParts
              ),
            ]
          : []),
        ...(draftAnchorY.value === null ||
        composeTop.value === null ||
        !open.value ||
        (!props.preset && !('Draft' in rootParts))
          ? []
          : [
              takeRoot(
                'Draft',
                h(ReviewDraftMount, {
                  top: composeTop.value ?? 0,
                  left: compact.value ? metrics.value.compactCardLeft : null,
                }),
                rootParts
              ),
            ]),
        ...(props.preset || 'Balloon' in rootParts
          ? [takeRoot('Balloon', h(ReviewBalloon), rootParts)]
          : []),
      ] as VNodeArrayChildren;
      const child = asChildHost;
      if (!child) return h('aside', shared, content);
      const cloned = cloneVNode(child, shared, true);
      if (typeof child.type === 'string') {
        const original = Array.isArray(child.children)
          ? child.children
          : child.children == null
            ? []
            : typeof child.children === 'string' || typeof child.children === 'number'
              ? [child.children]
              : [];
        cloned.children = [...original, ...content] as VNodeArrayChildren;
        cloned.shapeFlag = (cloned.shapeFlag & ~8) | 16;
      } else {
        const childSlots =
          child.children && !Array.isArray(child.children) && typeof child.children === 'object'
            ? (child.children as Record<string, (...args: unknown[]) => unknown>)
            : {};
        const originalDefault = childSlots.default;
        cloned.children = {
          ...childSlots,
          default: (...args: unknown[]) => [
            ...(originalDefault ? [originalDefault(...args)] : []),
            ...content,
          ],
        };
        cloned.shapeFlag = (cloned.shapeFlag & ~24) | 32;
      }
      return cloned;
    };
  },
});

export { useReviewItem };
export type {
  ReviewActionProps,
  ReviewMarkersProps,
  ReviewPartProps,
  ReviewProps,
} from './review-types.ts';

export const DocxEditorReview = Object.assign(ReviewRoot, {
  List: ReviewList,
  Empty: ReviewEmpty,
  Card: ReviewCard,
  Avatar: ReviewAvatar,
  Author: ReviewAuthor,
  Time: ReviewTime,
  Summary: ReviewSummary,
  Accept: ReviewAccept,
  Reject: ReviewReject,
  Resolve: ReviewResolve,
  Reopen: ReviewReopen,
  Delete: ReviewDelete,
  Replies: ReviewReplies,
  Reply: ReviewReply,
  Markers: ReviewMarkers,
  AddComment: ReviewAddComment,
  Draft: ReviewDraft,
  Balloon: ReviewBalloon,
});

/** @public */
export type DocxEditorReviewNamespace = typeof DocxEditorReview;
