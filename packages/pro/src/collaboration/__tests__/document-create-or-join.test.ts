/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The `create-or-join` bootstrap: probe, election, seed records, and the terminal
// `concurrent-seed` outcome when two seed transactions merge.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import {
  ATTACH_WATCHDOG_MS_FOR_TESTS,
  createDocumentCollaboration,
  type CreateDocumentCollaborationOptions,
  type DocumentCollaborationHandle,
} from '../document-session.ts';
import { SEED_RECORDS_KEY } from '../document-bootstrap.ts';
import { PACKAGE_META_KEY } from '../document/schema.ts';
import type { CollaborationBootstrap } from '../session.ts';
import { collaborationDocx } from './support.ts';
import { packageFingerprint } from './document-support.ts';

const DOC_ID = 'create-or-join-room';

// Fast, test-sized windows so a probe on an empty room resolves in milliseconds.
const FAST = { probeTimeoutMs: 60, electionWindowMs: 200, timeoutMs: 5_000 } as const;

interface Replica {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  room: DocumentCollaborationHandle | null;
}

const replicas: Replica[] = [];
const unlinks: (() => void)[] = [];

function replica(): Replica {
  const ydoc = new Y.Doc();
  const created: Replica = { ydoc, awareness: new Awareness(ydoc), room: null };
  replicas.push(created);
  return created;
}

async function open(target: Replica, name: string, bootstrap: CollaborationBootstrap) {
  const options: CreateDocumentCollaborationOptions = {
    ydoc: target.ydoc,
    awareness: target.awareness,
    documentId: DOC_ID,
    identity: { actorId: name, name },
    bootstrap,
  };
  const room = await createDocumentCollaboration({
    ...options,
    [ATTACH_WATCHDOG_MS_FOR_TESTS]: 600_000,
  } as CreateDocumentCollaborationOptions);
  target.room = room;
  return room;
}

/** Live two-way relay of document updates and awareness, with an initial state exchange. */
function link(left: Replica, right: Replica): void {
  Y.applyUpdate(right.ydoc, Y.encodeStateAsUpdate(left.ydoc), 'link');
  Y.applyUpdate(left.ydoc, Y.encodeStateAsUpdate(right.ydoc), 'link');
  const forwardDoc = (target: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (origin === 'link') return;
    Y.applyUpdate(target, update, 'link');
  };
  const forwardAwareness =
    (source: Awareness, target: Awareness) =>
    (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
      if (origin === 'link') return;
      const clients = [...changes.added, ...changes.updated, ...changes.removed];
      if (clients.length === 0) return;
      applyAwarenessUpdate(target, encodeAwarenessUpdate(source, clients), 'link');
    };
  const onLeftDoc = forwardDoc(right.ydoc);
  const onRightDoc = forwardDoc(left.ydoc);
  const onLeftAwareness = forwardAwareness(left.awareness, right.awareness);
  const onRightAwareness = forwardAwareness(right.awareness, left.awareness);
  left.ydoc.on('update', onLeftDoc);
  right.ydoc.on('update', onRightDoc);
  left.awareness.on('update', onLeftAwareness);
  right.awareness.on('update', onRightAwareness);
  unlinks.push(() => {
    left.ydoc.off('update', onLeftDoc);
    right.ydoc.off('update', onRightDoc);
    left.awareness.off('update', onLeftAwareness);
    right.awareness.off('update', onRightAwareness);
  });
}

function seedCount(target: Replica): number {
  return target.ydoc.getArray(SEED_RECORDS_KEY).length;
}

