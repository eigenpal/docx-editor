/** @spike-features origin-metadata, yjs-backend */
export const UNDO_EXPERIMENT_JOURNAL_VERSION = 'yjs-undo-reconstruction-journal/1' as const;

/** Frozen finite experiment quota — not a production retention policy. */
export const UNDO_EXPERIMENT_MAX_JOURNAL_EVENTS = 64;
export const UNDO_EXPERIMENT_MAX_UNDO_STACK_ITEMS = 32;
export const UNDO_EXPERIMENT_MAX_REDO_STACK_ITEMS = 32;
export const UNDO_EXPERIMENT_MAX_UPDATE_BYTES = 256 * 1024;
export const UNDO_EXPERIMENT_MAX_GENESIS_BYTES = 4 * 1024 * 1024;

/** Compaction beyond this retained replay horizon invalidates older undo eligibility. */
export const UNDO_EXPERIMENT_RETAINED_REPLAY_HORIZON = 48;

export const UNDO_EXPERIMENT_LIMITATIONS = Object.freeze({
  durabilityRequiresReplayHistoryFromGenesis: true,
  compactionBeyondRetainedHorizonInvalidatesOlderUndo: true,
  retainedReplayHorizon: UNDO_EXPERIMENT_RETAINED_REPLAY_HORIZON,
  maxJournalEvents: UNDO_EXPERIMENT_MAX_JOURNAL_EVENTS,
  doesNotClaimLocalBackendUsesSameMechanism: true,
  remoteInterleaveReopenRequiresStableClientIdAnchoring: true,
});
