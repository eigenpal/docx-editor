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
  inject,
  onBeforeUnmount,
  onMounted,
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
import { useTranslation } from '@docx-editor.dev/vue';
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
  readonly byId: ReadonlyMap<string, ReviewItemView>;
  readonly measure: (node: HTMLElement | null, key: string) => void;
  readonly beginDraft: () => void;
  readonly endDraft: () => void;
}

export const ReviewContextKey: InjectionKey<ComputedRef<ReviewRailValue>> = Symbol('ReviewContext');
export const ReviewItemContextKey: InjectionKey<ComputedRef<ReviewItemView | null>> =
  Symbol('ReviewItemContext');

const INERT_REVIEW: ReviewActions = {
  items: [],
  activeKey: null,
  setActive: () => false,
  accept: () => false,
  reject: () => false,
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
  byId: new Map(),
  measure: () => {},
  beginDraft: () => {},
  endDraft: () => {},
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
 * The result updates when the author or revision style declarations change.
 *
 * @public
 */
export function useReviewAuthor(
  author: MaybeRefOrGetter<string | undefined>
): ComputedRef<ReviewAuthorInfo | undefined> {
  const rail = useRail();
  return computed(() => {
    const name = toValue(author);
    return name === undefined ? undefined : rail.value.authorInfo.get(name);
  });
}

/** @internal */
export function useReviewLabel(): (key: TranslationKey) => string {
  const rail = useRail();
  const { t } = useTranslation();
  return (key: TranslationKey) => rail.value.t?.(key) ?? t(key);
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
    onMounted(() => {
      const el = getCurrentInstance()?.proxy?.$el;
      if (props.measureKey && el instanceof HTMLElement) {
        rail.value.measure(el, props.measureKey);
      }
    });
    onBeforeUnmount(() => {
      if (props.measureKey) rail.value.measure(null, props.measureKey);
    });
    return () =>
      h(
        'div',
        {
          key: reviewItemRenderKey(item.value),
          class: `docx-review__slot${props.className ? ` ${props.className}` : ''}`,
          ...(props.testId ? { 'data-testid': props.testId } : {}),
          style: props.style,
          ...(props.collapsed ? { 'data-collapsed': '' } : {}),
        },
        slots.default?.()
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
