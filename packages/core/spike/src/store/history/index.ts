/** @spike-features origin-metadata, insert-delete-split-join-operations */
export {
  UNDO_MECHANISM,
  UNDO_MECHANISM_REJECTED,
  UNDO_MECHANISM_EXPERIMENT_VERDICT,
} from './mechanism';
export {
  computeInverseOps,
  extractIdentityTombstones,
  buildVersionedForward,
  buildVersionedInverse,
  tombstoneReservedIds,
} from './inverse';
export {
  createActorSessionGroupHistoryManager,
  historyManagerIsTrusted,
  isHistoryEligibleOrigin,
  validateActorSessionGroupHistoryState,
  type ActorHistoryInspection,
  type ActorSessionGroupHistoryManager,
  type HistoryCommitInput,
  type HistoryUndoRedoSelection,
} from './manager';
export {
  HISTORY_DOCOP_PAYLOAD_VERSION,
  HISTORY_ENTRY_VERSION,
  HISTORY_STACK_VERSION,
  IDENTITY_TOMBSTONE_VERSION,
  MAX_CONSTITUENTS_PER_HISTORY_ENTRY,
  MAX_OPS_PER_HISTORY_ENTRY,
  MAX_REDO_ENTRIES_PER_ACTOR_SESSION,
  MAX_UNDO_ENTRIES_PER_ACTOR_SESSION,
  actorSessionKey,
  createSafeAuditCursor,
  createVersionedDocOpPayload,
  createEmptyActorSessionGroupHistoryState,
  deserializeDraftSnapshot,
  serializeDraftSnapshot,
  validateHistoryEntry,
  type ActorSessionGroupHistoryState,
  type ActorSessionHistoryStacks,
  type HistoryEntry,
  type IdentityTombstone,
  type RedoEligibilityRecord,
  type SafeAuditCursor,
  type VersionedDocOpPayload,
} from './types';
export {
  decodeHistorySnapshotPayload,
  encodeHistorySnapshotPayload,
  type HistorySnapshotPayload,
} from './snapshot-payload';
