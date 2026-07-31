/** @spike-features origin-metadata, insert-delete-split-join-operations, yjs-backend */
export {
  UNDO_EXPERIMENT_MECHANISM,
  UNDO_EXPERIMENT_REJECTED,
  UNDO_EXPERIMENT_DECISION,
  UNDO_EXPERIMENT_VERDICT,
} from './mechanism';
export {
  UNDO_EXPERIMENT_JOURNAL_VERSION,
  UNDO_EXPERIMENT_LIMITATIONS,
  UNDO_EXPERIMENT_MAX_JOURNAL_EVENTS,
  UNDO_EXPERIMENT_RETAINED_REPLAY_HORIZON,
} from './quotas';
export {
  createStableTrackedOrigin,
  createRemoteUntrackedOrigin,
  actorSessionFromTrackedOrigin,
} from './origin-tokens';
export { collectAuthoredModelScope } from './scope';
export {
  createActorUndoSession,
  inspectUndoSession,
  undoWithControlOrigin,
  redoWithControlOrigin,
  type ActorUndoSession,
} from './session';
export {
  decodeReconstructionJournal,
  encodeReconstructionJournal,
  replayReconstructionJournal,
  compactJournalRetainingHorizon,
  appendJournalEvent,
  createGenesisFromDoc,
  materializeReconstructionJournal,
} from './journal';
export {
  createYjsUndoManagerExperiment,
  type YjsUndoManagerExperiment,
  type YjsUndoManagerExperimentOptions,
} from './runner';
export type {
  ActorHistoryInspection as UndoExperimentActorHistoryInspection,
  JournalEvent,
  ReconstructionJournal,
  StackItemMeta,
  JournalReplayValidation,
} from './types';
