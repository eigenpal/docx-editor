/** @spike-features fixture-comparators */
export * from './oracle-hash';
export * from './canonical-json';
export * from './comparators/index';
export * from './rng/seeded-rng';
export * from './diagnostics/failure-report';
export * from './diagnostics/revision-origin-log';
export * from './scope/assert-scope';
export * from './scope/audit-surface';
export * from './driver/editor-driver';
export * from './execution/index';
export * from './model/index';
export * from './store/index';
export * from './contracts/index';
export {
  UNDO_EXPERIMENT_DECISION,
  UNDO_EXPERIMENT_MECHANISM,
  UNDO_EXPERIMENT_REJECTED,
  UNDO_EXPERIMENT_VERDICT,
  UNDO_EXPERIMENT_LIMITATIONS,
  UNDO_EXPERIMENT_RETAINED_REPLAY_HORIZON,
  createYjsUndoManagerExperiment,
  decodeReconstructionJournal,
  replayReconstructionJournal,
  compactJournalRetainingHorizon,
  type YjsUndoManagerExperiment,
  type ReconstructionJournal,
} from './experiment/yjs-undo-manager/index';
export {
  createPocDocxFixture,
  loadPocDocx,
  POC_PARAGRAPH_ID,
  POC_ZIP_MAX_BYTES,
  POC_ZIP_MAX_ENTRIES,
  POC_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES,
  POC_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES,
  POC_ZIP_MAX_DECOMPRESSION_RATIO,
  POC_XML_MAX_BYTES,
  POC_XML_MAX_SCAN_STEPS,
  type LoadedPocDocx,
  type PocRun,
} from './poc/docx';
export {
  createPocStore,
  getDeterministicBootstrapUpdate,
  POC_STORE_PARAGRAPH_ID,
  type CreatePocStoreOptions,
  type PocSnapshot,
  type PocStore,
} from './poc/store';
export {
  validateCommand,
  validateQuery,
  snapshotAndValidateCommand,
  snapshotAndValidateQuery,
  getValidationErrors,
  loadOracleManifest,
  loadYjsSchemaOracle,
  loadBindingOracle,
  loadVocabularyOracle,
  loadScopeManifest,
} from './vocabulary/validate';