function fingerprintOf(bytes: Uint8Array): string {
  const opened = readOoxmlPackage(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  return packageFingerprint(opened.package);
}

afterEach(() => {
  for (const stop of unlinks.splice(0)) stop();
  for (const open of replicas.splice(0)) {
    open.room?.destroy();
    open.awareness.destroy();
    open.ydoc.destroy();
  }
});

describe('create-or-join bootstrap', () => {
  test('seeds an empty room, records one seed, and becomes ready', async () => {
    const started = Date.now();
    const alice = replica();
    const room = await open(alice, 'alice', {
      kind: 'create-or-join',
      document: collaborationDocx(),
      ...FAST,
    });
    expect(room.session.status()).toBe('ready');
    expect(alice.ydoc.getMap(PACKAGE_META_KEY).get('initialized')).toBe(true);
    expect(alice.ydoc.getMap(PACKAGE_META_KEY).get('documentId')).toBe(DOC_ID);
    expect(seedCount(alice)).toBe(1);
    // The probe and election windows are overridable, so the whole dance stays fast.
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  test('joins an initialized create-or-join room without a second seed', async () => {
    const alice = replica();
    const bob = replica();
    const seeded = await open(alice, 'alice', {
      kind: 'create-or-join',
      document: collaborationDocx(),
      ...FAST,
    });
    link(alice, bob);
    const joined = await open(bob, 'bob', {
      kind: 'create-or-join',
      document: collaborationDocx('A different local copy'),
      ...FAST,
    });
    expect(joined.session.status()).toBe('ready');
    expect(seedCount(alice)).toBe(1);
    expect(seedCount(bob)).toBe(1);
    // The joiner took the room's document, not its own local copy.
    expect(fingerprintOf(joined.document)).toBe(fingerprintOf(seeded.document));
  });

  test('joins a legacy room that has no seed records', async () => {
    const alice = replica();
    const bob = replica();
    const legacy = await open(alice, 'alice', {
      kind: 'create',
      document: collaborationDocx(),
    });
    link(alice, bob);
    const joined = await open(bob, 'bob', {
      kind: 'create-or-join',
      document: collaborationDocx(),
      ...FAST,
    });
    expect(joined.session.status()).toBe('ready');
    expect(seedCount(alice)).toBe(0);
    expect(seedCount(bob)).toBe(0);
    expect(fingerprintOf(joined.document)).toBe(fingerprintOf(legacy.document));
  });

  test('elects exactly one seeder between two concurrent create-or-join peers', async () => {
    const alice = replica();
    const bob = replica();
    link(alice, bob);
    const [roomA, roomB] = await Promise.all([
      open(alice, 'alice', { kind: 'create-or-join', document: collaborationDocx(), ...FAST }),
      open(bob, 'bob', { kind: 'create-or-join', document: collaborationDocx(), ...FAST }),
    ]);
    expect(roomA.session.status()).toBe('ready');
    expect(roomB.session.status()).toBe('ready');
    expect(seedCount(alice)).toBe(1);
    expect(seedCount(bob)).toBe(1);
    expect(fingerprintOf(roomA.document)).toBe(fingerprintOf(roomB.document));
  });

  test('a forced double seed turns every replica terminal with concurrent-seed', async () => {
    // No link while both bootstrap, so neither the probe nor the election can see the
    // other peer: both seed. This is the partition create-or-join cannot prevent.
    const alice = replica();
    const bob = replica();
    const roomA = await open(alice, 'alice', {
      kind: 'create-or-join',
      document: collaborationDocx(),
      probeTimeoutMs: 30,
      electionWindowMs: 30,
    });
    const roomB = await open(bob, 'bob', {
      kind: 'create-or-join',
      document: collaborationDocx(),
      probeTimeoutMs: 30,
      electionWindowMs: 30,
    });
    expect(roomA.session.status()).toBe('ready');
    expect(roomB.session.status()).toBe('ready');
    link(alice, bob);
    expect(seedCount(alice)).toBe(2);
    expect(seedCount(bob)).toBe(2);
    for (const room of [roomA, roomB]) {
      const snapshot = room.session.statusSnapshot();
      expect(snapshot.status).toBe('error');
      expect(snapshot.reason?.code).toBe('concurrent-seed');
    }
    // Terminal: a later transport recovery must not lift the error.
    roomA.session.setTransportStatus('ready');
    expect(roomA.session.status()).toBe('error');
  });

  test('a plain join refuses a polluted room outright', async () => {
    const alice = replica();
    const bob = replica();
    const roomA = await open(alice, 'alice', {
      kind: 'create-or-join',
      document: collaborationDocx(),
      probeTimeoutMs: 30,
      electionWindowMs: 30,
    });
    const roomB = await open(bob, 'bob', {
      kind: 'create-or-join',
      document: collaborationDocx(),
      probeTimeoutMs: 30,
      electionWindowMs: 30,
    });
    expect(roomA.session.status()).toBe('ready');
    expect(roomB.session.status()).toBe('ready');
    link(alice, bob);
    const carol = replica();
    Y.applyUpdate(carol.ydoc, Y.encodeStateAsUpdate(alice.ydoc), 'link');
    await expect(open(carol, 'carol', { kind: 'join', timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'concurrent-seed',
    });
  });
});
