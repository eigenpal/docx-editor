/** @spike-features insert-delete-split-join-operations, local-backend, origin-metadata */
export type {
  BackendCommitInput,
  BackendCommitResult,
  BackendCoverageBookkeeping,
  BackendIdentity,
  BackendStagePreview,
  BackendStateInspection,
  BackendStageInput,
  BackendStageResult,
  BackendStagedMutation,
  ImmutableStringSet,
  LocalStoreBackend,
  OperationEnvironmentSnapshot,
  SemanticStoreBackend,
} from './types';
export {
  createLocalStoreBackend,
  isBackendStagedMutation,
  restoreLocalStoreBackend,
  type LocalStoreBackendOptions,
} from './local-backend';
export {
  createYjsStoreBackend,
  isYjsBackendStagedMutation,
  restoreYjsStoreBackend,
  type YjsStoreBackend,
  type YjsStoreBackendOptions,
} from './yjs-backend';
export {
  LOCAL_BACKEND_SCHEMA_VERSION,
  LOCAL_BACKEND_VERSION,
  LOCAL_NORMALIZATION_VERSION,
} from './local-snapshot';
export {
  applyBatchThroughBackend,
  runBackendConformanceSuite,
  type BackendConformanceApplyResult,
  type BackendConformanceBatchStep,
  type BackendConformanceDriver,
  type BackendConformanceReport,
  type BackendConformanceScenario,
  type BackendConformanceScenarioResult,
} from './conformance';
export {
  validateYjsCausalReverseDelivery,
  validateYjsClientCollisionReseed,
  validateYjsCommitIdUniqueness,
  validateYjsBufferedAttribution,
  validateYjsPendingQuotas,
  validateYjsLosslessReseedJournal,
  validateYjsIndependentPendingChains,
  validateYjsSnapshotResyncRecovery,
  validateYjsStructuralTextConservation,
  validateYjsPendingDeleteReverseDelivery,
  validateYjsSameActorConvergence,
  validateYjsStateVectorDelta,
} from './yjs-conformance';
