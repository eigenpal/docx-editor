/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Typing at one place is written straight to its paragraph's shared text. Two replicas that
// start from the same state and the same client make the same edits, one with the shortcut
// and one without: their shared state must be identical after every edit, or the shortcut
// writes something the general path would not.
import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  normalizeParagraphIdentity,
  paragraphTextOf,
  readOoxmlPackage,
  TreePackageStore,
  type OoxmlNode,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration/replication';
import { createDocumentCollaboration } from '../document-session.ts';
import { setTypedInsertShortcut, typedInsertsWritten } from '../document/paragraph-text-typing.ts';
import { BODY, zipDocument } from './document-peer-support.ts';

afterEach(() => setTypedInsertShortcut(true));

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Paragraphs of several runs and text elements, with letters that repeat at run borders. */
function document(): Uint8Array {
  const paragraph = (index: number): string =>
    `<w:p><w:r><w:t xml:space="preserve">aab ${index} </w:t></w:r>` +
    `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">bba aa</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve"> ab</w:t></w:r></w:p>`;
  return zipDocument(Array.from({ length: 6 }, (_, index) => paragraph(index)).join(''));
}

interface Replica {
  readonly ydoc: Y.Doc;
  readonly store: TreePackageStore;
  readonly flush: () => void;
  readonly destroy: () => void;
}

async function replica(ydoc: Y.Doc, bootstrap: unknown): Promise<Replica> {
  const awareness = new Awareness(ydoc);
  // Both twins mint the same logical IDs: the same random bytes while each is created.
  const random = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  globalThis.crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
    if (array) new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(7);
    return array;
  }) as typeof globalThis.crypto.getRandomValues;
  let room: Awaited<ReturnType<typeof createDocumentCollaboration>>;
  try {
    room = await createDocumentCollaboration({
      ydoc,
      awareness,
      documentId: 'typing-shortcut',
      identity: { actorId: 'alice', name: 'Alice' },
      bootstrap: bootstrap as never,
    });
  } finally {
    globalThis.crypto.getRandomValues = random;
  }
  const loaded = readOoxmlPackage(room.document);
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  const port = createCollaborationDocumentPort(store, { documentId: 'typing-shortcut' });
  const detach = room.session.attach(port);
  return {
    ydoc,
    store,
    flush: () => port.flushPendingJournals(),
    destroy: () => {
      detach();
      room.destroy();
      awareness.destroy();
    },
  };
}

function paragraphIds(store: TreePackageStore): string[] {
  const ids: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'paragraph') ids.push(node.id);
    if (node.kind === 'textValue') return;
    for (const child of node.children) visit(child);
  };
  visit(store.bodyStore().part.root);
  return ids;
}

/** One random edit of a store, or null when the pick does not apply. */
function randomEdit(
  store: TreePackageStore,
  next: () => number,
  letters: string
): TreeDocOp | null {
  const ids = paragraphIds(store);
  const paragraphId = ids[Math.floor(next() * ids.length)]!;
  const length = paragraphTextOf(store.bodyStore().part, paragraphId)?.length ?? 0;
  const offset = Math.floor(next() * (length + 1));
  const roll = next();
  if (roll < 0.7) {
    const count = 1 + Math.floor(next() * 3);
    const text = Array.from(
      { length: count },
      () => letters[Math.floor(next() * letters.length)]
    ).join('');
    return { op: 'insertText', paragraphId, offset, text };
  }
  if (roll < 0.8 && length > 0) {
    const end = Math.min(length, offset + 1 + Math.floor(next() * 3));
    return { op: 'deleteText', paragraphId, start: Math.min(offset, end - 1), end };
  }
  if (roll < 0.88) return { op: 'splitParagraph', paragraphId, offset };
  const at = ids.indexOf(paragraphId);
  if (roll < 0.95 && at + 1 < ids.length) {
    return { op: 'joinParagraphs', firstId: paragraphId, secondId: ids[at + 1]! };
  }
  if (length === 0) return null;
  const end = Math.min(length, offset + 2);
  return {
    op: 'setRunProperties',
    paragraphId,
    start: Math.min(offset, end - 1),
    end,
    properties: [{ localName: 'i' }],
  } as TreeDocOp;
}

function apply(target: Replica, op: TreeDocOp): boolean {
  const result = target.store.transact(BODY, (context) => context.apply(op));
  target.flush();
  return result.ok;
}

describe('typing written straight to shared text', () => {
  for (const seed of [1168, 7, 31]) {
    test(`writes the same shared state as the general path, with a concurrent peer (seed ${seed})`, async () => {
      const creator = new Y.Doc();
      creator.clientID = 4242;
      const shortcut = await replica(creator, { kind: 'create', document: document() });
      // The twin starts from the same state and writes as the same client.
      const twinDoc = new Y.Doc();
      Y.applyUpdate(twinDoc, Y.encodeStateAsUpdate(creator));
      // Yjs takes a new client when an update holds its own; the twin must write as the creator.
      twinDoc.clientID = 4242;
      const general = await replica(twinDoc, { kind: 'join', timeoutMs: 1_000 });
      // A peer that edits concurrently: its updates reach both twins as the same bytes.
      const peerDoc = new Y.Doc();
      peerDoc.clientID = 777;
      Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(creator));
      peerDoc.clientID = 777;
      const peer = await replica(peerDoc, { kind: 'join', timeoutMs: 1_000 });
      expect(Y.encodeStateAsUpdate(twinDoc)).toEqual(Y.encodeStateAsUpdate(creator));

      const next = random(seed);
      const writtenBefore = typedInsertsWritten();
      let typed = 0;
      for (let step = 0; step < 300; step += 1) {
        if (next() < 0.2) {
          // The peer catches up with the twins, edits, and its edit reaches both twins.
          Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(creator, Y.encodeStateVector(peerDoc)));
          const before = Y.encodeStateVector(peerDoc);
          const op = randomEdit(peer.store, next, 'ab X');
          if (op) apply(peer, op);
          const update = Y.encodeStateAsUpdate(peerDoc, before);
          Y.applyUpdate(creator, update, 'peer');
          Y.applyUpdate(twinDoc, update, 'peer');
          continue;
        }
        const op = randomEdit(shortcut.store, next, 'ab X');
        if (!op) continue;
        if (op.op === 'insertText') typed += 1;
        setTypedInsertShortcut(true);
        const left = apply(shortcut, op);
        setTypedInsertShortcut(false);
        const right = apply(general, op);
        setTypedInsertShortcut(true);
        expect(left).toBe(right);
        const a = Y.encodeStateAsUpdate(creator);
        const b = Y.encodeStateAsUpdate(twinDoc);
        if (!Buffer.from(a).equals(Buffer.from(b))) {
          throw new Error(
            `seed ${seed} step ${step}: shared state differs after ${JSON.stringify(op)}`
          );
        }
      }
      const shortcuts = typedInsertsWritten() - writtenBefore;
      console.log(`seed ${seed}: ${shortcuts} of ${typed} typing edits took the shortcut`);
      // Most typing takes the shortcut; the rest goes to the general path by its rules.
      expect(shortcuts).toBeGreaterThan(typed / 3);
      for (const target of [shortcut, general, peer]) target.destroy();
    });
  }
});
