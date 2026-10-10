/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import {
  Fragment,
  computed,
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  provide,
  shallowRef,
  toValue,
  watchEffect,
  type ComputedRef,
  type CSSProperties,
  type InjectionKey,
  type PropType,
  type VNode,
  type MaybeRefOrGetter,
} from 'vue';
import type { ReviewAuthorInfo } from '@docx-editor.dev/vue';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import type { CommentMarkerStyle, RevisionDisplay } from '@docx-editor.dev/core/editor';
import { useReviewAuthors, useTranslation } from '@docx-editor.dev/vue';
import type { ReviewActions } from './review-types.ts';
import type { ReviewItemView } from './useReview.ts';

/** @public */
export interface ReviewRailValue {
  readonly t: ((key: string, params?: Record<string, string | number>) => string) | undefined;
  readonly cardClassName: string | undefined;
  readonly readOnly: boolean;
  readonly composeTop: number | null;
  readonly review: ReviewActions;
  readonly allItems: readonly ReviewItemView[];
  readonly authorSlots: ReadonlyMap<string, number>;
  readonly authorInfo: ReadonlyMap<string, ReviewAuthorInfo>;
  readonly draftAuthor: string | null;
  readonly draftAuthorInfo: ReviewAuthorInfo | undefined;
  readonly draftAuthorSlot: number;
  readonly byId: ReadonlyMap<string, ReviewItemView>;
  readonly measure: (node: HTMLElement | null, key: string) => void;
  readonly beginDraft: () => void;
  readonly endDraft: () => void;
  readonly expandedResolvedKey: string | null;
  readonly setExpandedResolvedKey: (key: string | null) => void;
  /** The `commentMarkers` review pane setting: how a comment thread's margin marker looks. */
  readonly commentMarkers: CommentMarkerStyle;
  /** The `revisionsIn` review pane setting: tracked changes as rail cards or page balloons. */
  readonly revisionsIn: RevisionDisplay;
}

export const ReviewContextKey: InjectionKey<ComputedRef<ReviewRailValue>> = Symbol('ReviewContext');
export const ReviewItemContextKey: InjectionKey<ComputedRef<ReviewItemView | null>> =
  Symbol('ReviewItemContext');

const INERT_REVIEW: ReviewActions = {
  items: [],
  activeKey: null,
  activatedKey: null,
  setActive: () => false,
  accept: () => false,
  reject: () => false,
  adopt: () => false,
  resolve: () => false,
  reopen: () => false,
  commentResolutionDisabledReason: null,
  remove: () => false,
  reply: () => false,
  selectionAnchorY: null,
  comment: () => false,
  paneOpen: true,
  setPaneOpen: () => {},
  ready: false,
};

const INERT_RAIL: ReviewRailValue = {
  t: undefined,
  cardClassName: undefined,
  readOnly: false,
  composeTop: null,
  review: INERT_REVIEW,
  allItems: [],
  authorSlots: new Map(),
  authorInfo: new Map(),
  draftAuthor: null,
  draftAuthorInfo: undefined,
  draftAuthorSlot: 0,
  byId: new Map(),
  measure: () => {},
  beginDraft: () => {},
  endDraft: () => {},
  expandedResolvedKey: null,
  setExpandedResolvedKey: () => {},
  commentMarkers: 'initials',
  revisionsIn: 'pane',
};

/** @internal */
export function useRail(): ComputedRef<ReviewRailValue> {
  return inject(
    ReviewContextKey,
    computed(() => INERT_RAIL)
  );
}

const fallbackItem = computed((): ReviewItemView | null => null);

/** @public */
export function useReviewItem(): ComputedRef<ReviewItemView | null> {
  return inject(ReviewItemContextKey, fallbackItem);
}

/**
 * Returns the resolved color, slot, and declared style for one review author.
 *
 * The result updates when the author or revision style declarations change. Outside the
 * review rail it reads the editor's author roster.
 *
 * @public
 */
export function useReviewAuthor(
  author: MaybeRefOrGetter<string | undefined>
): ComputedRef<ReviewAuthorInfo | undefined> {
  const rail = inject(ReviewContextKey, null);
  // Inside the rail its own author map answers; only a caller outside it reads the roster.
  const roster = rail ? null : useReviewAuthors();
  return computed(() => {
    const name = toValue(author);
    if (name === undefined) return undefined;
    return rail
      ? rail.value.authorInfo.get(name)
      : roster?.value.find((info) => info.author === name);
  });
}

