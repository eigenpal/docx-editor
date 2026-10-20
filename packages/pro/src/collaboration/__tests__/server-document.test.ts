/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A server that holds a room's document receives every update as a remote one. Yjs then
// removes formatting markers it finds redundant, and that removal is a change of the server's
// own, which the server sends to every participant. A prepared document writes nothing.
//
// A server can also seed a new room itself, so no participant uploads the document and none
// receives it back.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strFromU8, unzipSync } from 'fflate';
import {
  CollaborationSchemaError,
  createCollaborationState,
  createDocumentCollaboration,
  prepareCollaborationServerDocument,
  readCollaborationRoomGeneration,
} from '../index.ts';
import { SEED_RECORDS_KEY } from '../document-bootstrap.ts';
import { collaborationDocx } from './support.ts';
import { zipDocument } from './document-peer-support.ts';
import { deleteContent, keepFormattingMarkers } from '../document/yjs-items.ts';

const REMOTE = Symbol('remote');

/** The updates the server document writes itself while two participants edit one text. */
function serverWrites(prepare: boolean): number {
  const left = new Y.Doc();
  const right = new Y.Doc();
  const server = new Y.Doc();
  for (const doc of [left, right]) keepFormattingMarkers(doc);
  if (prepare) prepareCollaborationServerDocument(server);
  // Paragraph text lives in a record map, so the server decodes it as a text with formatting.
  const text = new Y.Text();
  left.getMap('nodes').set('p', text);
  text.insert(0, 'abcd', { t: 'one' });
  text.insert(4, 'efgh', { t: 'two' });
  Y.applyUpdate(server, Y.encodeStateAsUpdate(left), REMOTE);
  Y.applyUpdate(right, Y.encodeStateAsUpdate(server), REMOTE);
  let own = 0;
  server.on('update', (_update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) own += 1;
  });
  deleteContent(left.getMap('nodes').get('p') as Y.Text, 0, 4);
  const rightText = right.getMap('nodes').get('p') as Y.Text;
  rightText.insert(2, 'XY', { t: 'one' });
  rightText.format(0, 6, { t: 'two' });
  Y.applyUpdate(server, Y.encodeStateAsUpdate(left), REMOTE);
  Y.applyUpdate(server, Y.encodeStateAsUpdate(right), REMOTE);
  return own;
}

describe('prepareCollaborationServerDocument', () => {
  test('a prepared server document writes no change of its own', () => {
    expect(serverWrites(true)).toBe(0);
  });

  test('an unprepared one does, which is why servers prepare it', () => {
    expect(serverWrites(false)).toBeGreaterThan(0);
  });
});

