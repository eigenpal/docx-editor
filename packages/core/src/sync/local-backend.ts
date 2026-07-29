// Local replicated-store backend (document-engine task 5.1). Dependency-free
// reference implementation of ReplicatedStoreBackend: opaque Snapshot/
// ReplicationUpdate bytes distinct from DocOps/ModelChanges, with snapshot ->
// restore reproducing authored state, revision, and history behavior. It is the
// behavioral oracle the Yjs backend (5.2–5.4) must match under the shared
// conformance suite (5.9).

import {
  DocumentStore,
  encodeModel,
  decodeModel,
  utf8ToHex,
  hexToUtf8,
  fingerprint,
  type PackageModel,
  type SerializedModel,
  type Snapshot,
  type ReplicationUpdate,
} from '@docx-editor.dev/core-contract/store';
import type { ReplicatedStoreBackend } from './backend.ts';

/** Snapshot payload schema + normalization versions (task 5.6). */
export const SNAPSHOT_SCHEMA_VERSION = 1;
export const NORMALIZATION_VERSION = 1;

interface Payload {
  readonly schemaVersion: number;
  readonly normalizationVersion: number;
  readonly model: SerializedModel;
  readonly revision: number;
}

export class LocalBackend implements ReplicatedStoreBackend {
  constructor(
    readonly documentId: string,
    private readonly store: DocumentStore
  ) {}

  static fromModel(documentId: string, model: PackageModel): LocalBackend {
    return new LocalBackend(documentId, new DocumentStore(model));
  }

  get documentStore(): DocumentStore {
    return this.store;
  }

  /** Authored-state fingerprint (task 5.6: compare fingerprints, not revision sequences). */
  stateFingerprint(): string {
    return fingerprint('authoredState', encodeModel(this.store.currentModel));
  }

  private payload(): Payload {
    return {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
      model: encodeModel(this.store.currentModel),
      revision: this.store.currentRevision,
    };
  }

  snapshot(): Snapshot {
    return {
      envelope: 'snapshot',
      protocolVersion: 1,
      documentId: this.documentId,
      revision: this.store.currentRevision,
      bytesHex: utf8ToHex(JSON.stringify(this.payload())),
    };
  }

  static restore(snapshot: Snapshot): LocalBackend {
    if (snapshot.envelope !== 'snapshot') throw new Error('not a snapshot envelope');
    const payload = JSON.parse(hexToUtf8(snapshot.bytesHex)) as Payload;
    // Atomic restore: reject an unreadable/future schema before building any state.
    if (payload.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      throw new Error(`unsupported snapshot schema ${payload.schemaVersion}`);
    }
    const store = new DocumentStore(decodeModel(payload.model), { revision: payload.revision });
    return new LocalBackend(snapshot.documentId, store);
  }

  encodeUpdate(updateId: string): ReplicationUpdate {
    const payload: Payload = this.payload();
    return {
      envelope: 'update',
      protocolVersion: 1,
      documentId: this.documentId,
      updateId,
      bytesHex: utf8ToHex(JSON.stringify(payload)),
    };
  }

  decodeUpdate(update: ReplicationUpdate): { model: SerializedModel; revision: number } {
    if (update.envelope !== 'update') throw new Error('not an update envelope');
    if (update.documentId !== this.documentId)
      throw new Error('update belongs to another document');
    return JSON.parse(hexToUtf8(update.bytesHex)) as Payload;
  }
}
