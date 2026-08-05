/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Comment anchors, comment bodies and thread state — read in the STORE lane.
//
// The pro review module owns the review CAPABILITY: without it registered there is no queue,
// no rail and no markup rendering. It does not own a second reader. Anchors derive from the
// canonical tree and nothing else, and every lane asks the same question of them — the rail
// draws cards from them, and an automation host answers a script's "what comments does this
// document hold" from them. A reader private to this package would leave the automation lane,
// which may not import it, with no way to reach a reviewer's remarks except by writing its own
// walk, and two walks over comment range markers disagree eventually.
//
// The store's walk is also the one that reaches a story a part does not own outright: a notes
// part holds a story per note, so a comment anchored on a footnote is anchored rather than
// reported orphaned.
//
// This file exists so callers in this package keep one import. `W15_NAMESPACE_URI` is
// re-exported for the same reason: the panes name it when they read thread state.

export {
  commentAnchorsOfStory,
  commentsOfPart,
  threadStateOfPart,
  W15_NAMESPACE_URI,
  type CommentAnchor,
  type CommentPosition,
  type CommentRecord,
  type CommentThreadState,
} from '@docx-editor.dev/core-contract/store';
