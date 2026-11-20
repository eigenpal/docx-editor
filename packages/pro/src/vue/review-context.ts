/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
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
  type ShallowRef,
  type VNode,
  type MaybeRefOrGetter,
} from 'vue';
import { isElementNode, isHTMLElementNode } from '@docx-editor.dev/core/editor';
import type { ReviewAuthorInfo } from '@docx-editor.dev/vue';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import type { CommentMarkerStyle, RevisionDisplay } from '@docx-editor.dev/core/editor';
import { useReviewAuthors, useTranslation } from '@docx-editor.dev/vue';
import type { ReviewActions } from './review-types.ts';
import type { ReviewItemView } from './useReview.ts';

/** The review actions and state, without the fields that follow the item list. */
export type ReviewCardActions = Omit<
  ReviewActions,
  'items' | 'activeKey' | 'activatedKey' | 'selectionAnchorY'
>;

/** What a part inside a card reads from the rail. None of it follows the item list. */
export interface ReviewCardRailValue {
  readonly t: ((key: string, params?: Record<string, string | number>) => string) | undefined;
  readonly cardClassName: string | undefined;
  readonly readOnly: boolean;
  readonly review: ReviewCardActions;
  readonly authorSlots: ReadonlyMap<string, number>;
  readonly authorInfo: ReadonlyMap<string, ReviewAuthorInfo>;
  readonly draftAuthor: string | null;
  readonly draftAuthorInfo: ReviewAuthorInfo | undefined;
  readonly draftAuthorSlot: number;
  readonly beginDraft: () => void;
  readonly endDraft: () => void;
  readonly expandedResolvedKey: string | null;
  readonly setExpandedResolvedKey: (key: string | null) => void;
  /** The `commentMarkers` review pane setting: how a comment thread's margin marker looks. */
  readonly commentMarkers: CommentMarkerStyle;
  /** The `revisionsIn` review pane setting: tracked changes as rail cards or page balloons. */
  readonly revisionsIn: RevisionDisplay;
}

/**
 * Everything the rail's own parts read: the card's share plus the item lists and geometry.
 *
 * @public
 */
export interface ReviewRailValue extends Omit<ReviewCardRailValue, 'review'> {
  readonly composeTop: number | null;
  /** The compose box's rail-local `left` in the compact rail, or null in the full column. */
  readonly composeLeft: number | null;
  /** Whether a comment draft is open. A `Draft` part renders only while it is. */
  readonly drafting: boolean;
  readonly review: ReviewActions;
  readonly allItems: readonly ReviewItemView[];
  readonly byId: ReadonlyMap<string, ReviewItemView>;
  readonly measure: (node: HTMLElement | null, key: string) => void;
}

export const ReviewContextKey: InjectionKey<ComputedRef<ReviewRailValue>> = Symbol('ReviewContext');
/**
 * The part of the rail's data a card reads. Its value keeps its identity while its content is
 * equal, so an edit that changes one item does not render the cards of the others. Parts
 * inside a card read it through {@link useCardRail}.
 */
export const ReviewCardRailKey: InjectionKey<ComputedRef<ReviewCardRailValue>> =
  Symbol('ReviewCardRailContext');
/**
 * The items a card's replies resolve from, by id. Each place that renders a card provides it.
 * A card in the list gets only its own replies, which change only when one of them does; the
 * balloon and the compact card, one of each, get every item.
 */
export const ReviewThreadKey: InjectionKey<ComputedRef<ReadonlyMap<string, ReviewItemView>>> =
  Symbol('ReviewThreadContext');
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
  edit: () => false,
  selectionAnchorY: null,
  comment: () => false,
  lastRefusal: null,
  paneOpen: true,
  setPaneOpen: () => {},
  ready: false,
};

const INERT_RAIL: ReviewRailValue = {
  t: undefined,
  cardClassName: undefined,
  readOnly: false,
  composeTop: null,
  composeLeft: null,
  drafting: false,
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
  commentMarkers: 'icon',
  revisionsIn: 'pane',
};

/** @internal */
export function useRail(): ComputedRef<ReviewRailValue> {
  return inject(
    ReviewContextKey,
    computed(() => INERT_RAIL)
  );
}

