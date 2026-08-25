import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { captureUpdates, clientIdsIn } from './helpers.ts';

describe('rejected and limited attribution alternatives', () => {
  test('PermanentUserData mappings replicate and a later writer can overwrite them', () => {
    const alice = new Y.Doc();
    alice.clientID = 111;
    alice.getText('t').insert(0, 'A');
    const aliceUsers = new Y.PermanentUserData(alice);
    aliceUsers.setUserMapping(alice, 111, 'alice-principal');

    const bob = new Y.Doc();
    bob.clientID = 222;
    Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));
    const bobUsers = new Y.PermanentUserData(bob);
    expect(Object.fromEntries(bobUsers.clients)).toEqual({ '111': 'alice-principal' });
    bobUsers.setUserMapping(bob, 111, 'bob-impersonates-alice');
    expect(Object.fromEntries(new Y.PermanentUserData(bob).clients)).toEqual({
      '111': 'bob-impersonates-alice',
    });
  });

  test('Y.Text insert attributes replicate but are client-authored and spoofable', () => {
    const spoof = new Y.Doc();
    spoof.getText('t').insert(0, 'Hi', { actorId: 'admin' });
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(spoof));
    expect(remote.getText('t').toDelta()).toEqual([
      { insert: 'Hi', attributes: { actorId: 'admin' } },
    ]);
  });

  test('awareness identity is local state and is not authenticated', () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField('docxEditor', { actorId: 'admin', name: 'nope' });
    expect(awareness.getLocalState()?.docxEditor).toEqual({ actorId: 'admin', name: 'nope' });
    awareness.destroy();
  });

  test('subdocument meta replicates, and one actor subdoc can be dropped without blocking another actor', () => {
    const parent = new Y.Doc();
    const aliceSub = new Y.Doc({ guid: 'alice-sub', meta: { actorId: 'alice' } });
    const bobSub = new Y.Doc({ guid: 'bob-sub', meta: { actorId: 'bob' } });
    parent.getMap('actors').set('alice', aliceSub);
    parent.getMap('actors').set('bob', bobSub);

    const aliceFrames = captureUpdates(aliceSub);
    const bobFrames = captureUpdates(bobSub);
    aliceSub.getText('t').insert(0, 'alice-bad');
    bobSub.getText('t').insert(0, 'bob-ok');

    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(parent));
    const remoteAlice = remote.getMap('actors').get('alice') as Y.Doc;
    const remoteBob = remote.getMap('actors').get('bob') as Y.Doc;
    expect(remoteAlice.meta).toEqual({ actorId: 'alice' });
    expect(remoteBob.meta).toEqual({ actorId: 'bob' });

    remoteAlice.load();
    remoteBob.load();
    Y.applyUpdate(remoteBob, bobFrames[0]!);
    expect(remoteBob.getText('t').toString()).toBe('bob-ok');
    expect(remoteAlice.getText('t').toString()).toBe('');
    expect(aliceFrames.length).toBeGreaterThan(0);
  });

  test('anyone who can write the parent map can attach a subdoc with forged actor meta', () => {
    const parent = new Y.Doc();
    const forged = new Y.Doc({ guid: 'forged', meta: { actorId: 'alice' } });
    parent.getMap('actors').set('alice', forged);
    forged.getText('t').insert(0, 'not-alice');

    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(parent));
    const attached = remote.getMap('actors').get('alice') as Y.Doc;
    expect(attached.meta).toEqual({ actorId: 'alice' });
    attached.load();
    Y.applyUpdate(attached, Y.encodeStateAsUpdate(forged));
    expect(attached.getText('t').toString()).toBe('not-alice');
  });

  test('a signature over a merged blob cannot recover the original per-transaction frames', () => {
    const doc = new Y.Doc();
    doc.clientID = 111;
    const frames = captureUpdates(doc);
    doc.transact(() => doc.getText('t').insert(0, 'A'));
    doc.transact(() => doc.getText('t').insert(1, 'B'));
    const merged = Y.mergeUpdates(frames);
    expect(merged.byteLength).not.toBe(frames[0]!.byteLength + frames[1]!.byteLength);
    expect(Buffer.from(merged).equals(Buffer.from(frames[0]!))).toBe(false);
    expect(clientIdsIn(merged)).toEqual([111]);
  });
});
