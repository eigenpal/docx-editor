// @docx-editor.dev/engine-sync
//
// Synchronization: local + Yjs ReplicatedStoreBackend, the sole ReplicationCoordinator, relative-position anchors, snapshots, persistence, and awareness. Owns all Yjs types.
//
// Production placement is fixed by document-engine task 1.4. Responsibilities and
// dependency rules: docs/architecture/production-engine-packages.md. This is a
// greenfield skeleton; capability implementation lands in the sections that own it.
//
// ADR-S9: production modules MUST NOT import from packages/core/spike/**.

/** Stable package identity used by the import-graph / package-authority checks. */
export const ENGINE_SYNC_PACKAGE = '@docx-editor.dev/engine-sync' as const;

export type { ReplicatedStoreBackend } from './backend.ts';
export { LocalBackend, SNAPSHOT_SCHEMA_VERSION, NORMALIZATION_VERSION } from './local-backend.ts';
export { YjsBackend } from './yjs-backend.ts';
export {
  ReplicationCoordinator,
  type LocalPhase,
  type RemotePhase,
  type LocalCommit,
  type RemoteMerge,
} from './coordinator.ts';
