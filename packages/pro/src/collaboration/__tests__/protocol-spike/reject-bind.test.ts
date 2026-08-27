/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { captureUpdates, clientIdsIn, clientRange } from './helpers.ts';

describe('authenticated bind, reject, and rebase', () => {
  test('a peer can mint structs that reuse another client ID before first sync', () => {
    const alice = new Y.Doc();
    alice.clientID = 111;
    alice.getText('t').insert(0, 'alice');

    const spoof = new Y.Doc();
    spoof.clientID = 111;
    spoof.getText('t').insert(0, 'FORGED');
    const forged = Y.encodeStateAsUpdate(spoof);

    expect(clientIdsIn(forged)).toEqual([111]);
    expect(clientRange(forged)).toEqual({ from: { '111': 0 }, to: { '111': 6 } });

    const room = new Y.Doc();
    Y.applyUpdate(room, forged);
    expect(room.getText('t').toString()).toBe('FORGED');
  });

  test('two isolated writers that share a client ID collide and drop the second insert', () => {
    const alice = new Y.Doc();
    alice.clientID = 42;
    alice.getText('t').insert(0, 'AAAAAA');
    const bob = new Y.Doc();
    bob.clientID = 42;
    bob.getText('t').insert(0, 'BBBBBB');

    const room = new Y.Doc();
    Y.applyUpdate(room, Y.encodeStateAsUpdate(alice));
    Y.applyUpdate(room, Y.encodeStateAsUpdate(bob));
    expect(room.getText('t').toString()).toBe('AAAAAA');
  });

  test('server can bind new structs to a session client ID with parseUpdateMeta', () => {
    const alice = new Y.Doc();
    alice.clientID = 111;
    const frames = captureUpdates(alice);
    alice.getText('t').insert(0, 'ok');
    const assigned = 111;
    expect(clientIdsIn(frames[0]!).every((id) => id === assigned)).toBe(true);
  });

  test('delete-only updates have empty parseUpdateMeta ranges, so deletes bind from the session not struct IDs', () => {
    const alice = new Y.Doc();
    alice.clientID = 111;
    const aliceFrames = captureUpdates(alice);
    alice.getText('t').insert(0, 'good');

    const bob = new Y.Doc();
    bob.clientID = 222;
    Y.applyUpdate(bob, aliceFrames[0]!);
    const bobFrames = captureUpdates(bob);
    bob.transact(() => {
      bob.getText('t').delete(0, 4);
    });

    expect(clientRange(bobFrames[0]!)).toEqual({ from: {}, to: {} });
    const decoded = Y.decodeUpdate(bobFrames[0]!);
    expect(decoded.structs).toEqual([]);
    expect(decoded.ds.clients.has(111)).toBe(true);
  });

  test('dropping one update from a client ID permanently pending-blocks later clocks from that ID', () => {
    const alice = new Y.Doc();
    alice.clientID = 111;
    const frames = captureUpdates(alice);
    alice.transact(() => alice.getText('t').insert(0, 'A'));
    alice.transact(() => alice.getText('t').insert(1, 'B'));
    alice.transact(() => alice.getText('t').insert(2, 'C'));
    alice.transact(() => alice.getText('t').insert(3, 'D'));

    const server = new Y.Doc();
    Y.applyUpdate(server, frames[0]!);
    Y.applyUpdate(server, frames[2]!);
    expect(server.getText('t').toString()).toBe('A');
    expect(server.store.pendingStructs).not.toBe(null);

    Y.applyUpdate(server, frames[3]!);
    expect(server.getText('t').toString()).toBe('A');
    expect(server.store.pendingStructs).not.toBe(null);

    Y.applyUpdate(server, frames[1]!);
    expect(server.getText('t').toString()).toBe('ABCD');
    expect(server.store.pendingStructs).toBe(null);
  });

  test('applying a semantically invalid update still lets later clocks integrate', () => {
    const alice = new Y.Doc();
    alice.clientID = 111;
    const frames = captureUpdates(alice);
    alice.transact(() => alice.getText('t').insert(0, 'good'));
    alice.transact(() => alice.getText('t').insert(4, 'BAD'));
    alice.transact(() => alice.getText('t').insert(7, 'later'));

    const server = new Y.Doc();
    Y.applyUpdate(server, frames[0]!);
    Y.applyUpdate(server, frames[1]!);
    Y.applyUpdate(server, frames[2]!);
    expect(server.getText('t').toString()).toBe('goodBADlater');
    expect(server.store.pendingStructs).toBe(null);
  });

  test('NACK without rebase cannot admit later dependent frames', () => {
    const alice = new Y.Doc();
    alice.clientID = 111;
    const frames = captureUpdates(alice);
    alice.transact(() => alice.getText('t').insert(0, 'good'));
    alice.transact(() => alice.getText('t').insert(4, 'BAD'));
    alice.transact(() => alice.getText('t').insert(7, 'later'));

    const server = new Y.Doc();
    Y.applyUpdate(server, frames[0]!);
    Y.applyUpdate(server, frames[2]!);
    expect(server.getText('t').toString()).toBe('good');
    expect(server.store.pendingStructs).not.toBe(null);
  });

  test('after NACK, a snapshot rebase yields a new client ID and later edits admit on a clean server', () => {
    const alice = new Y.Doc();
    alice.clientID = 111;
    const frames = captureUpdates(alice);
    alice.transact(() => alice.getText('t').insert(0, 'good'));
    alice.transact(() => alice.getText('t').insert(4, 'BAD'));

    const server = new Y.Doc();
    Y.applyUpdate(server, frames[0]!);
    const snapshot = Y.encodeStateAsUpdate(server);

    const rebased = new Y.Doc();
    rebased.clientID = 111;
    Y.applyUpdate(rebased, snapshot);
    expect(rebased.clientID).not.toBe(111);
    expect(rebased.getText('t').toString()).toBe('good');

    const retry = captureUpdates(rebased);
    rebased.getText('t').insert(4, 'OK');
    expect(clientIdsIn(retry[0]!)).toEqual([rebased.clientID]);

    const clean = new Y.Doc();
    Y.applyUpdate(clean, snapshot);
    Y.applyUpdate(clean, retry[0]!);
    expect(clean.getText('t').toString()).toBe('goodOK');
    expect(clean.store.pendingStructs).toBe(null);
  });

  test('changing client ID on a poisoned local doc still pending-blocks because item origin points at missing structs', () => {
    const alice = new Y.Doc();
    alice.clientID = 111;
    const frames = captureUpdates(alice);
    alice.transact(() => alice.getText('t').insert(0, 'A'));
    alice.transact(() => alice.getText('t').insert(1, 'B'));
    alice.transact(() => alice.getText('t').insert(2, 'C'));

    const server = new Y.Doc();
    Y.applyUpdate(server, frames[0]!);

    alice.clientID = 333;
    const later = captureUpdates(alice);
    alice.getText('t').insert(3, 'D');
    Y.applyUpdate(server, later[0]!);
    expect(server.getText('t').toString()).toBe('A');
    expect(server.store.pendingStructs).not.toBe(null);
  });

  test('offline merged delivery cannot reconstruct actor transaction boundaries', () => {
    const alice = new Y.Doc();
    alice.clientID = 111;
    const frames = captureUpdates(alice);
    alice.transact(() => alice.getText('t').insert(0, 'A'), { actorId: 'alice', seq: 1 });
    alice.transact(() => alice.getText('t').insert(1, 'B'), { actorId: 'alice', seq: 2 });
    alice.transact(() => alice.getText('t').insert(2, 'C'), { actorId: 'alice', seq: 3 });

    const merged = Y.mergeUpdates(frames);
    const remote = new Y.Doc();
    const remoteTx: unknown[] = [];
    remote.on('afterTransaction', (transaction: Y.Transaction) => {
      remoteTx.push(transaction.origin);
    });
    Y.applyUpdate(remote, merged, { principalId: 'alice' });
    expect(remoteTx).toEqual([{ principalId: 'alice' }]);
    expect(clientRange(merged)).toEqual({ from: { '111': 0 }, to: { '111': 3 } });
  });

  test('a receipt log of unmerged frames reconstructs transaction count after later merge', () => {
    const alice = new Y.Doc();
    alice.clientID = 111;
    const frames = captureUpdates(alice);
    alice.transact(() => alice.getText('t').insert(0, 'A'));
    alice.transact(() => alice.getText('t').insert(1, 'B'));
    alice.transact(() => alice.getText('t').insert(2, 'C'));

    const receipts = frames.map((update, seq) => ({
      principalId: 'alice',
      clientID: alice.clientID,
      seq,
      digest: Buffer.from(update).toString('hex'),
      clients: clientIdsIn(update),
    }));
    expect(receipts).toHaveLength(3);
    expect(receipts.every((row) => row.clients[0] === 111)).toBe(true);

    const stored = Y.mergeUpdates(frames);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, stored);
    expect(restored.getText('t').toString()).toBe('ABC');
    expect(receipts.map((row) => row.seq)).toEqual([0, 1, 2]);
  });
});
