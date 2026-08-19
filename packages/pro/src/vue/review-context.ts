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
  onMounted,
  provide,
  type ComputedRef,
  type CSSProperties,
  type InjectionKey,
  type PropType,
  type VNode,
} from 'vue';
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

/** @internal */
export function useReviewLabel(): (key: TranslationKey) => string {
  const rail = useRail();
  const { t } = useTranslation();
  return (key: TranslationKey) => rail.value.t?.(key) ?? t(key);
}

/** Provides review-item context and owns the slot wrapper ref in the same render owner. @internal */
export const ReviewItemScope = defineComponent({
  name: 'ReviewItemScope',
  props: {
    entry: { type: Object as PropType<ReviewItemView>, required: true },
    measureKey: String,
    collapsed: Boolean,
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props, { slots }) {
    const rail = useRail();
    const item = computed(() => {
      const live = rail.value.byId.get(props.entry.id) ?? props.entry;
      return {
        ...live,
        replyIds: [...live.replyIds],
      };
    });
    provide(ReviewItemContextKey, item);
    onMounted(() => {
      const el = getCurrentInstance()?.proxy?.$el;
      if (props.measureKey && el instanceof HTMLElement) {
        rail.value.measure(el, props.measureKey);
      }
    });
    return () =>
      h(
        'div',
        {
          class: 'docx-review__slot',
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
    const item = computed(() => {
      const live = rail.value.byId.get(props.entry.id) ?? props.entry;
      return {
        ...live,
        replyIds: [...live.replyIds],
      };
    });
    provide(ReviewItemContextKey, item);
    return () => slots.default?.() as VNode | VNode[] | null;
  },
});

export { INERT_RAIL, INERT_REVIEW };
