/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One positioned card of the review list. The React twin is `../react/review-list-slot.tsx`.

import {
  Fragment,
  computed,
  createCommentVNode,
  createTextVNode,
  defineComponent,
  h,
  isVNode,
  type CSSProperties,
  type PropType,
  type VNode,
} from 'vue';
import type { ReviewItemView } from './useReview.ts';
import { ReviewItemScope, useCardRail } from './review-context.ts';
import { cloneReviewCard } from './review-composition.ts';
import { ReviewCard } from './review-card-parts.tsx';

/**
 * What the list draws in every slot. The list keeps one object while its slots and the state
 * they read hold, so a slot can compare it by identity.
 */
export interface ReviewListTemplate {
  /** The host's item slot, when it takes over the card. */
  readonly item: ((entry: ReviewItemView) => VNode[]) | null;
  /** The host's `Card` part, when it wrote one. */
  readonly card: VNode | undefined;
  /** The `Empty` part, for a list without cards. */
  readonly empty: VNode | undefined;
  /** The other children: the content of the packaged card. */
  readonly rest: VNode[];
}

/** A value a slot function answered, as the vnode Vue makes of it among an element's children. */
function toNode(child: unknown): VNode {
  if (isVNode(child)) return child;
  if (Array.isArray(child)) return h(Fragment, null, child);
  if (child === null || child === undefined || typeof child === 'boolean') {
    return createCommentVNode();
  }
  return createTextVNode(String(child));
}

/**
 * One root node of the card inside a slot. It takes the node alone, so it renders again only
 * for another node. A slot that moves draws the same node, and the card keeps as it is.
 *
 * Each root node has a component of its own, because a component with one root adds no DOM
 * node. One component around several root nodes would be a fragment, which Vue marks with an
 * empty text node at each end.
 */
const ReviewListNode = defineComponent({
  name: 'ReviewListNode',
  props: { node: { type: Object as PropType<VNode>, required: true } },
  setup(props) {
    return () => props.node;
  },
});

/**
 * A card at its position. It takes props only, so it renders again only when one of its own
 * inputs changes: the item, a reply, the position, or the card template. A move renders the
 * positioned element alone, because each root node of the card is the same vnode.
 */
export const ReviewListSlot = defineComponent({
  name: 'ReviewListSlot',
  props: {
    entry: { type: Object as PropType<ReviewItemView>, required: true },
    /** Rail-local `top` in CSS pixels, or null for a card without a placement. */
    top: { type: Number as PropType<number | null>, default: null },
    collapsed: Boolean,
    /** The replies this card draws. The list keeps one array while its elements hold. */
    replies: { type: Array as PropType<readonly ReviewItemView[]>, required: true },
    template: { type: Object as PropType<ReviewListTemplate>, required: true },
  },
  setup(props) {
    const rail = useCardRail();
    // The root nodes of the card. They are built again only for another item, another card
    // template, or a change of reactive state that the template read.
    const nodes = computed((): VNode[] => {
      const { entry, template } = props;
      if (template.item) return template.item(entry).map(toNode);
      const cardClassName = rail.value.cardClassName;
      return [
        template.card
          ? cloneReviewCard(template.card, cardClassName)
          : h(ReviewCard, cardClassName ? { className: cardClassName } : {}, () => template.rest),
      ];
    });
    return () => {
      const { entry, top } = props;
      const style: CSSProperties = top === null ? {} : { position: 'absolute', top: `${top}px` };
      return h(
        ReviewItemScope,
        {
          entry,
          measureKey: entry.key,
          // Header-only, because the card sits far from the text it annotates and a full
          // summary there reads as annotating the wrong text. Clicking it makes the item
          // active, and the active card always renders in full.
          collapsed: props.collapsed,
          style,
          replies: props.replies,
        },
        // A root node keeps its own key, so a slot that changes the order of its keyed
        // roots moves their elements. A root without a key takes its place in the slot.
        () =>
          nodes.value.map((node, index) =>
            h(ReviewListNode, {
              key: isVNode(node) && node.key != null ? `k:${String(node.key)}` : index,
              node,
            })
          )
      );
    };
  },
});
