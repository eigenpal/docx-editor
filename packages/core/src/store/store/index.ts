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
  setCommentResolved,
  commentPartNameOf,
  commentsExtendedPartNameOf,
  hasCommentPart,
  type AddCommentRequest,
  type AddCommentResult,
  type CommentAnchorRequest,
  type SetCommentResolvedResult,
} from './comment-writes.ts';
export {
  AUTHORABLE_PARAGRAPH_PROPERTIES,
  AUTHORABLE_RUN_PROPERTIES,
  authoredProperties,
  directParagraphMarkProperties,
  directParagraphProperties,
  formatOwnedRunIds,
  isAuthorableRunProperty,
  mergedProperties,
  propertyContainer,
  runAddressRanges,
  runPropertyEdits,
  runsCovering,
  type RunPropertyEdit,
} from './direct-properties.ts';
export { collectRevisionSites, type RevisionAddress } from './tree-op-revisions.ts';
export {
  commentAnchorsOfStory,
  commentsOfPart,
  threadStateOfPart,
  W15_NAMESPACE_URI,
  type CommentAnchor,
  type CommentPosition,
  type CommentRecord,
  type CommentThreadState,
} from './comment-reads.ts';
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
} from './review-reads.ts';
export {
  SEARCH_MATCH_LIMIT,
  SEARCH_QUERY_MAX,
  findOccurrences,
  foldCase,
  isSearchableQuery,
  isWholeWord,
  type TextMatchOptions,
  type TextOccurrence,
  type TextOccurrences,
} from './text-match.ts';
