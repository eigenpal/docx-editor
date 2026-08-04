// Semantic document store — the canonical-tree lane (document-engine section 4).
// The legacy PackageModel store (DocOps, DocumentStore, history periphery) was deleted
// with the legacy editor pipeline; `TreeDocumentStore` over the ordered OOXML tree is
// the only store.
export {
  ACCEPTED_PARAGRAPH_PROPERTIES,
  ACCEPTED_RUN_PROPERTIES,
  applyTreeOp,
  paragraphTextOf,
  validateTreeOp,
  TREE_DOC_OP_KINDS,
  type ImpactClass,
  type OoxmlProperty,
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
} from './tree-store.ts';
export {
  addComment,
  commentPartNameOf,
  hasCommentPart,
  type AddCommentRequest,
  type AddCommentResult,
  type CommentAnchorRequest,
} from './comment-writes.ts';
export { collectRevisionSites, type RevisionAddress } from './tree-op-revisions.ts';
