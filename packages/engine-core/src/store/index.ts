// Semantic document store (document-engine section 4).
export {
  type DocOp,
  type DocOpKind,
  type OpEffect,
  type ModelChange,
  type ReplicationUpdate,
  type Snapshot,
  isDocOp,
  isModelChange,
  isReplicationUpdate,
  isSnapshot,
} from './contracts.ts';
export { type DocOpValidation, validateDocOp, applyDocOp } from './docops.ts';
export { normalize, normalizeRuns } from './normalize.ts';
export { buildModelChange } from './model-change.ts';
export {
  type StoreFailureKind,
  type StoreFailure,
  type OpStatus,
  type CommitResult,
  type BatchResult,
  type TransactionContext,
  type TransactOptions,
  type AnchorHandle,
  DocumentStore,
} from './document-store.ts';
export {
  type ExternalTarget,
  type ResolveFailure,
  type ResolvedTarget,
  resolveExternalTarget,
} from './external-target.ts';
export { type AuditEntry, type JournalEntry, AuditIndex, ReplayJournal } from './audit.ts';
export {
  ANCHOR_ENVELOPE_VERSION,
  type AnchorEnvelope,
  type AnchorContext,
  type AnchorRestore,
  serializeAnchorEnvelope,
  restoreAnchorEnvelope,
} from './anchor-envelope.ts';
export {
  type EnvelopeLimits,
  type EnvelopeRejection,
  type EnvelopeCheck,
  DEFAULT_ENVELOPE_LIMITS,
  validateEnvelope,
} from './envelope.ts';
export {
  type MigrationStep,
  type MigrationFailure,
  type MigrationResult,
  MigrationRunner,
} from './migration.ts';
export {
  type Checkpoint,
  type Compactable,
  type CompactionResult,
  compact,
  materialize,
} from './compaction.ts';
export {
  type AnnotationKind,
  type AnnotationPolicy,
  type AnnotationState,
  type AnnotationRange,
  type Annotation,
  onBlockDeleted,
  onRangeDeleted,
} from './annotation.ts';
export {
  type Comment,
  type RevisionKind,
  type RevisionStatus,
  type TrackedRevision,
  type RevisionResult,
  reply,
  resolveComment,
  reopenComment,
  threadOf,
  acceptRevision,
  rejectRevision,
  pendingRevisions,
} from './comments-revisions.ts';
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
  // The legacy store already exports `TransactionContext` and `TransactOptions`; the tree
  // store's are a different shape, so they are re-exported under `Tree*` names rather than
  // shadowing names callers already bind to the old store during the cutover.
  type TransactionContext as TreeTransactionContext,
  type TransactOptions as TreeTransactOptions,
  type TransactResult as TreeTransactResult,
  type TreeDocumentStoreOptions,
  type TreeModelChange,
} from './tree-store.ts';
