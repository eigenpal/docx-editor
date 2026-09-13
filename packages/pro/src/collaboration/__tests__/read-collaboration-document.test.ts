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
import { DOCUMENT_COLLABORATION_VERSIONS } from '../document-compatibility.ts';
import { SEED_RECORDS_KEY } from '../document-bootstrap.ts';
import {
  NODE_CHILDREN_FIELD,
  PACKAGE_META_KEY,
  PACKAGE_NODES_KEY,
  readNodeShell,
} from '../document/schema.ts';
import { createPeerHarness } from './document-peer-support.ts';

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
  for (const [field, version, code] of [
    ['sharedSchemaVersion', 2, 'schema-version-mismatch'],
    ['sharedSchemaVersion', 4, 'schema-version-mismatch'],
    ['protocolVersion', 0, 'protocol-version-mismatch'],
    ['repairVersion', 2, 'schema-version-mismatch'],
    ['canonicalModelVersion', 2, 'schema-version-mismatch'],
  ] as const) {
    test(`refuses ${field} ${version} before interpreting persisted split metadata`, async () => {
      const host = await seededRoom('shared text');
      const observer = new Y.Doc();
      try {
        Y.applyUpdate(observer, Y.encodeStateAsUpdate(host.ydoc));
        observer.getMap(PACKAGE_META_KEY).set(field, version);
        // Incompatible schemas may encode this field differently. The version refusal
        // must happen before a v3 parser tries to interpret those persisted records.
        const record = new Y.Map<unknown>();
        record.set('splitTextSource', 'legacy encoding');
        observer.getMap(PACKAGE_NODES_KEY).set('legacy-node', record);
        const before = Y.encodeStateVector(observer);
        try {
          readCollaborationDocument(observer);
          throw new Error('export unexpectedly accepted an incompatible schema');
        } catch (error) {
          expect(error).toBeInstanceOf(CollaborationSchemaError);
          expect((error as CollaborationSchemaError).code).toBe(code);
          expect((error as CollaborationSchemaError).detail).toContain(`${field}: expected `);
          expect((error as CollaborationSchemaError).detail).toContain(`received ${version}`);
        }
        expect(Y.encodeStateVector(observer)).toEqual(before);
      } finally {
        host.destroy();
        observer.destroy();
      }
    });
  }

  for (const initialized of [false, undefined]) {
    test(`refuses an incomplete persisted seed with initialized=${String(initialized)}`, async () => {
      const host = await seededRoom('shared text');
      const observer = new Y.Doc();
      try {
        Y.applyUpdate(observer, Y.encodeStateAsUpdate(host.ydoc));
        const meta = observer.getMap(PACKAGE_META_KEY);
        if (initialized === undefined) meta.delete('initialized');
        else meta.set('initialized', initialized);
        const before = Y.encodeStateVector(observer);
        expect(() => readCollaborationDocument(observer)).toThrow('not-initialized');
        expect(Y.encodeStateVector(observer)).toEqual(before);
      } finally {
        host.destroy();
        observer.destroy();
      }
    });
  }

  for (const corruption of ['missing-child', 'missing-run'] as const) {
    test(`refuses export when repair would drop ${corruption} content`, async () => {
      const host = await seededRoom('must survive');
      const observer = new Y.Doc();
      try {
        Y.applyUpdate(observer, Y.encodeStateAsUpdate(host.ydoc));
        const nodes = observer.getMap<Y.Map<unknown>>(PACKAGE_NODES_KEY);
        if (corruption === 'missing-run') {
          const entry = [...nodes].find(([, record]) => readNodeShell(record).kind === 'run');
          expect(entry).toBeDefined();
          nodes.delete(entry![0]);
        } else {
          const paragraph = [...nodes.values()].find(
            (record) => readNodeShell(record).kind === 'paragraph'
          );
          expect(paragraph).toBeDefined();
          (paragraph!.get(NODE_CHILDREN_FIELD) as Y.Array<string>).insert(0, ['missing-record']);
        }
        const before = Y.encodeStateVector(observer);
        try {
          readCollaborationDocument(observer);
          throw new Error('export unexpectedly accepted dropped content');
        } catch (error) {
          expect(error).toBeInstanceOf(CollaborationSchemaError);
          expect((error as CollaborationSchemaError).code).toBe('materialize-dropped-content');
          expect((error as CollaborationSchemaError).detail).toContain('child-id-not-in-registry');
        }
        expect(Y.encodeStateVector(observer)).toEqual(before);
      } finally {
        host.destroy();
        observer.destroy();
      }
    });
  }

  test('compatible metadata without document parts cannot export an empty archive', () => {
    const observer = new Y.Doc();
    try {
      const meta = observer.getMap(PACKAGE_META_KEY);
      meta.set('initialized', true);
      meta.set('documentId', DOCUMENT_ID);
      for (const [field, value] of Object.entries(DOCUMENT_COLLABORATION_VERSIONS))
        meta.set(field, value);
      const before = Y.encodeStateVector(observer);
      expect(() => readCollaborationDocument(observer)).toThrow('no-main-document-part');
      expect(Y.encodeStateVector(observer)).toEqual(before);
    } finally {
      observer.destroy();
    }
  });

  test('legitimate full deletion and undo remain exportable', async () => {
    const harness = createPeerHarness('read-healthy-deletion');
    try {
      const { alice, bob } = await harness.pair(docx('hello'));
      harness.apply(alice, [
        { op: 'deleteText', paragraphId: harness.paragraphIdAt(alice, 0), start: 0, end: 5 },
      ]);
      for (const peer of [alice, bob])
        expect(bodyText(readCollaborationDocument(peer.ydoc))).toBe('');
      expect(alice.room.session.undo()).toBe(true);
      for (const peer of [alice, bob])
        expect(bodyText(readCollaborationDocument(peer.ydoc))).toBe('hello');
    } finally {
      harness.cleanup();
    }
  });

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
