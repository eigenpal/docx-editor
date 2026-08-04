// Comment anchors, comment bodies and thread state — read in the STORE lane.
//
// The reader moved there because it derives from the canonical tree and nothing else, and every
// lane has to ask it the same question: the review rail draws cards from it, and an automation
// host answers a script's "what comments does this document hold" from it. A layout-lane reader
// left the automation lane — which may not import layout — with no way to reach a reviewer's
// remarks except by writing a second walk, and two walks over comment range markers disagree
// eventually.
//
// This file exists so layout callers keep one import. `W15_NAMESPACE_URI` is re-exported for the
// same reason: the panes name it when they read thread state.

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
