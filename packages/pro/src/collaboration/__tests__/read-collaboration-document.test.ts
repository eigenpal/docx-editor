/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `readCollaborationDocument`: the server side of a room.
//
// A job that exports, autosaves, indexes or renders a room's document must not have to join
// it. These cases pin the two halves of that promise — that the bytes are the room's, and
// that reading them creates no identity, no presence and no editing gate.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import { createDocumentCollaboration, readCollaborationDocument } from '../document-session.ts';
import { CollaborationSchemaError } from '../schema.ts';
import { SEED_RECORDS_KEY } from '../document-bootstrap.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const DOCUMENT_ID = 'read-document-room-id';

function docx(text: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

/** The text of every run in the body, which is all these cases need to compare. */
function bodyText(bytes: Uint8Array): string {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error(`unreadable package: ${read.reason}`);
  const part = read.package.parts.get(read.package.mainDocumentPart);
  if (!part) throw new Error('no main document part');
  const seen: string[] = [];
  const walk = (node: { kind: string; value?: string; children?: readonly unknown[] }): void => {
    if (node.kind === 'textValue' && typeof node.value === 'string') seen.push(node.value);
    for (const child of node.children ?? []) walk(child as never);
  };
  walk(part.root as never);
  return seen.join('');
}

async function seededRoom(text: string): Promise<{ ydoc: Y.Doc; destroy: () => void }> {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: DOCUMENT_ID,
    identity: { actorId: 'seed', name: 'Seed' },
    bootstrap: { kind: 'create', document: docx(text) },
  });
  return {
    ydoc,
    destroy: () => {
      room.destroy();
      awareness.destroy();
    },
  };
}

describe('readCollaborationDocument', () => {
  test('returns the room document from a replica that never joined', async () => {
    const host = await seededRoom('shared text');

    // The server side: a bare `Y.Doc` holding the room's state, with no awareness, no
    // identity and no session — exactly what a Hocuspocus `onStoreDocument` hook receives.
    const observer = new Y.Doc();
    Y.applyUpdate(observer, Y.encodeStateAsUpdate(host.ydoc));

    // Reading must not WRITE. An export job runs against a live room, and a state vector
    // that moved would broadcast to every peer — which is how a reader ends up in the room.
    const before = Y.encodeStateVector(observer);

    const bytes = readCollaborationDocument(observer);
    expect(bodyText(bytes)).toBe('shared text');
    expect(Y.encodeStateVector(observer)).toEqual(before);

    host.destroy();
    observer.destroy();
  });

  test('a document nobody seeded refuses instead of returning a truncated file', () => {
    const empty = new Y.Doc();
    expect(() => readCollaborationDocument(empty)).toThrow(CollaborationSchemaError);
    try {
      readCollaborationDocument(empty);
    } catch (error) {
      expect((error as CollaborationSchemaError).code).toBe('not-initialized');
    }
    empty.destroy();
  });

  test('two merged seeds refuse rather than exporting the document twice', async () => {
    const host = await seededRoom('one');
    const merged = new Y.Doc();
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(host.ydoc));
    // What two creators leave behind: two seed records in one room. `create-or-join` appends
    // one per seeding client, and neither side can be picked, so an export refuses rather
    // than writing a file with the whole document in it twice.
    merged.getArray(SEED_RECORDS_KEY).push(['seed-a', 'seed-b']);
    try {
      readCollaborationDocument(merged);
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as CollaborationSchemaError).code).toBe('concurrent-seed');
    }
    host.destroy();
    merged.destroy();
  });
});
