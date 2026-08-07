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
} from '@docx-editor.dev/core/store';
export type { ReviewCustomItem } from '@docx-editor.dev/core/layout';

import {
  collectReviewItems as engineCollectReviewItems,
  findNode,
  locateSites,
  paragraphOrderOfPart,
  revisionItemsOf,
  type OoxmlPart,
  type ReviewRevisionItem,
} from '@docx-editor.dev/core/store';
import {
  reviewItemPositionRank,
  type ReviewCustomItem,
  type ReviewItem,
  type ReviewModelInput,
} from '@docx-editor.dev/core/layout';
import {
  isCustomNodeDefinition,
  recognizeCustomNodes,
  type AnyCustomNodeDefinition,
  type CustomNodeDiagnostic,
  type CustomNodePayloadSource,
} from '../custom-nodes/define-custom-node.ts';

/**
 * Revisions wholly inside one paragraph — for a conservative local review patch after a
 * text-local edit. Walks a paragraph-root part view, not the full story.
 */
export function revisionItemsOfParagraph(
  part: OoxmlPart,
  paragraphId: string
): readonly ReviewRevisionItem[] {
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
  definitions: readonly AnyCustomNodeDefinition[],
  payloads?: ReadonlyMap<string, CustomNodePayloadSource>,
  report?: (diagnostic: CustomNodeDiagnostic) => void
): ReviewCustomItem[] {
  // RECOGNIZE AGAINST EVERY DEFINITION, card or not. `reviewCard` decides whether a node gets a
  // SIDEBAR CARD; it must not decide whether the node is recognized at all. It used to: a
  // definition with a schema and an `onEdit` but no card contributed no item, and since the chip
  // activation reads `data` and `text` off the review item, its payload was `undefined` forever
  // with nothing saying why. The item is emitted with no title when there is no card, and the
  // rail filters those out.
  if (definitions.length === 0) return [];
  const recognized = recognizeCustomNodes(part, definitions, {
    ...(payloads === undefined ? {} : { payloads }),
    ...(report === undefined ? {} : { onDiagnostic: report }),
  });
  if (recognized.length === 0) return [];
  const located = locateSites(part);
  const items: ReviewCustomItem[] = [];
  for (const node of recognized) {
    const definition = definitions.find(
      (candidate) => candidate.name === node.name && node.tag.startsWith(`${candidate.tagPrefix}:`)
    );
    if (!definition) continue;
    const card = definition.reviewCard
      ? definition.reviewCard({
          attrs: node.attrs,
          text: node.text,
          ...(node.data === undefined ? {} : { data: node.data }),
        })
      : // No card asked for. The item still exists so every surface keyed on it — the chip's
        // `data`, its `text`, its `nodeId` — keeps working; `carded: false` is what the rail
        // reads to leave it out of the sidebar.
        null;
    if (definition.reviewCard && card === null) continue;
    const where = located.get(node.nodeId);
    items.push({
      kind: 'custom',
      id: node.nodeId,
      name: node.name,
      tag: node.tag,
      attrs: node.attrs,
      text: node.text,
      ...(node.data === undefined ? {} : { data: node.data }),
      carded: definition.reviewCard !== undefined && card !== null,
      title: card?.title ?? '',
      ...(card?.detail !== undefined ? { detail: card.detail } : {}),
      ...(card?.icon !== undefined ? { icon: card.icon } : {}),
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
    // The payloads the ENGINE resolved, and only for the story they belong to: they are keyed
    // by control node id, and a header's controls are not the body's.
    custom.push(
      ...customItemsOf(
        part,
        definitions,
        part.name === input.storyPart.name ? input.customNodePayloads : undefined,
        input.reportCustomNodeDiagnostic as ((d: CustomNodeDiagnostic) => void) | undefined
      )
    );
    const offset = order.size;
    for (const [id, position] of paragraphOrderOfPart(part)) {
      if (!order.has(id)) order.set(id, offset + position);
    }
  }
  if (custom.length === 0) return base;

  const items: ReviewItem[] = [...base, ...custom];
  return items.sort((a, b) => reviewItemPositionRank(a, order) - reviewItemPositionRank(b, order));
}
