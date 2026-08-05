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
// The item VOCABULARY, its pure helpers and the GEOMETRY half — which page a card sits on and
// how far down, the one question the tree cannot answer — stay in the engine
// (`@docx-editor.dev/core-contract/layout`, `review-support`). This file re-exports the
// derivation so callers in this package keep one import.

export {
  collectReviewItems,
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
