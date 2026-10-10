/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import type { OoxmlPart } from '@docx-editor.dev/core/store';
import type { BackendKind, ByteSizes, LogicalId, RepresentationBackend } from './contract.ts';
import { isElementRecord } from './contract.ts';
import { XmlBackend } from './xml-backend.ts';
import { RegistryBackend } from './registry-backend.ts';
import { Materializer } from './materialize.ts';
import { LogicalIdMint } from './identity.ts';

export function createBackend(kind: BackendKind, doc: Y.Doc): RepresentationBackend {
  return kind === 'xml' ? new XmlBackend(doc) : new RegistryBackend(doc);
}

export interface Replica {
  readonly actorId: string;
  readonly doc: Y.Doc;
  readonly backend: RepresentationBackend;
  readonly materializer: Materializer;
  readonly mint: LogicalIdMint;
  readonly undo: Y.UndoManager;
  readonly lastSnapshot: Uint8Array;
}

export function createReplica(
  kind: BackendKind,
  actorId: string,
  clientID: number,
  part?: OoxmlPart
): Replica {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  const backend = createBackend(kind, doc);
  if (part) backend.seed(part);
  const undo = new Y.UndoManager([...backend.trackedTypes()], { captureTimeout: 0 });
  const materializer = new Materializer(backend);
  if (part) materializer.rebuild();
  return {
    actorId,
    doc,
    backend,
    materializer,
    mint: new LogicalIdMint(actorId),
    undo,
    lastSnapshot: backend.encodeSnapshot(),
  };
}

export function joinReplica(
  kind: BackendKind,
  actorId: string,
  clientID: number,
  snapshot: Uint8Array
): Replica {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  const backend = createBackend(kind, doc);
  backend.beginBulkLoad();
  Y.applyUpdate(doc, snapshot, 'spike-join');
  backend.endBulkLoad();
  const undo = new Y.UndoManager([...backend.trackedTypes()], { captureTimeout: 0 });
  const materializer = new Materializer(backend);
  materializer.rebuild();
  return {
    actorId,
    doc,
    backend,
    materializer,
    mint: new LogicalIdMint(actorId),
    undo,
    lastSnapshot: backend.encodeSnapshot(),
  };
}

export function measureBytes(replica: Replica, before: Uint8Array): ByteSizes {
  const snapshotBytes = replica.backend.encodeSnapshot().byteLength;
  const updateBytes = replica.backend.encodeUpdate(
    Y.encodeStateVectorFromUpdate(before)
  ).byteLength;
  return { updateBytes, snapshotBytes };
}

export function syncOne(source: Replica, target: Replica): ByteSizes {
  const vector = Y.encodeStateVector(target.doc);
  const update = Y.encodeStateAsUpdate(source.doc, vector);
  Y.applyUpdate(target.doc, update, 'spike-manual');
  target.materializer.rebuild();
  return {
    updateBytes: update.byteLength,
    snapshotBytes: Y.encodeStateAsUpdate(source.doc).byteLength,
  };
}

export function syncBoth(left: Replica, right: Replica): { left: ByteSizes; right: ByteSizes } {
  const leftSizes = syncOne(left, right);
  const rightSizes = syncOne(right, left);
  return { left: leftSizes, right: rightSizes };
}

export function applyDelivery(target: Replica, updates: readonly Uint8Array[]): void {
  for (const update of updates) Y.applyUpdate(target.doc, update, 'spike-delivery');
  target.materializer.rebuild();
}

export interface Pair {
  readonly kind: BackendKind;
  readonly left: Replica;
  readonly right: Replica;
  readonly fixture: OoxmlPart;
}

export function createPair(
  kind: BackendKind,
  fixture: OoxmlPart,
  clients: readonly [number, number] = [1, 2]
): Pair {
  const left = createReplica(kind, 'alice', clients[0], fixture);
  const right = joinReplica(kind, 'bob', clients[1], left.backend.encodeSnapshot());
  return { kind, left, right, fixture };
}

export function destroyReplica(replica: Replica): void {
  replica.undo.destroy();
  replica.materializer.destroy();
  replica.doc.destroy();
}

export function destroyPair(pair: Pair): void {
  destroyReplica(pair.left);
  destroyReplica(pair.right);
}

export function concurrent(
  pair: Pair,
  leftEdit: (replica: Replica) => void,
  rightEdit: (replica: Replica) => void,
  order: 'left-right' | 'right-left' = 'left-right'
): { leftUpdate: Uint8Array; rightUpdate: Uint8Array; sizes: ByteSizes } {
  const leftVector = Y.encodeStateVector(pair.left.doc);
  const rightVector = Y.encodeStateVector(pair.right.doc);
  leftEdit(pair.left);
  pair.left.materializer.rebuild();
  rightEdit(pair.right);
  pair.right.materializer.rebuild();
  const leftUpdate = Y.encodeStateAsUpdate(pair.left.doc, rightVector);
  const rightUpdate = Y.encodeStateAsUpdate(pair.right.doc, leftVector);
  if (order === 'left-right') {
    Y.applyUpdate(pair.right.doc, leftUpdate, 'spike-manual');
    Y.applyUpdate(pair.left.doc, rightUpdate, 'spike-manual');
  } else {
    Y.applyUpdate(pair.left.doc, rightUpdate, 'spike-manual');
    Y.applyUpdate(pair.right.doc, leftUpdate, 'spike-manual');
  }
  pair.left.materializer.rebuild();
  pair.right.materializer.rebuild();
  return {
    leftUpdate,
    rightUpdate,
    sizes: {
      updateBytes: leftUpdate.byteLength + rightUpdate.byteLength,
      snapshotBytes: Y.encodeStateAsUpdate(pair.left.doc).byteLength,
    },
  };
}

export function logicalId(replica: Replica, predicate: (id: LogicalId) => boolean): LogicalId {
  const visit = (id: LogicalId): LogicalId | null => {
    if (predicate(id)) return id;
    const record = replica.backend.record(id);
    if (!record || !isElementRecord(record)) return null;
    for (const child of record.childIds) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  const found = visit(replica.backend.rootLogicalId());
  if (!found) throw new Error('logical id not found');
  return found;
}
