/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import {
  BOOTSTRAP_ORIGIN,
  createNodeRecord,
  insertChild,
  META_KEY,
  NODES_KEY,
  ROOT_ID,
  type LocalOrigin,
  type ModelKind,
} from './model.ts';

export interface Replica {
  readonly actorId: string;
  readonly clientId: number;
  readonly doc: Y.Doc;
  readonly meta: Y.Map<unknown>;
  readonly model: ModelKind;
  readonly nodes: Y.Map<unknown>;
  readonly origin: LocalOrigin;
  readonly undo: Y.UndoManager;
}

export function createReplica(
  model: ModelKind,
  actorId: string,
  clientId: number,
  snapshot?: Uint8Array
): Replica {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  if (snapshot) Y.applyUpdate(doc, snapshot, 'remote');
  const meta = doc.getMap<unknown>(META_KEY);
  const nodes = doc.getMap<unknown>(NODES_KEY);
  const origin: LocalOrigin = { kind: 'spike-local', actorId };
  const undo = new Y.UndoManager([meta, nodes], {
    trackedOrigins: new Set([origin]),
    captureTimeout: 0,
  });
  return { actorId, clientId, doc, meta, model, nodes, origin, undo };
}

export function seedDocument(replica: Replica): void {
  replica.doc.transact(() => {
    replica.meta.set('model', replica.model);
    replica.meta.set('repairVersion', 1);
    replica.meta.set('rootId', ROOT_ID);
    replica.nodes.set(ROOT_ID, createNodeRecord('body', '', null, replica.model));
  }, BOOTSTRAP_ORIGIN);
  insertChild(replica.nodes, BOOTSTRAP_ORIGIN, replica.model, ROOT_ID, 0, 'p1', 'p', '');
  insertChild(replica.nodes, BOOTSTRAP_ORIGIN, replica.model, 'p1', 0, 'r1', 'r', 'one');
  insertChild(replica.nodes, BOOTSTRAP_ORIGIN, replica.model, ROOT_ID, 1, 'p2', 'p', '');
  insertChild(replica.nodes, BOOTSTRAP_ORIGIN, replica.model, 'p2', 0, 'r2', 'r', 'two');
  insertChild(replica.nodes, BOOTSTRAP_ORIGIN, replica.model, ROOT_ID, 2, 'p3', 'p', '');
  insertChild(replica.nodes, BOOTSTRAP_ORIGIN, replica.model, 'p3', 0, 'r3', 'r', 'three');
}

export function pair(model: ModelKind): {
  readonly alice: Replica;
  readonly bob: Replica;
  readonly destroy: () => void;
} {
  const alice = createReplica(model, 'alice', 1);
  seedDocument(alice);
  const bob = createReplica(model, 'bob', 2, Y.encodeStateAsUpdate(alice.doc));
  return {
    alice,
    bob,
    destroy() {
      alice.undo.destroy();
      bob.undo.destroy();
      alice.doc.destroy();
      bob.doc.destroy();
    },
  };
}

export function sync(left: Y.Doc, right: Y.Doc): void {
  const leftUpdate = Y.encodeStateAsUpdate(left, Y.encodeStateVector(right));
  const rightUpdate = Y.encodeStateAsUpdate(right, Y.encodeStateVector(left));
  Y.applyUpdate(right, leftUpdate, 'remote');
  Y.applyUpdate(left, rightUpdate, 'remote');
}

export function snapshotVector(doc: Y.Doc): Uint8Array {
  return Y.encodeStateVector(doc);
}

export function updateSince(doc: Y.Doc, vector: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(doc, vector);
}

export function applyRemote(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, 'remote');
}
