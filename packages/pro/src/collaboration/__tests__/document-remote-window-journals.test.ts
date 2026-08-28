/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A journal published while the session installs a remote package must not be dropped.
//
// A `change` subscriber that transacts during a remote install commits locally and publishes
// its journal into the `applyingRemote` window. Dropping it there left the edit on one
// replica — never replicated, never refused, status `ready` — the silent divergence a
// refusal exists to prevent. The session now holds such journals and applies them the moment
// the install finishes; a refusal mid-drain abandons the rest of the buffer exactly as it
// abandons the rest of a flush batch.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  ORIGIN_IDS,
  TreePackageStore,
  normalizeParagraphIdentity,
  readOoxmlPackage,
  type StoryScope,
} from '@docx-editor.dev/core/store';
import {
  createCollaborationDocumentPort,
  type CanonicalPrimitiveJournal,
  type CollaborationDocumentPort,
} from '@docx-editor.dev/core/collaboration/replication';
import {
  createDocumentCollaboration,
  type DocumentCollaborationHandle,
} from '../document-session.ts';
import { collaborationDocx } from './support.ts';
import { packageFingerprint } from './document-support.ts';

const DOCUMENT_ID = 'remote-window-room';
const BODY: StoryScope = { kind: 'body' };

interface Peer {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  readonly room: DocumentCollaborationHandle;
  readonly store: TreePackageStore;
  readonly port: CollaborationDocumentPort;
  readonly emitJournal: (journal: CanonicalPrimitiveJournal) => void;
}

const opened: Peer[] = [];

afterEach(() => {
  for (const peer of opened.splice(0)) {
    peer.room.destroy();
    peer.awareness.destroy();
    peer.ydoc.destroy();
  }
});

async function createPeer(name: string, host?: Peer): Promise<Peer> {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc), 'join');
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: DOCUMENT_ID,
    identity: { actorId: name, name },
    bootstrap: host
      ? { kind: 'join', timeoutMs: 5_000 }
      : { kind: 'create', document: collaborationDocx() },
  });
  const loaded = readOoxmlPackage(room.document);
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('no main part');
  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  const base = createCollaborationDocumentPort(store, { documentId: DOCUMENT_ID });
  // The session's contract is that journals arrive through `observePrimitiveJournal`, so the
  // tap records the listener the session registers instead of adding a test-only port method.
  let tap: ((journal: CanonicalPrimitiveJournal) => void) | null = null;
  const port: CollaborationDocumentPort = {
    ...base,
    observePrimitiveJournal: (listener) => {
      tap = listener;
      return base.observePrimitiveJournal(listener);
    },
  };
  room.session.attach(port);
  const peer: Peer = {
    ydoc,
    awareness,
    room,
    store,
    port,
    emitJournal: (journal) => {
      if (!tap) throw new Error('port is not tapped');
      tap(journal);
    },
  };
  opened.push(peer);
  return peer;
}

function firstParagraphId(store: TreePackageStore): string {
  let found: string | null = null;
  const walk = (node: { kind: string; id: string; children?: readonly unknown[] }): void => {
    if (found) return;
    if (node.kind === 'paragraph') {
      found = node.id;
      return;
    }
    for (const child of node.children ?? []) walk(child as never);
  };
  walk(store.bodyStore().part.root as never);
  if (!found) throw new Error('no paragraph');
  return found;
}

function bodyText(store: TreePackageStore): string {
  const texts: string[] = [];
  const walk = (node: { kind: string; value?: string; children?: readonly unknown[] }): void => {
    if (node.kind === 'textValue' && typeof node.value === 'string') texts.push(node.value);
    for (const child of node.children ?? []) walk(child as never);
  };
  walk(store.bodyStore().part.root as never);
  return texts.join('');
}

function type(peer: Peer, text: string): void {
  const result = peer.store.transact(BODY, (context) => {
    context.apply({
      op: 'insertText',
      paragraphId: firstParagraphId(peer.store),
      offset: 0,
      text,
    });
  });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  peer.port.flushPendingJournals();
}

function relay(from: Peer, to: Peer): void {
  Y.applyUpdate(to.ydoc, Y.encodeStateAsUpdate(from.ydoc, Y.encodeStateVector(to.ydoc)), 'relay');
}

function expectConverged(left: Peer, right: Peer): void {
  expect(packageFingerprint(right.store.currentPackage())).toBe(
    packageFingerprint(left.store.currentPackage())
  );
}

describe('journals published during a remote install', () => {
  test('a change-subscriber edit during a remote install replicates', async () => {
    const alice = await createPeer('alice');
    const bob = await createPeer('bob', alice);
    // Bob reacts to every remote install by writing — the shape a derivation hook has.
    let reacted = false;
    const stop = bob.store.subscribe((change) => {
      if (reacted || change.origin !== ORIGIN_IDS.mutationRemote) return;
      reacted = true;
      type(bob, 'HOOK-');
    });
    try {
      type(alice, 'A');
      relay(alice, bob);
      expect(reacted).toBe(true);
      expect(bodyText(bob.store)).toContain('HOOK-');
      expect(bob.room.session.statusSnapshot().status).toBe('ready');
      // The hook's edit must reach the room. Before the fix it stayed on bob alone.
      relay(bob, alice);
      expect(bodyText(alice.store)).toContain('HOOK-');
      expectConverged(alice, bob);
    } finally {
      stop();
    }
  });

  test('a refusal mid-drain abandons the rest of the held journals', async () => {
    const alice = await createPeer('alice');
    const bob = await createPeer('bob', alice);
    // Two journals land in the remote window: the first refuses (a node shared state does
    // not hold), so the realign must abandon the second — it describes a tree the realign
    // just took back, and pushing it would publish content this author cannot see.
    let reacted = false;
    const stop = bob.store.subscribe((change) => {
      if (reacted || change.origin !== ORIGIN_IDS.mutationRemote) return;
      reacted = true;
      bob.emitJournal({
        effects: [
          {
            kind: 'spliceText',
            logicalId: 'no-such-node',
            utf16Start: 0,
            deleteCount: 0,
            insert: 'X',
          },
        ],
      });
      bob.emitJournal({
        effects: [
          {
            kind: 'spliceText',
            logicalId: 'no-such-node-either',
            utf16Start: 0,
            deleteCount: 0,
            insert: 'Y',
          },
        ],
      });
    });
    try {
      type(alice, 'A');
      relay(alice, bob);
      expect(reacted).toBe(true);
      // One refusal recovers, and the second held journal never applies.
      await Promise.resolve();
      const snapshot = bob.room.session.statusSnapshot();
      expect(snapshot.status).toBe('ready');
      expect(snapshot.lastFailure?.code).toBe('unknown-logical-id');
      relay(bob, alice);
      expectConverged(alice, bob);
      expect(bodyText(alice.store)).not.toContain('X');
      expect(bodyText(alice.store)).not.toContain('Y');
    } finally {
      stop();
    }
  });
});
