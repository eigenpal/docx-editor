// The ReplicatedStoreBackend contract (document-engine section 5 / design D2).
// A backend owns opaque update encoding and full snapshots — bytes distinct from
// semantic DocOps and ModelChanges. The local and Yjs backends implement this
// same behavioral contract; only the ReplicationCoordinator (task 5.3) may bridge
// a backend to canonical state.

import type { ReplicationUpdate, Snapshot, SerializedModel } from '@docx-editor.dev/engine-core';

export interface ReplicatedStoreBackend {
  readonly documentId: string;
  /** Full encoded backend state for initial sync / persistence / recovery. */
  snapshot(): Snapshot;
  /** Encode current committed state as an opaque incremental update. */
  encodeUpdate(updateId: string): ReplicationUpdate;
  /** Decode an opaque update into model-shaped state for the coordinator to publish. */
  decodeUpdate(update: ReplicationUpdate): { model: SerializedModel; revision: number };
}
