/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One positioned card of the review list. The Vue twin is `../vue/review-list-slot.tsx`.

import { memo, useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ReviewItemView } from './useReview.ts';
import { ReviewItemContext, ReviewThreadContext, useKept } from './review-context.ts';
import { sameElements } from '../review/review-roots.ts';

export interface ReviewListSlotProps {
  readonly entry: ReviewItemView;
  /** Rail-local `top` in CSS pixels, or null for a card without a placement. */
  readonly top: number | null;
  readonly collapsed: boolean;
  /** The replies this card draws; compared element by element. */
  readonly replies: readonly ReviewItemView[];
  readonly slotRef: (key: string) => (node: HTMLElement | null) => void;
  /** The host's render prop, when it takes over the card. */
  readonly render: ((item: ReviewItemView) => ReactNode) | null;
  /** The card every slot shares when there is no render prop. */
  readonly card: ReactNode;
}

const NO_THREAD: ReadonlyMap<string, ReviewItemView> = new Map();

type CardTemplate = (item: ReviewItemView) => ReactNode;

/**
 * The host's render prop for one item, as a component. It renders again only when the item
 * changes or the host passes another function. The render prop runs as this component's own
 * render, so the hooks it calls belong to the card and keep their state. As in any component,
 * each run must call the same hooks: a host that switches between render props with other
 * hooks gives the rail another `key`.
 */
export const ReviewRenderedCard = memo(function ReviewRenderedCard({
  entry,
  render,
}: {
  readonly entry: ReviewItemView;
  readonly render: CardTemplate;
}) {
  return render(entry);
});

/**
 * A card at its position. It renders again only when one of its own inputs changes: the item,
 * a reply, the position, or the card template. A move renders the positioned element alone,
 * because the card inside keeps its identity.
 */
export const ReviewListSlot = memo(
  function ReviewListSlot({
    entry,
    top,
    collapsed,
    replies,
    slotRef,
    render,
    card,
  }: ReviewListSlotProps) {
    const kept = useKept(replies, sameElements);
    const thread = useMemo(
      () => (kept.length === 0 ? NO_THREAD : new Map(kept.map((reply) => [reply.id, reply]))),
      [kept]
    );
    const content = render ? <ReviewRenderedCard entry={entry} render={render} /> : card;
    const style: CSSProperties = top === null ? {} : { position: 'absolute', top };
    return (
      <ReviewItemContext.Provider value={entry}>
        <ReviewThreadContext.Provider value={thread}>
          <div
            className="docx-review__slot"
            style={style}
            // Header-only, because the card sits far from the text it annotates and a
            // full summary there reads as annotating the wrong text. Clicking it makes
            // the item active, and the active card always renders in full.
            {...(collapsed ? { 'data-collapsed': '' } : {})}
            ref={slotRef(entry.key)}
          >
            {content}
          </div>
        </ReviewThreadContext.Provider>
      </ReviewItemContext.Provider>
    );
  },
  (previous, next) =>
    previous.entry === next.entry &&
    previous.top === next.top &&
    previous.collapsed === next.collapsed &&
    previous.slotRef === next.slotRef &&
    previous.render === next.render &&
    previous.card === next.card &&
    sameElements(previous.replies, next.replies)
);
