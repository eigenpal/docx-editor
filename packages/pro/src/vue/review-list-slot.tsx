/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One positioned card of the review list. The React twin is `../react/review-list-slot.tsx`.

import { defineComponent, h, type CSSProperties, type PropType, type VNode } from 'vue';
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

/**
 * The card inside a slot. It takes props only, so it renders again only when its item or the
 * card template changes. A slot that moves keeps it as it is.
 */
const ReviewListCard = defineComponent({
  name: 'ReviewListCard',
  props: {
    entry: { type: Object as PropType<ReviewItemView>, required: true },
    template: { type: Object as PropType<ReviewListTemplate>, required: true },
  },
  setup(props) {
    const rail = useCardRail();
    return () => {
      const { entry, template } = props;
      if (template.item) {
        const nodes = template.item(entry);
        return nodes.length === 1 ? nodes[0] : nodes;
      }
      const cardClassName = rail.value.cardClassName;
      return template.card
        ? cloneReviewCard(template.card, cardClassName)
        : h(ReviewCard, cardClassName ? { className: cardClassName } : {}, () => template.rest);
    };
  },
});

/**
 * A card at its position. It takes props only, so it renders again only when one of its own
 * inputs changes: the item, a reply, the position, or the card template. A move renders the
 * positioned element alone, because the card inside gets the same props.
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
    return () => {
      const { entry, top, template } = props;
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
        () => h(ReviewListCard, { entry, template })
      );
    };
  },
});
