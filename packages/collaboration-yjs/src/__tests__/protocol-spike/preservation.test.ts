import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  applyAll,
  captureTransactions,
  captureUpdates,
  clientIdsIn,
  clientRange,
} from './helpers.ts';

describe('Yjs update preservation', () => {
  test('transaction origin stays on the local replica and is not in the update bytes', () => {
    const local = new Y.Doc();
    local.clientID = 111;
    const frames = captureUpdates(local);
    const localTx = captureTransactions(local);
    const origin = { actorId: 'alice', kind: 'local-edit' };
    local.transact(() => {
      local.getText('t').insert(0, 'A');
    }, origin);

    expect(localTx).toHaveLength(1);
    expect(localTx[0]?.origin).toBe(origin);

    const remote = new Y.Doc();
    const remoteTx = captureTransactions(remote);
    Y.applyUpdate(remote, frames[0]!);

    expect(remoteTx).toHaveLength(1);
    expect(remoteTx[0]?.origin).toBe(null);
    expect(remoteTx[0]?.local).toBe(false);
    expect(Y.decodeUpdate(frames[0]!).structs.length).toBeGreaterThan(0);
    expect(JSON.stringify(Y.decodeUpdate(frames[0]!))).not.toContain('alice');
  });

  test('applyUpdate origin is the receiver argument, not the sender origin', () => {
    const local = new Y.Doc();
    const frames = captureUpdates(local);
    local.transact(() => {
      local.getText('t').insert(0, 'A');
    }, 'sender-origin');

    const remote = new Y.Doc();
    const remoteTx = captureTransactions(remote);
    Y.applyUpdate(remote, frames[0]!, 'server-receipt');

    expect(remoteTx[0]?.origin).toBe('server-receipt');
    expect(remote.getText('t').toString()).toBe('A');
  });

  test('transaction.meta does not replicate', () => {
    const local = new Y.Doc();
    local.on('afterTransaction', (transaction) => {
      transaction.meta.set('actorId', 'alice');
    });
    local.getText('t').insert(0, 'x');

    const remote = new Y.Doc();
    const remoteTx = captureTransactions(remote);
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
    expect(remoteTx[0]?.metaKeys).toEqual([]);
  });

  test('client IDs in structs survive encodeStateAsUpdate, mergeUpdates, and checkpoints', () => {
    const alice = new Y.Doc();
    alice.clientID = 111;
    const bob = new Y.Doc();
    bob.clientID = 222;
    const aliceFrames = captureUpdates(alice);
    const bobFrames = captureUpdates(bob);
    alice.getText('t').insert(0, 'A');
    Y.applyUpdate(bob, aliceFrames[0]!);
    bob.getText('t').insert(1, 'B');

    const merged = Y.mergeUpdates([aliceFrames[0]!, bobFrames[bobFrames.length - 1]!]);
    const checkpoint = Y.encodeStateAsUpdate(bob);
    expect(clientIdsIn(aliceFrames[0]!)).toEqual([111]);
    expect(clientIdsIn(merged).sort((a, b) => a - b)).toEqual([111, 222]);
    expect(clientIdsIn(checkpoint).sort((a, b) => a - b)).toEqual([111, 222]);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, checkpoint);
    expect([...restored.store.clients.keys()].sort((a, b) => a - b)).toEqual([111, 222]);
    expect(restored.getText('t').toString()).toBe('AB');
  });

  test('encodeStateAsUpdate of two local transactions collapses them into one remote transaction', () => {
    const local = new Y.Doc();
    local.clientID = 111;
    local.transact(() => local.getText('t').insert(0, 'A'), 'txn-1');
    local.transact(() => local.getText('t').insert(1, 'B'), 'txn-2');

    const remote = new Y.Doc();
    const remoteTx = captureTransactions(remote);
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local), 'checkpoint');

    expect(remoteTx).toHaveLength(1);
    expect(remoteTx[0]?.origin).toBe('checkpoint');
    expect(remoteTx[0]?.after['111']).toBe(2);
    expect(remote.getText('t').toString()).toBe('AB');
  });

  test('mergeUpdates of per-transaction frames also collapses transaction boundaries', () => {
    const local = new Y.Doc();
    local.clientID = 111;
    const frames = captureUpdates(local);
    local.transact(() => local.getText('t').insert(0, 'A'));
    local.transact(() => local.getText('t').insert(1, 'B'));
    local.transact(() => local.getText('t').insert(2, 'C'));

    expect(frames).toHaveLength(3);
    const merged = Y.mergeUpdates(frames);
    expect(merged.byteLength).toBeLessThan(
      frames.reduce((sum, frame) => sum + frame.byteLength, 0)
    );

    const remote = new Y.Doc();
    const remoteTx = captureTransactions(remote);
    Y.applyUpdate(remote, merged, 'offline-batch');
    expect(remoteTx).toHaveLength(1);
    expect(remote.getText('t').toString()).toBe('ABC');
    expect(clientRange(merged)).toEqual({ from: { '111': 0 }, to: { '111': 3 } });
  });

  test('applying unmerged frames preserves one remote transaction per local transaction', () => {
    const local = new Y.Doc();
    const frames = captureUpdates(local);
    local.transact(() => local.getText('t').insert(0, 'A'));
    local.transact(() => local.getText('t').insert(1, 'B'));
    local.transact(() => local.getText('t').insert(2, 'C'));

    const remote = new Y.Doc();
    const remoteTx = captureTransactions(remote);
    applyAll(remote, frames, 'frame');
    expect(remoteTx).toHaveLength(3);
    expect(remoteTx.every((row) => row.origin === 'frame')).toBe(true);
    expect(remote.getText('t').toString()).toBe('ABC');
  });

  test('UndoManager stacks do not survive checkpoint restore on a new doc', () => {
    const local = new Y.Doc();
    const text = local.getText('t');
    const undo = new Y.UndoManager(text, { trackedOrigins: new Set(['local']), captureTimeout: 0 });
    local.transact(() => text.insert(0, 'one'), 'local');
    local.transact(() => text.insert(3, 'two'), 'local');
    expect(undo.undoStack.length).toBe(2);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(local), 'checkpoint');
    const restoredUndo = new Y.UndoManager(restored.getText('t'), {
      trackedOrigins: new Set(['local']),
      captureTimeout: 0,
    });
    expect(restored.getText('t').toString()).toBe('onetwo');
    expect(restoredUndo.undoStack.length).toBe(0);
  });

  test('same in-memory doc keeps UndoManager across a simulated reconnect of later updates', () => {
    const local = new Y.Doc();
    const text = local.getText('t');
    const undo = new Y.UndoManager(text, { trackedOrigins: new Set(['local']), captureTimeout: 0 });
    local.transact(() => text.insert(0, 'one'), 'local');
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
    local.transact(() => text.insert(3, 'two'), 'local');
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local, Y.encodeStateVector(remote)));
    expect(undo.undoStack.length).toBe(2);
    undo.undo();
    expect(local.getText('t').toString()).toBe('one');
  });
});
