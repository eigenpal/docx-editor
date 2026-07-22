/** @spike-features insert-delete-split-join-operations, origin-metadata, awareness-metadata, one-annotation-anchor */
export {
  DOC_OP_CONTRACT_VERSION,
  createDocOpBatch,
  isDocOp,
  rejectsModelChangeAsDocOp,
  snapshotAndValidateDocOp,
  snapshotAndValidateInternalDocOpSingle,
  snapshotDocOp,
  type DocOp,
  type DocOpBatch,
  type DocOpMarkKind,
  type DocOpSingle,
  type DocOpTransactionMetadata,
} from './doc-op';
export {
  MODEL_CHANGE_CONTRACT_VERSION,
  createModelChange,
  isModelChange,
  rejectsDocOpAsModelChange,
  snapshotAndValidateModelChange,
  type DirtyDependency,
  type IdentityMapping,
  type IdentityMappingKind,
  type ModelChange,
  type RepairEvidence,
  type StructuralRange,
} from './model-change';
export {
  REPLICATION_UPDATE_CONTRACT_VERSION,
  createReplicationUpdateEnvelope,
  isReplicationUpdate,
  rejectsReplicationUpdateAsDocOp,
  snapshotAndValidateReplicationUpdate,
  type ReplicationCoverage,
  type ReplicationUpdateEnvelope,
} from './replication-update';
export {
  SNAPSHOT_CONTRACT_VERSION,
  createSnapshotEnvelope,
  isSnapshot,
  rejectsSnapshotAsDocOp,
  snapshotAndValidateSnapshot,
  type SnapshotEnvelope,
} from './snapshot';
export {
  AWARENESS_ORIGIN_KINDS,
  MUTATION_ORIGIN_KINDS,
  PROJECTION_ORIGIN_KINDS,
  createAwarenessOrigin,
  createMutationOrigin,
  createProjectionOrigin,
  originDomainsDoNotOverlap,
  snapshotAndValidateAwarenessOrigin,
  snapshotAndValidateMutationOrigin,
  snapshotAndValidateProjectionOrigin,
  type AwarenessOrigin,
  type AwarenessOriginKind,
  type MutationOrigin,
  type MutationOriginKind,
  type Origin,
  type ProjectionOrigin,
  type ProjectionOriginKind,
} from './origins';
export {
  AWARENESS_STATE_VERSION,
  awarenessOriginTagsMatchOracle,
  createAwarenessState,
  snapshotAndValidateAwarenessState,
  type AwarenessPresence,
  type AwarenessSelectionEphemeral,
  type AwarenessState,
} from './awareness';
export {
  INTERNAL_ANCHOR_VERSION,
  createInternalAnchorEnvelope,
  internalAnchorTrustedFieldsMatchOracle,
  snapshotAndValidateInternalAnchorEnvelope,
  type AnchorAffinity,
  type InternalAnchorEnvelope,
} from './anchor';
export {
  TRANSACTION_REJECTION_REASONS,
  TRANSACTION_CONTEXT_VERSION,
  createSynchronousTransactionContext,
  createTransactionRejection,
  snapshotAndValidateSynchronousTransactionContext,
  type SynchronousTransactionContext,
  type TransactionRejection,
  type TransactionRejectionReason,
} from './transaction-context';
export {
  ENCRYPTED_REPLAY_JOURNAL_VERSION,
  REDACTED_AUDIT_INDEX_VERSION,
  createEncryptedReplayJournalEnvelope,
  createRedactedAuditIndexRecord,
  snapshotAndValidateEncryptedReplayJournalEnvelope,
  snapshotAndValidateRedactedAuditIndexRecord,
  type EncryptedReplayJournalEnvelope,
  type RedactedAuditIndexRecord,
} from './audit';
export {
  ACCEPT_DOC_OP,
  ACCEPT_MODEL_CHANGE,
  ACCEPT_REPLICATION_UPDATE,
  ACCEPT_SNAPSHOT,
  assertAwarenessExcludedFromAuthoredPayload,
  assertFourContractSeparation,
} from './separation';
export { loadYjsSchemaOracle } from '../vocabulary/validate';