const inertCardRail = computed((): ReviewCardRailValue => INERT_RAIL);

/**
 * The rail as a part inside a card reads it. It does not change when the item list does, so
 * a card renders again only for its own item, its replies, or the rail's settings.
 *
 * @internal
 */
export function useCardRail(): ComputedRef<ReviewCardRailValue> {
  return inject(ReviewCardRailKey, inertCardRail);
}

const NO_THREAD: ReadonlyMap<string, ReviewItemView> = new Map();
const noThread = computed(() => NO_THREAD);

/** The items the replies of the current card resolve from. @internal */
export function useReviewThread(): ComputedRef<ReadonlyMap<string, ReviewItemView>> {
  return inject(ReviewThreadKey, noThread);
}

/**
 * Answers `next`, or the value it answered before when `same` says the two are equal. Keeps
 * the identity of a derived value whose content did not change, so a computed that returns it
 * does not trigger the parts that read it.
 *
 * The render saving needs Vue 3.4 or later, where a computed that answers the same value does
 * not trigger its readers. Earlier versions in the peer range trigger them for each change of
 * a dependency: the parts render more often there, and show the same content.
 */
export function keeper<T>(same: (a: T, b: T) => boolean): (next: T) => T {
  let kept: { readonly value: T } | null = null;
  return (next) => {
    if (kept === null || (kept.value !== next && !same(kept.value, next))) kept = { value: next };
    return kept.value;
  };
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
  const rail = inject(ReviewCardRailKey, null);
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
  const rail = useCardRail();
  // Read `t` from the translation at each call: it is replaced when the locale changes, and
  // a `t` taken once at setup kept the labels of the first locale.
  const translation = useTranslation();
  return (key: TranslationKey, params?: ReviewLabelParams) => {
    const host = rail.value.t?.(key);
    return host !== undefined ? withParams(host, params) : translation.t(key, params);
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

/**
 * The rail's current view of an item. A copy is made only when the view object changes, so a
 * rail input that leaves the item as it was (a draft anchor, an expanded resolved card)
 * re-renders no card.
 */
function liveReviewItem(
  rail: ComputedRef<ReviewRailValue>,
  entry: () => ReviewItemView
): ShallowRef<ReviewItemView> {
  const item = shallowRef<ReviewItemView>(entry());
  let source: ReviewItemView | null = null;
  watchEffect(() => {
    const live = rail.value.byId.get(entry().id) ?? entry();
    if (live === source) return;
    source = live;
    item.value = { ...live, replyIds: [...live.replyIds] };
  });
  return item;
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
    /** The replies this card draws. Without it the card resolves replies from every item. */
    replies: { type: Array as PropType<readonly ReviewItemView[]>, default: undefined },
  },
  setup(props, { slots }) {
    const rail = useRail();
    const item = liveReviewItem(rail, () => props.entry);
    provide(ReviewItemContextKey, item as unknown as ComputedRef<ReviewItemView | null>);
    provide(
      ReviewThreadKey,
      computed(() => {
        const replies = props.replies;
        if (replies === undefined) return rail.value.byId;
        if (replies.length === 0) return NO_THREAD;
        return new Map(replies.map((reply) => [reply.id, reply]));
      })
    );
    let measuredNode: HTMLElement | null = null;
    let measuredKey: string | null = null;
    const bindMeasuredNode = (node: Element | null): void => {
      const nextNode = isHTMLElementNode(node) ? node : null;
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
            bindMeasuredNode(isElementNode(vnode.el) ? vnode.el : null);
          },
          onVnodeUpdated: (vnode) => {
            bindMeasuredNode(isElementNode(vnode.el) ? vnode.el : null);
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
    /** Set where the scope holds a whole card: its replies then resolve from every item. */
    wholeThread: Boolean,
  },
  setup(props, { slots }) {
    const rail = useRail();
    const item = liveReviewItem(rail, () => props.entry);
    provide(ReviewItemContextKey, item as unknown as ComputedRef<ReviewItemView | null>);
    if (props.wholeThread) {
      provide(
        ReviewThreadKey,
        computed(() => rail.value.byId)
      );
    }
    return () => slots.default?.() as VNode | VNode[] | null;
  },
});

export { INERT_RAIL, INERT_REVIEW };
