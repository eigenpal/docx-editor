/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The package builds its React and Vue entries together; this file uses Vue's JSX runtime.
/** @jsxImportSource vue */

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
import {
  reviewPaneListsItem,
  type DocxEditorInstance,
  type ReviewAuthorInfo,
  isDomNode,
  isHTMLElementNode,
  hostDocumentOf,
  hostWindowOf,
} from '@docx-editor.dev/core/editor';
import type { ReviewRevisionKind, SelectionPin } from '@docx-editor.dev/core/contracts/editor';
import {
  ReviewRailContext,
  useDocxEditor,
  useEditorEvent,
  useEditorState,
  useReviewAuthors,
  useReviewGutter,
  useChromeDir,
  useTranslation,
  REVIEW_PANE_GUTTER,
  type ReviewRailRegistry,
} from '@docx-editor.dev/vue';
import { useReviewWithRevision, type ReviewItemView, type UseReviewReturn } from './useReview.ts';
import { provideEditorRenderRevision, useEditorRenderRevision } from './useEditorRenderRevision.ts';
import {
  cloneReviewCard,
  listCardTemplate,
  partitionReviewChildren,
  slotNodes,
} from './review-composition.ts';
import { hasFormattingBalloon } from './review-balloon-anchor.ts';
import {
  COLLAPSE_DISPLACEMENT_PX,
  COLLAPSED_CARD_HEIGHT,
  COMPACT_CARD_WIDTH,
  COMPOSE_KEY,
  DEFAULT_CARD_HEIGHT,
  NO_PLACEMENT_REVIEW_QUERY,
  PAIRED_REVIEW_QUERY,
  RAIL_OVERSCAN,
  guardMousedown,
  idsOf,
  isThreadedReply,
  selectCommentMarkers,
  selectDocumentAbsent,
  selectDocumentReadOnly,
  selectPaneOpening,
  selectRevisionsIn,
} from './review-shared.ts';
import { useRailWindow } from './use-rail-window.ts';
import {
  ReviewContextKey,
  ReviewItemScope,
  useReviewItem,
  type ReviewRailValue,
} from './review-context.ts';
import type { ReviewActions } from './review-types.ts';
import { stackRailCards } from '../review/rail-stack.ts';
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
  ReviewRefusal,
  ReviewRefusalAnnouncer,
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
import { listenForCommentClicks } from '../review/comment-click-opens-pane.ts';
import { bindReviewRailMetrics, ReviewRailMetricsKey } from './useReviewRailMetrics.ts';
import { isCompactReviewColumn } from '../review/rail-metrics.ts';

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
    activatedKey: hook.activatedKey.value,
    setActive: hook.setActive,
    accept: hook.accept,
    reject: hook.reject,
    adopt: hook.adopt,
    resolve: hook.resolve,
    reopen: hook.reopen,
    commentResolutionDisabledReason: hook.commentResolutionDisabledReason.value,
    remove: hook.remove,
    reply: hook.reply,
    selectionAnchorY: hook.selectionAnchorY.value,
    comment: hook.comment,
    lastRefusal: hook.lastRefusal.value,
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
    structural: { type: Boolean, default: true },
    formatting: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    const instance = getCurrentInstance();
    const editorRef = useDocxEditor();
    const documentAbsent = useEditorState(selectDocumentAbsent);
    const readOnly = useEditorState(selectDocumentReadOnly);
    // Viewer preferences, live: `setRevisionMarkup` re-renders the rail with the new layout.
    const revisionsIn = useEditorState(selectRevisionsIn);
    const commentMarkers = useEditorState(selectCommentMarkers);
    const editorRevision = useEditorRenderRevision();

    const excludeRevisionKinds = computed((): readonly ReviewRevisionKind[] | undefined => {
      const excluded: ReviewRevisionKind[] = [];
      if (!props.structural) excluded.push('structural');
      if (!props.formatting) excluded.push('format');
      return excluded.length > 0 ? excluded : undefined;
    });

    // The pane lists each half of a replacement as its own card, so each stays reviewable.
    const railQuery = computed(() => ({
      pairReplacements: false,
      excludeRevisionKinds: excludeRevisionKinds.value?.filter((kind) => kind !== 'format'),
    }));

    watch(
      [editorRef, excludeRevisionKinds],
      () => {
        editorRef.value?.setReviewActivationExclusions(excludeRevisionKinds.value ?? null, {
          formattingKinds: ['rPrChange', 'pPrChange'],
        });
      },
      { immediate: true }
    );
    onUnmounted(() => {
      editorRef.value?.setReviewActivationExclusions(null);
    });

    provideEditorRenderRevision(editorRevision);
    // `revisionsIn: 'balloons'` reads replacement pairs so a typed-over range is one decision.
    const allReview = useReviewWithRevision(
      () => (revisionsIn.value === 'balloons' ? PAIRED_REVIEW_QUERY : NO_PLACEMENT_REVIEW_QUERY),
      editorRevision
    );
    const reviewHook = useReviewWithRevision(() => railQuery.value, editorRevision);
    const translation = useTranslation();
    const chromeDir = useChromeDir();
    const bundled = translation.t;
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
    const compact = computed(() =>
      isCompactReviewColumn(
        open.value,
        measuredGutterEnd.value ?? gutter.value.inlineEnd,
        REVIEW_PANE_GUTTER
      )
    );
    const expanded = computed(() => open.value && !compact.value);

    // The engine's rule, applied before this rail's own filters. The engine decides whether the
    // pane opens from the same rule over every item, so the rail lists what the engine counts,
    // less what `structural`, `formatting`, and `filter` hide. `railQuery` removes the reply
    // link of a comment on a hidden change, but the balloon still draws that reply under the
    // change, so the rule reads the link from the unfiltered read.
    const unfilteredById = computed(() =>
      revisionsIn.value === 'balloons'
        ? new Map(allReview.items.value.map((entry) => [entry.id, entry]))
        : null
    );
    const items = computed(() =>
      reviewHook.items.value.filter(
        (entry) =>
          reviewPaneListsItem(revisionsIn.value, unfilteredById.value?.get(entry.id) ?? entry) &&
          (props.formatting || !hasFormattingBalloon(entry)) &&
          (!props.filter || props.filter(entry))
      )
    );
    // A revealed card opens a closed pane, as a click on its marker does, unless the pane's
    // `opening` setting leaves that to the host. A change that the balloon serves is not in
    // `items`, so the balloon opens it instead.
    const paneOpening = useEditorState(selectPaneOpening);
    useEditorEvent('reviewItemReveal', ({ key }) => {
      if (props.hidden || paneOpening.value === 'manual') return;
      if (items.value.some((entry) => entry.key === key)) reviewHook.setPaneOpen(true);
    });
    const expandedResolvedKey = ref<string | null>(null);
    watch(
      items,
      (entries) => {
        const key = expandedResolvedKey.value;
        if (
          key !== null &&
          !entries.some((entry) => entry.key === key && entry.kind === 'comment' && entry.resolved)
        ) {
          expandedResolvedKey.value = null;
        }
      },
      { flush: 'sync' }
    );
    const configuredAuthor = useEditorState(() => editorRef.value?.getConfiguredAuthor() ?? null);
    const authorSlots = computed(() => {
      const slotsMap = new Map<string, number>();
      for (const entry of items.value) {
        if (entry.author && !slotsMap.has(entry.author)) slotsMap.set(entry.author, slotsMap.size);
      }
      if (configuredAuthor.value && !slotsMap.has(configuredAuthor.value)) {
        slotsMap.set(configuredAuthor.value, slotsMap.size);
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

    // Where the rail sits, from the shared `../review/rail-metrics.ts`. The viewport's
    // reserved gutter is read on the same pass, so `compact` follows a style change at once.
    const metrics = bindReviewRailMetrics({
      rail: () => (documentAbsent.value || props.hidden ? null : railRef.value),
      editor: () => editorRef.value,
      trackScroll: () => compact.value,
      remeasure: () => items.value,
      beforeMeasure: (parent) => {
        const reserved = parent
          ? Number.parseFloat(
              hostWindowOf(parent).getComputedStyle(parent).getPropertyValue('--docx-review-gutter')
            )
          : Number.NaN;
        measuredGutterEnd.value = Number.isFinite(reserved) ? reserved : null;
      },
    });
    provide(
      ReviewRailMetricsKey,
      computed(() => ({ ...metrics.value, compact: compact.value }))
    );

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
          if (!isDomNode(target) || rail.contains(target)) return;
          const container = rail.offsetParent as HTMLElement | null;
          if (!container || !container.contains(target)) return;
          const surface = container.querySelector('.docx-paginated-surface');
          if (surface?.contains(target)) return;
          editor.setActiveReviewItem(null);
        };
        const doc = hostDocumentOf(rail);
        doc.addEventListener('mousedown', onMouseDown, true);
        dismissCleanup = () => doc.removeEventListener('mousedown', onMouseDown, true);
      },
      { flush: 'post' }
    );
    onUnmounted(() => dismissCleanup?.());

    // A click on commented text opens the closed pane on its card, as a click on its marker
    // does: a reader's own press, so the `opening` setting does not hold it back.
    let commentClickCleanup: (() => void) | undefined;
    watch(
      [editorRef, documentAbsent, () => props.hidden, railRef],
      () => {
        commentClickCleanup?.();
        commentClickCleanup = undefined;
        const rail = railRef.value;
        const editor = editorRef.value;
        if (!editor || !rail || documentAbsent.value || props.hidden) return;
        commentClickCleanup = listenForCommentClicks(rail, editor, (key) => {
          if (reviewHook.paneOpen.value) return;
          if (items.value.some((entry) => entry.key === key)) reviewHook.setPaneOpen(true);
        });
      },
      { flush: 'post' }
    );
    onUnmounted(() => commentClickCleanup?.());

    const scrollWindow = useRailWindow(
      editorRef,
      railRef,
      () => !documentAbsent.value && !props.hidden
    );

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

    // The open card stays beside its text; see `stackRailCards`.
    const stackedLayout = computed(() => {
      const { positions, collapsed } = stackRailCards(
        stackInput.value.map((entry) => ({
          key: entry.key,
          anchorY: entry.anchorY,
          isActive: 'isActive' in entry && entry.isActive,
        })),
        {
          gap: props.gap,
          scale: metrics.value.scale,
          collapseAfterPx: COLLAPSE_DISPLACEMENT_PX,
          heightOf: (key, folded) =>
            folded
              ? COLLAPSED_CARD_HEIGHT
              : (estimatedHeights.value.get(key) ?? DEFAULT_CARD_HEIGHT),
          collapsible: (entry) => entry.key !== COMPOSE_KEY,
        }
      );
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

    const currentRailValue = (): ReviewRailValue => {
      const draftAuthor = configuredAuthor.value;
      const draftAuthorSlot = draftAuthor ? (authorSlots.value.get(draftAuthor) ?? 0) : 0;
      return {
        t: props.t,
        cardClassName: props.card?.className,
        readOnly: readOnly.value,
        composeTop: composeTop.value,
        composeLeft: compact.value ? metrics.value.compactCardLeft : null,
        drafting: draftAnchorY.value !== null,
        review: reviewActions.value,
        allItems: allReview.items.value,
        authorSlots: authorSlots.value,
        authorInfo: authorInfo.value,
        draftAuthor,
        draftAuthorInfo: draftAuthor ? authorInfo.value.get(draftAuthor) : undefined,
        draftAuthorSlot,
        byId: byId.value,
        measure: observeSlot,
        beginDraft,
        endDraft,
        expandedResolvedKey: expandedResolvedKey.value,
        setExpandedResolvedKey: (key) => {
          expandedResolvedKey.value = key;
        },
        commentMarkers: commentMarkers.value,
        revisionsIn: revisionsIn.value,
      };
    };
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
        railRef.value = isHTMLElementNode(vnode.el) ? vnode.el : null;
      };
      const shared = {
        onVnodeMounted: captureRailElement,
        onVnodeUpdated: captureRailElement,
        onVnodeBeforeUnmount: () => {
          railRef.value = null;
        },
        class: `docx-review${props.className ? ` ${props.className}` : ''}`,
        dir: chromeDir.value,
        'data-testid': 'review-rail',
        'data-count': items.value.length,
        'data-open': expanded.value ? '' : undefined,
        'data-compact': compact.value ? '' : undefined,
        role: 'region' as const,
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
            : scrollWindow.value !== null && Number.isFinite(scrollWindow.value.top)
              ? scrollWindow.value.top + RAIL_OVERSCAN + 24
              : null;
      // The same card template the List renders: a host's List part (its item slot, its
      // `Card` part, or part overrides plus extra children) must reach the floating card
      // too, or compact silently swaps in the packaged parts the host hid or replaced. With
      // no List template the root's children stand in, as they do for the implicit List.
      const fromList = listCardTemplate(rootParts.List);
      const itemSlot = fromList ? fromList.item : slots.item;
      const listParts = partitionReviewChildren(
        fromList ? slotNodes(fromList.default?.()) : rootRest,
        'list'
      );
      const compactCardInner =
        fromList?.hidden || !activeRoot
          ? null
          : itemSlot
            ? itemSlot({ item: activeRoot })
            : listParts.parts.Card
              ? cloneReviewCard(listParts.parts.Card, props.card?.className)
              : props.preset || fromList
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
        h(ReviewRefusalAnnouncer),
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
  ReviewBalloonProps,
  ReviewDraftProps,
  ReviewMarkersProps,
  ReviewPartProps,
  ReviewProps,
} from './review-types.ts';

/**
 * The review rail: comments and tracked changes as a compound component. Requires
 * `reviewModule()` in the editor's modules.
 *
 * PARTS AND SCOPES. The rail reads its parts from its own children, by element type. There are
 * two scopes:
 *
 * - Root parts: `List`, `Markers`, `AddComment`, `Draft`, and `Balloon`. Put them as DIRECT
 *   children of `DocxEditorReview` (fragments are transparent). The rail gives them the geometry
 *   only it can compute: the comment button's and the compose box's `top`, and the markers'
 *   scale and window. A root part inside a wrapper component is not seen as a part. It renders
 *   as ordinary content, without that wiring.
 * - Card parts: `Card`, `Empty`, and the parts inside a card (`Author`, `Summary`, `Accept`,
 *   `Reject`, `Reply`, and the others). Put them inside `DocxEditorReview.List`, or as other
 *   direct children, which become the card template.
 *
 * `:preset="false"` drops the packaged defaults. Root parts you pass still get their wiring, and
 * every other child renders as is inside the rail, where `useReviewRailMetrics()` reads the
 * rail's own measurement. To render your own cards, use `useReview().items`,
 * `useStackedReviewPositions`, and `useReviewRailMetrics`. `Draft` without `top` sits where the
 * packaged card stack puts it, so pass `top` from your own stack.
 *
 * In a browser host, this rail and `useReview()` are the way to build a review UI. For headless,
 * server, or agent pipelines, use `@docx-editor.dev/editor-api`.
 *
 * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/custom-review-cards | Custom cards in the review rail}
 *
 * @public
 */
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
  Refusal: ReviewRefusal,
  Replies: ReviewReplies,
  Reply: ReviewReply,
  Markers: ReviewMarkers,
  AddComment: ReviewAddComment,
  Draft: ReviewDraft,
  Balloon: ReviewBalloon,
});

/** @public */
export type DocxEditorReviewNamespace = typeof DocxEditorReview;
