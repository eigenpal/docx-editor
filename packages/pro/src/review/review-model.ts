/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The review queue DERIVATION: every pending decision in the document, from the TREE.
//
// What makes review a pro capability is the SEAM, not a private copy of the walk:
// `reviewModule()` hands `collectReviewItems` to `createDocxEditor`, and an engine with no
// module registered has no queue to draw, no card to resolve and no suggesting mode to enter.
//
// The queue itself is derived in the STORE lane, because it is a property of the document and
// every lane has to read one derivation of it. Layout is a VIEW — the proposed-result mode drops
// every deletion and the original mode drops every insertion — so a queue derived from spans
// empties by half the moment a reader switches view. And a derivation this package kept to
// itself would be unreachable from the automation lane, which may not import it; two derivations
// of a reviewer's queue disagree eventually, leaving a comment listed on screen and missing from
// the object model, or a change the pane offers to accept and a script cannot find.
//
// What stays PRO is the custom-node half: `collectReviewItems` here wraps the engine's
// derivation and appends one `kind: 'custom'` card per recognized node whose definition
// carries a `reviewCard` hook — recognition is this package's capability, so the engine
// forwards registered definitions opaquely and never looks inside them.

export {
  commentBodyText,
  commentInitials,
  commentItemsOf,
  firstReviewRange,
  paragraphOrderOfPart,
  reviewItemKey,
  reviewItemRanges,
  revisionItemsOf,
  type ReviewCommentItem,
  type ReviewItem,
  type ReviewModelInput,
  type ReviewPosition,
  type ReviewRange,
  type ReviewRevisionItem,
  type ReviewRevisionKind,
} from '@docx-editor.dev/core-contract/store';
export type { ReviewCustomItem } from '@docx-editor.dev/core-contract/layout';

import {
  collectReviewItems as engineCollectReviewItems,
  findNode,
  locateSites,
  paragraphOrderOfPart,
  revisionItemsOf,
  type OoxmlPart,
  type ReviewRevisionItem,
} from '@docx-editor.dev/core-contract/store';
import {
  reviewItemPositionRank,
  type ReviewCustomItem,
  type ReviewItem,
  type ReviewModelInput,
} from '@docx-editor.dev/core-contract/layout';
import {
  isCustomNodeDefinition,
  recognizeCustomNodes,
  type CustomNodeDefinition,
} from '../custom-nodes/define-custom-node.ts';

/**
 * Revisions wholly inside one paragraph — for a conservative local review patch after a
 * text-local edit. Walks a paragraph-root part view, not the full story.
 */
export function revisionItemsOfParagraph(
  part: OoxmlPart,
  paragraphId: string
): ReviewRevisionItem[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  return revisionItemsOf({
    id: part.id,
    name: part.name,
    contentType: part.contentType,
    root: paragraph,
  });
}

/**
 * One `kind: 'custom'` card per recognized node whose definition carries a `reviewCard`
 * hook, anchored at the node's range through the same `locateSites` walk revisions use.
 */
export function customItemsOf(
  part: OoxmlPart,
  definitions: readonly CustomNodeDefinition[]
): ReviewCustomItem[] {
  const carded = definitions.filter((definition) => definition.reviewCard);
  if (carded.length === 0) return [];
  const recognized = recognizeCustomNodes(part, carded);
  if (recognized.length === 0) return [];
  const located = locateSites(part);
  const items: ReviewCustomItem[] = [];
  for (const node of recognized) {
    const definition = carded.find(
      (candidate) => candidate.name === node.name && node.tag.startsWith(`${candidate.tagPrefix}:`)
    );
    if (!definition) continue;
    const card = definition.reviewCard!({ attrs: node.attrs, text: node.text });
    if (card === null) continue;
    const where = located.get(node.nodeId);
    items.push({
      kind: 'custom',
      id: node.nodeId,
      name: node.name,
      tag: node.tag,
      attrs: node.attrs,
      text: node.text,
      title: card.title,
      ...(card.detail !== undefined ? { detail: card.detail } : {}),
      range: where
        ? {
            partName: part.name,
            start: { paragraphId: where.paragraphId, offset: where.start },
            end: { paragraphId: where.paragraphId, offset: where.end },
          }
        : null,
    });
  }
  return items;
}

/**
 * The pro derivation: the engine's queue plus the custom-node cards, in one document order.
 *
 * The registry forwards definitions opaquely on the input (`customNodes`); with none
 * registered — or none carrying `reviewCard` — this is exactly the engine's own queue,
 * same items, same order.
 */
export function collectReviewItems(input: ReviewModelInput): ReviewItem[] {
  const base = engineCollectReviewItems(input);
  const definitions = (input.customNodes ?? []).filter(isCustomNodeDefinition);
  if (definitions.length === 0) return base;

  const parts: OoxmlPart[] = [input.storyPart];
  const seen = new Set<string>([input.storyPart.name]);
  for (const part of input.furnitureParts ?? []) {
    if (seen.has(part.name)) continue;
    seen.add(part.name);
    parts.push(part);
  }
  const custom: ReviewCustomItem[] = [];
  const order = new Map<string, number>();
  for (const part of parts) {
    custom.push(...customItemsOf(part, definitions));
    const offset = order.size;
    for (const [id, position] of paragraphOrderOfPart(part)) {
      if (!order.has(id)) order.set(id, offset + position);
    }
  }
  if (custom.length === 0) return base;

  const items: ReviewItem[] = [...base, ...custom];
  return items.sort((a, b) => reviewItemPositionRank(a, order) - reviewItemPositionRank(b, order));
}
