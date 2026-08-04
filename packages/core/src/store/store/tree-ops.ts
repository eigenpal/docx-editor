// Paragraph semantic operations over the canonical tree (task 5.1 / 5.2).
//
// Every op addresses STABLE NODE IDENTITIES and UTF-16 offsets, never byte ranges — that is
// the whole difference from the model these replace, where an edit was a splice into the
// original XML text and a paragraph with no captured byte range could not be edited at all.
//
// Ops are declarative and JSON-safe. Application is pure: `applyTreeOp` returns a new part
// plus the structural effect, or a typed rejection, and never mutates its input. Validation
// runs BEFORE any tree work, so a rejected op leaves the tree, revision and indexes exactly
// as they were.
//
// This module is the entry point. Vocabulary, segmentation, and validation live in
// tree-op-types / tree-op-segments / tree-op-validate; application lives in tree-op-apply.ts.

export {
  ACCEPTED_PARAGRAPH_PROPERTIES,
  ACCEPTED_RUN_PROPERTIES,
  TREE_DOC_OP_KINDS,
  paragraphOffsetIndex,
  segmentsOf,
  validateTreeOp,
  type AcceptedParagraphProperty,
  type AcceptedRunProperty,
  type ImpactClass,
  type OffsetSpan,
  type OoxmlProperty,
  type ParagraphOffsetIndex,
  type Segment,
  type TreeDocOp,
  type TreeDocOpKind,
  type TreeOpEffect,
  type TreeOpRejection,
  type TreeOpResult,
} from './tree-op-validate.ts';
export { applyTreeOp, paragraphTextOf } from './tree-op-apply.ts';
