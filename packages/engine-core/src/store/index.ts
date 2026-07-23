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
export {
  type AuditEntry,
  type JournalEntry,
  AuditIndex,
  ReplayJournal,
} from './audit.ts';
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
