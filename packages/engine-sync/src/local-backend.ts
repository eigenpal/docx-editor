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
  type PackageModel,
  type SerializedModel,
  type Snapshot,
  type ReplicationUpdate,
} from '@docx-editor.dev/engine-core';
import type { ReplicatedStoreBackend } from './backend.ts';

interface Payload {
  readonly model: SerializedModel;
  readonly revision: number;
}

export class LocalBackend implements ReplicatedStoreBackend {
  constructor(
    readonly documentId: string,
    private readonly store: DocumentStore,
  ) {}

  static fromModel(documentId: string, model: PackageModel): LocalBackend {
    return new LocalBackend(documentId, new DocumentStore(model));
  }

  get documentStore(): DocumentStore {
    return this.store;
  }

  snapshot(): Snapshot {
    const payload: Payload = { model: encodeModel(this.store.currentModel), revision: this.store.currentRevision };
    return {
      envelope: 'snapshot',
      protocolVersion: 1,
      documentId: this.documentId,
      revision: this.store.currentRevision,
      bytesHex: utf8ToHex(JSON.stringify(payload)),
    };
  }

  static restore(snapshot: Snapshot): LocalBackend {
    if (snapshot.envelope !== 'snapshot') throw new Error('not a snapshot envelope');
    const payload = JSON.parse(hexToUtf8(snapshot.bytesHex)) as Payload;
    const store = new DocumentStore(decodeModel(payload.model), { revision: payload.revision });
    return new LocalBackend(snapshot.documentId, store);
  }

  encodeUpdate(updateId: string): ReplicationUpdate {
    const payload: Payload = { model: encodeModel(this.store.currentModel), revision: this.store.currentRevision };
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
    if (update.documentId !== this.documentId) throw new Error('update belongs to another document');
    return JSON.parse(hexToUtf8(update.bytesHex)) as Payload;
  }
}