describe('createCollaborationState', () => {
  async function joinState(state: Uint8Array, documentId: string) {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, state);
    const awareness = new Awareness(ydoc);
    try {
      const room = await createDocumentCollaboration({
        ydoc,
        awareness,
        documentId,
        identity: { actorId: 'joiner', name: 'Joiner' },
        bootstrap: {
          kind: 'create-or-join',
          document: collaborationDocx('Ignored'),
          probeTimeoutMs: 0,
        },
      });
      return { room, ydoc, awareness };
    } catch (error) {
      awareness.destroy();
      ydoc.destroy();
      throw error;
    }
  }

  test('a participant joins the server-seeded room without seeding it again', async () => {
    const state = await createCollaborationState(collaborationDocx('Seeded by the server'), {
      documentId: 'server-room',
    });
    const { room, ydoc, awareness } = await joinState(state, 'server-room');
    try {
      const xml = strFromU8(unzipSync(room.document)['word/document.xml']!);
      expect(xml).toContain('Seeded by the server');
      expect(xml).not.toContain('Ignored');
      // Joining wrote nothing: the room still records the one server seed.
      expect(Y.encodeStateVector(ydoc)).toEqual(Y.encodeStateVector(stateDoc(state)));
      expect(ydoc.getArray(SEED_RECORDS_KEY).length).toBe(1);
      expect(readCollaborationRoomGeneration(ydoc)).not.toBe('');
    } finally {
      room.destroy();
      awareness.destroy();
      ydoc.destroy();
    }
  });

  test('each seed is a new generation, so a lost room is never merged twice', async () => {
    const bytes = collaborationDocx();
    const first = stateDoc(await createCollaborationState(bytes, { documentId: 'room' }));
    const second = stateDoc(await createCollaborationState(bytes, { documentId: 'room' }));
    expect(readCollaborationRoomGeneration(first)).not.toBe(
      readCollaborationRoomGeneration(second)
    );
  });

  test('a participant of another document is refused', async () => {
    const state = await createCollaborationState(collaborationDocx(), { documentId: 'room-a' });
    await expect(joinState(state, 'room-b')).rejects.toMatchObject({
      code: 'document-id-mismatch',
    });
  });

  test('refuses bytes that are not a document, and an empty document ID', async () => {
    await expect(
      createCollaborationState(new Uint8Array([1, 2, 3]), { documentId: 'room' })
    ).rejects.toBeInstanceOf(CollaborationSchemaError);
    await expect(
      createCollaborationState(collaborationDocx(), { documentId: '  ' })
    ).rejects.toMatchObject({ code: 'invalid-document-id' });
    await expect(
      createCollaborationState(collaborationDocx(), { documentId: 'r'.repeat(257) })
    ).rejects.toMatchObject({ code: 'invalid-document-id' });
  });

  test('refuses a document over maxBytes before it builds the room', async () => {
    const bytes = collaborationDocx();
    await expect(
      createCollaborationState(bytes, { documentId: 'room', maxBytes: bytes.byteLength - 1 })
    ).rejects.toMatchObject({ code: 'baseline-too-large' });
    // A small file whose parts expand past the bound is refused the same way.
    const expanded = Object.values(unzipSync(bytes)).reduce((sum, part) => sum + part.length, 0);
    await expect(
      createCollaborationState(bytes, { documentId: 'room', maxBytes: expanded - 1 })
    ).rejects.toMatchObject({ code: 'baseline-too-large' });
    await expect(
      createCollaborationState(bytes, { documentId: 'room', maxBytes: expanded })
    ).resolves.toBeInstanceOf(Uint8Array);
    for (const maxBytes of [0, -1, 1.5, 21 * 1024 * 1024]) {
      await expect(
        createCollaborationState(bytes, { documentId: 'room', maxBytes })
      ).rejects.toBeInstanceOf(TypeError);
    }
  });
});

function stateDoc(state: Uint8Array): Y.Doc {
  const document = new Y.Doc();
  Y.applyUpdate(document, state);
  return document;
}

describe('a participant seed over the size limit', () => {
  // A small file whose parts expand past 20 MiB. The zip reader refuses it by its expanded
  // size before it inflates anything, and the seed reports that size, not a broken file.
  const oversized = zipDocument('<w:p/><w:sectPr/>', {
    extraXml: { 'word/padding.xml': `<a>${'x'.repeat(21 * 1024 * 1024)}</a>` },
  });

  for (const kind of ['create', 'create-or-join'] as const) {
    test(`a ${kind} bootstrap reports baseline-too-large`, async () => {
      expect(oversized.byteLength).toBeLessThan(1024 * 1024);
      const ydoc = new Y.Doc();
      const awareness = new Awareness(ydoc);
      try {
        await expect(
          createDocumentCollaboration({
            ydoc,
            awareness,
            documentId: 'oversized-room',
            identity: { actorId: 'creator', name: 'Creator' },
            bootstrap:
              kind === 'create'
                ? { kind, document: oversized }
                : { kind, document: oversized, probeTimeoutMs: 0, electionWindowMs: 0 },
          })
        ).rejects.toMatchObject({ code: 'baseline-too-large' });
      } finally {
        awareness.destroy();
        ydoc.destroy();
      }
    });
  }
});