/** @internal */
/** Placeholder values for a review label, such as `{ count: 3 }` for `{count}`. */
export type ReviewLabelParams = Readonly<Record<string, string | number>>;

/** Fill `{name}` placeholders in a host-translated label, the way the catalogue's `t()` does. */
function withParams(text: string, params: ReviewLabelParams | undefined): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole
  );
}

export function useReviewLabel(): (key: TranslationKey, params?: ReviewLabelParams) => string {
  const rail = useRail();
  const { t } = useTranslation();
  return (key: TranslationKey, params?: ReviewLabelParams) => {
    const host = rail.value.t?.(key);
    return host !== undefined ? withParams(host, params) : t(key, params);
  };
}

function reviewItemRenderKey(item: ReviewItemView): string {
  return [
    item.key,
    item.isActive ? 'active' : 'idle',
    item.readOnly ? 'readonly' : 'editable',
    item.kind === 'comment' && item.resolved ? 'resolved' : 'open',
    item.text,
    ...item.replyIds,
  ].join('\u0000');
}

/** Provides review-item context and owns the slot wrapper ref in the same render owner. @internal */
export const ReviewItemScope = defineComponent({
  name: 'ReviewItemScope',
  props: {
    entry: { type: Object as PropType<ReviewItemView>, required: true },
    measureKey: String,
    collapsed: Boolean,
    className: String,
    testId: String,
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props, { slots }) {
    const rail = useRail();
    const item = shallowRef<ReviewItemView>(props.entry);
    watchEffect(() => {
      const live = rail.value.byId.get(props.entry.id) ?? props.entry;
      item.value = {
        ...live,
        replyIds: [...live.replyIds],
      };
    });
    provide(ReviewItemContextKey, item as unknown as ComputedRef<ReviewItemView | null>);
    let measuredNode: HTMLElement | null = null;
    let measuredKey: string | null = null;
    const bindMeasuredNode = (node: Element | null): void => {
      const nextNode = node instanceof HTMLElement ? node : null;
      const nextKey = nextNode && props.measureKey ? props.measureKey : null;
      if (measuredNode === nextNode && measuredKey === nextKey) return;
      if (measuredKey) rail.value.measure(null, measuredKey);
      measuredNode = nextNode;
      measuredKey = nextKey;
      if (measuredNode && measuredKey) rail.value.measure(measuredNode, measuredKey);
    };
    onBeforeUnmount(() => {
      bindMeasuredNode(null);
    });
    return () =>
      h(
        'div',
        {
          onVnodeMounted: (vnode) => {
            bindMeasuredNode(vnode.el instanceof Element ? vnode.el : null);
          },
          onVnodeUpdated: (vnode) => {
            bindMeasuredNode(vnode.el instanceof Element ? vnode.el : null);
          },
          onVnodeBeforeUnmount: () => {
            bindMeasuredNode(null);
          },
          class: `docx-review__slot${props.className ? ` ${props.className}` : ''}`,
          ...(props.testId ? { 'data-testid': props.testId } : {}),
          style: props.style,
          ...(props.collapsed ? { 'data-collapsed': '' } : {}),
        },
        [h(Fragment, { key: reviewItemRenderKey(item.value) }, slots.default?.())]
      );
  },
});

/** Reply rows reuse item context without a measured slot wrapper. @internal */
export const ReviewReplyScope = defineComponent({
  name: 'ReviewReplyScope',
  props: {
    entry: { type: Object as PropType<ReviewItemView>, required: true },
  },
  setup(props, { slots }) {
    const rail = useRail();
    const item = shallowRef<ReviewItemView>(props.entry);
    watchEffect(() => {
      const live = rail.value.byId.get(props.entry.id) ?? props.entry;
      item.value = {
        ...live,
        replyIds: [...live.replyIds],
      };
    });
    provide(ReviewItemContextKey, item as unknown as ComputedRef<ReviewItemView | null>);
    return () => slots.default?.() as VNode | VNode[] | null;
  },
});

export { INERT_RAIL, INERT_REVIEW };
