/** @spike-features insert-delete-split-join-operations, local-backend, origin-metadata */
export type {
  ApplyResult,
  ModelChangeSubscriber,
  NotificationDiagnostic,
  SubscriberError,
} from './apply-result';
export {
  createSemanticDocumentStore,
  type SemanticDocumentStore,
  type SemanticDocumentStoreOptions,
} from './document-store';
export {
  UNDO_MECHANISM,
  UNDO_MECHANISM_REJECTED,
  UNDO_MECHANISM_EXPERIMENT_VERDICT,
  computeInverseOps,
  extractIdentityTombstones,
  createActorSessionGroupHistoryManager,
  decodeHistorySnapshotPayload,
  isHistoryEligibleOrigin,
  type ActorHistoryInspection,
  type ActorSessionGroupHistoryManager,
  type ActorSessionGroupHistoryState,
} from './history';
export {
  createReplicationCoordinator,
  restoreReplicationCoordinator,
  type ReplicationCoordinator,
  type ReplicationCoordinatorApplyResult,
  type ReplicationCoordinatorOptions,
  type ReplicationUpdateSubscriber,
} from './replication-coordinator';
export * from './backend/index';
export {
  dedupeIdentityMappings,
  dirtyDependenciesFor,
  repairConstituentId,
  structuralRangesForAffectedDraft,
} from './publish-metadata';
export {
  cloneDraft,
  draftFromAuthored,
  draftFromAuthoredInvocationCountForTests,
  draftToAuthoredPackage,
  findParagraphByBlockId,
  findParagraphIdByBlockId,
  resetDraftFromAuthoredInvocationCountForTests,
  type MutableDraft,
  type MutableParagraph,
} from './draft';
export {
  BatchValidationError,
  NORMALIZATION_PRECEDENCE,
  createMutationTrace,
  normalizeDraft,
  validateAndStageBatch,
  type MutationTrace,
  type NormalizationResult,
} from './mutate';
export {
  allocateMarkId,
  allocateSemanticId,
  bumpCommitSeq,
  compactDerivedId,
  commitIdFor,
  createOperationEnvironment,
  registerSemanticId,
  type OperationEnvironment,
} from './operation-environment';
export { isValidUtf16Boundary, isValidUtf16Range, isValidUtf16String } from './utf16';
