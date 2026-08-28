/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Teardown gives every observer back. The caller owns the Y.Doc and it can outlive any
// registry built over it: a server export runs once per autosave on a document that lives as
// long as the room, and a refused bootstrap is followed by a retry on the same document. A
// leaked observer taxes every later transaction and retains the whole derived index.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocumentCollaboration } from '../document-session.ts';
import { readCollaborationDocument } from '../document-read.ts';
import { CollaborationSchemaError } from '../schema.ts';
import { collaborationDocx } from './support.ts';

const SCHEMA_MAP_KEYS = [
  'docx-package-nodes-v1',
  'docx-package-parts-v1',
  'docx-package-rels-v1',
  'docx-package-overrides-v1',
  'docx-package-defaults-v1',
  'docx-package-binaries-v1',
  'docx-package-attributes-v1',
  'docx-package-bindings-v1',
  'docx-package-meta-v1',
  'docx-package-blobs-v1',
] as const;

const SEED_RECORDS_KEY = 'docx-collaboration-seeds-v1';

/** Handler lists Yjs keeps per type: `_eH` observes the type, `_dEH` observes it deeply. */
interface ObservableInternals {
  readonly _eH: { readonly l: readonly unknown[] };
  readonly _dEH: { readonly l: readonly unknown[] };
}

function typeObserverCount(type: unknown): number {
  const internals = type as ObservableInternals;
  return internals._eH.l.length + internals._dEH.l.length;
}

/**
 * Every handler the collaboration lane can register on the document: the schema maps, the
 * blob map, the seed-record array, and the doc-level `afterTransaction` listeners the
 * session, the undo manager, and the initialization waits attach.
 */
function totalObservers(ydoc: Y.Doc): number {
  let total = 0;
  for (const key of SCHEMA_MAP_KEYS) total += typeObserverCount(ydoc.getMap(key));
  total += typeObserverCount(ydoc.getArray(SEED_RECORDS_KEY));
  const observers = (ydoc as unknown as { _observers: Map<string, Set<unknown>> })._observers;
  total += observers.get('afterTransaction')?.size ?? 0;
  return total;
}

async function seededRoom(): Promise<{
  ydoc: Y.Doc;
  destroy: () => void;
}> {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'teardown-room',
    identity: { actorId: 'seed', name: 'Seed' },
    bootstrap: { kind: 'create', document: collaborationDocx() },
  });
  return {
    ydoc,
    destroy: () => {
      room.destroy();
      awareness.destroy();
    },
  };
}

describe('collaboration teardown', () => {
  test('readCollaborationDocument leaves no observers behind', async () => {
    const host = await seededRoom();
    const before = totalObservers(host.ydoc);
    for (let call = 0; call < 3; call += 1) {
      expect(readCollaborationDocument(host.ydoc).byteLength).toBeGreaterThan(0);
    }
    // A server autosave calls this per store interval for the life of the room, so each call
    // must give back exactly what it registered.
    expect(totalObservers(host.ydoc)).toBe(before);
    host.destroy();
    host.ydoc.destroy();
  });

  test('a refusing readCollaborationDocument still cleans up', async () => {
    const ydoc = new Y.Doc();
    const before = totalObservers(ydoc);
    expect(() => readCollaborationDocument(ydoc)).toThrow(CollaborationSchemaError);
    expect(totalObservers(ydoc)).toBe(before);
    ydoc.destroy();
  });

  test('destroying the session detaches every schema observer', async () => {
    const host = await seededRoom();
    host.destroy();
    expect(totalObservers(host.ydoc)).toBe(0);
    host.ydoc.destroy();
  });

  test('a bootstrap that fails while materializing leaves no observers behind', async () => {
    const host = await seededRoom();
    host.destroy();
    // Delete a part-root node record so materialize refuses with `missing-root` and the
    // factory throws. (A malformed-but-present record no longer throws — the receive-path
    // hardening degrades it — so the failure has to come from an unmaterializable part.)
    const nodes = host.ydoc.getMap<Y.Map<unknown>>('docx-package-nodes-v1');
    const parts = host.ydoc.getMap<Y.Map<unknown>>('docx-package-parts-v1');
    let rootId: string | undefined;
    parts.forEach((entry) => {
      if (!rootId && entry instanceof Y.Map && typeof entry.get('rootId') === 'string') {
        rootId = entry.get('rootId') as string;
      }
    });
    expect(rootId).toBeTruthy();
    host.ydoc.transact(() => nodes.delete(rootId!));
    const before = totalObservers(host.ydoc);
    const awareness = new Awareness(host.ydoc);
    await expect(
      createDocumentCollaboration({
        ydoc: host.ydoc,
        awareness,
        documentId: 'teardown-room',
        identity: { actorId: 'late', name: 'Late' },
        bootstrap: { kind: 'join', timeoutMs: 1_000 },
      })
    ).rejects.toThrow();
    // The materializer registered its dirty observers before the throw; the factory must
    // hand them back, or every retry on this document leaks another set.
    expect(totalObservers(host.ydoc)).toBe(before);
    awareness.destroy();
    host.ydoc.destroy();
  });

  test('a refused bootstrap leaves no observers behind', async () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const before = totalObservers(ydoc);
    // A join on an empty room times out: the factory refuses, and the caller keeps `ydoc`.
    await expect(
      createDocumentCollaboration({
        ydoc,
        awareness,
        documentId: 'teardown-room',
        identity: { actorId: 'late', name: 'Late' },
        bootstrap: { kind: 'join', timeoutMs: 25 },
      })
    ).rejects.toThrow(CollaborationSchemaError);
    expect(totalObservers(ydoc)).toBe(before);
    awareness.destroy();
    ydoc.destroy();
  });
});
