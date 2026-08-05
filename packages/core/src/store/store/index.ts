// Semantic document store — the canonical-tree lane (document-engine section 4).
// The legacy PackageModel store (DocOps, DocumentStore, history periphery) was deleted
// with the legacy editor pipeline; `TreeDocumentStore` over the ordered OOXML tree is
// the only store.
export {
  ACCEPTED_PARAGRAPH_PROPERTIES,
  ACCEPTED_RUN_PROPERTIES,
  applyTreeOp,
  paragraphOffsetIndex,
  paragraphTextOf,
  segmentsOf,
  validateTreeOp,
  TREE_DOC_OP_KINDS,
  type ImpactClass,
  type OffsetSpan,
  type OoxmlProperty,
  type ParagraphOffsetIndex,
  type Segment,
  type TreeDocOp,
  type TreeDocOpKind,
  type DrawingTreeDocOp,
  type TreeOpEffect,
  type TreeOpRejection,
  type TreeOpResult,
} from './tree-ops.ts';
export {
  TreeDocumentStore,
  type SelectionMark,
  type TransactionContext as TreeTransactionContext,
  type TransactOptions as TreeTransactOptions,
  type TransactResult as TreeTransactResult,
  type TreeDocumentStoreOptions,
  type TreeModelChange,
  type TreeStoryRef,
} from './tree-store.ts';
export {
  DEFAULT_MAX_EDITABLE_STORY_PARTS,
  TreePackageStore,
  type PackageTransactResult,
  type StoryResolveResult,
  type StoryScope,
  type StoryTargetRejection,
  type TreePackageStoreOptions,
} from './tree-package-store.ts';
export {
  addComment,
  commentPartNameOf,
  commentsExtendedPartNameOf,
  hasCommentPart,
  type AddCommentRequest,
  type AddCommentResult,
  type CommentAnchorRequest,
} from './comment-writes.ts';
export { collectRevisionSites, type RevisionAddress } from './tree-op-revisions.ts';
export {
  drawingOpImpact,
  isDrawingTreeDocOp,
  validateDrawingOp,
  wrapTargetToAnchorSpec,
} from './tree-op-drawings.ts';
export {
  allocateDrawingPropertyId,
  withBinaryPart,
  withEmbeddedImage,
  withoutUnreferencedImagePart,
  type DrawingPropertyIdResult,
} from '../package/drawing-package-edit.ts';
export {
  IMAGE_WRAP_TARGETS,
  projectDrawing,
  type DrawingKind,
  type DrawingLocks,
  type DrawingPositionInput,
  type ImageWrapTarget,
  type SourceCrop,
} from '../package/drawing-projection.ts';
export type { ImageResourceState, SupportedImageMime } from '../package/image-resources.ts';
