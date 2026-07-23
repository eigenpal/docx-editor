// @docx-editor.dev/engine-sync
//
// OPTIONAL synchronization: local + Yjs ReplicatedStoreBackend and a thin YjsBinding
// over an externally-owned Y.Doc (ADR-S10; supersedes the removed ReplicationCoordinator).
// Owns all Yjs types; engine-core runs fully without this package.
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
export { YjsBackend, type YjsBackendOptions, assertYjsCompatibleModel } from './yjs-backend.ts';
export { YjsBinding } from './binding.ts';
export { type Role, type Presence, PresenceRegistry, canSubmitUpdate, canExport } from './awareness.ts';
