/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Compaction and migration seed a new room generation from the room's own content. Revision
// ids that one change shares across its pieces stay shared, so participants see the same
// review items after the new generation as before it. A file for anyone to open still gives
// each revision element its own id.
import { afterEach, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  readOoxmlPackage,
  revisionItemsOf,
  type OoxmlNode,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { DOCUMENT_COLLABORATION_VERSIONS } from '../document-compatibility.ts';
import { readCollaborationDocument } from '../document-read.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { compactCollaborationState } from '../room-generation.ts';
import { migrateCollaborationRoom } from '../room-migration.ts';
import { createPeerHarness, W, zipDocument } from './document-peer-support.ts';

const DOCUMENT_ID = 'revision-id-room';
const harness = createPeerHarness(DOCUMENT_ID);
const opened: { destroy(): void }[] = [];
afterEach(() => {
  for (const item of opened.splice(0)) item.destroy();
  harness.cleanup();
});

const REVISIONS = new Set([
  'ins',
  'del',
  'rPrChange',
  'moveFrom',
  'moveTo',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
]);

/** `localName:id` of every revision element in the main part. */
function revisionIds(pkg: OoxmlPackage): string[] {
  const found: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === W && REVISIONS.has(node.localName)) {
      const id = node.attributes.find((a) => a.namespaceUri === W && a.localName === 'id');
      found.push(`${node.localName}:${id?.value}`);
    }
    for (const child of node.children) visit(child);
  };
  visit(pkg.parts.get(pkg.mainDocumentPart)!.root);
  return found;
}

const reviewCount = (pkg: OoxmlPackage) =>
  revisionItemsOf(pkg.parts.get(pkg.mainDocumentPart)!).length;

function opening(bytes: Uint8Array): OoxmlPackage {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

/** One format change on two runs with plain text between them, under one id. */
const FORMATTED =
  '<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="1" w:author="Ada" w:date="2026-01-01T00:00:00Z">' +
  '<w:rPr/></w:rPrChange></w:rPr><w:t>first</w:t></w:r>' +
  '<w:r><w:t xml:space="preserve"> plain </w:t></w:r>' +
  '<w:r><w:rPr><w:b/><w:rPrChange w:id="1" w:author="Ada" w:date="2026-01-01T00:00:00Z">' +
  '<w:rPr/></w:rPrChange></w:rPr><w:t>second</w:t></w:r></w:p>';

test('compaction keeps the revision ids, and so the review items, of the room', async () => {
  const filler = Array.from(
    { length: 100 },
    (_, index) =>
      `<w:p><w:r><w:t>Paragraph ${index} with some text to keep it long</w:t></w:r></w:p>`
  ).join('');
  const { alice } = await harness.pair(zipDocument(`${FORMATTED}${filler}<w:sectPr/>`));
  for (let index = 100; index >= 1; index -= 1) {
    harness.apply(alice, [
      { op: 'deleteBlock', blockId: harness.paragraphIdAt(alice, index) } as never,
    ]);
  }
  const live = harness.packageOf(alice);
  expect(revisionIds(live)).toEqual(['rPrChange:1', 'rPrChange:1']);
  expect(reviewCount(live)).toBe(1);

  const compacted = await compactCollaborationState(Y.encodeStateAsUpdate(alice.ydoc));
  expect(compacted).not.toBeNull();
  // A participant who rejoins the new generation sees what they saw before it.
  const ydoc = new Y.Doc();
  opened.push(ydoc);
  Y.applyUpdate(ydoc, compacted!);
  const awareness = new Awareness(ydoc);
  opened.push(awareness);
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: DOCUMENT_ID,
    identity: { actorId: 'carol', name: 'carol' },
    bootstrap: { kind: 'join', timeoutMs: 5_000 },
  });
  opened.unshift(room);
  const rejoined = opening(room.document);
  expect(revisionIds(rejoined)).toEqual(['rPrChange:1', 'rPrChange:1']);
  expect(reviewCount(rejoined)).toBe(1);
  // The file a reader downloads from the room gives each element its own id.
  const downloaded = revisionIds(opening(readCollaborationDocument(ydoc)));
  expect(downloaded[0]).toBe('rPrChange:1');
  expect(downloaded[1]).toMatch(/^rPrChange:\d+$/);
  expect(downloaded[1]).not.toBe('rPrChange:1');
});

/** Room state of the schema version before this build's. */
function earlierRoom(): Uint8Array {
  const room = new Y.Doc();
  try {
    const meta = room.getMap('docx-package-meta-v1');
    meta.set('initialized', true);
    meta.set('documentId', DOCUMENT_ID);
    for (const [field, value] of Object.entries(DOCUMENT_COLLABORATION_VERSIONS)) {
      meta.set(field, value);
    }
    meta.set('sharedSchemaVersion', DOCUMENT_COLLABORATION_VERSIONS.sharedSchemaVersion - 1);
    return Y.encodeStateAsUpdate(room);
  } finally {
    room.destroy();
  }
}

test('a migration export that keeps revision ids gives the new room the same review items', async () => {
  const { alice } = await harness.pair(zipDocument(`${FORMATTED}<w:sectPr/>`));
  expect(reviewCount(harness.packageOf(alice))).toBe(1);
  const earlier = new Y.Doc();
  opened.push(earlier);
  Y.applyUpdate(earlier, Y.encodeStateAsUpdate(alice.ydoc));
  // The default export renumbers the shared id, so a room seeded from it would split the item.
  expect(revisionIds(opening(readCollaborationDocument(earlier)))[1]).not.toBe('rPrChange:1');
  const exported = readCollaborationDocument(earlier, { keepRevisionIds: true });
  expect(revisionIds(opening(exported))).toEqual(['rPrChange:1', 'rPrChange:1']);
  const migrated = await migrateCollaborationRoom({ state: earlierRoom(), exported });
  if (!migrated.ok) throw new Error(JSON.stringify(migrated));
  const room = new Y.Doc();
  opened.push(room);
  Y.applyUpdate(room, migrated.state);
  const kept = opening(readCollaborationDocument(room, { keepRevisionIds: true }));
  expect(revisionIds(kept)).toEqual(['rPrChange:1', 'rPrChange:1']);
  expect(reviewCount(kept)).toBe(1);
});

test('migration passes its check when two move range pairs share an id', async () => {
  const pair = (kind: 'moveFrom' | 'moveTo', text: string) =>
    `<w:p><w:${kind}RangeStart w:id="5" w:author="Ada" w:name="move1"/>` +
    `<w:${kind} w:id="${kind === 'moveFrom' ? 6 : 7}" w:author="Ada">` +
    `<w:r><w:${kind === 'moveFrom' ? 'delText' : 't'}>${text}</w:${kind === 'moveFrom' ? 'delText' : 't'}></w:r>` +
    `</w:${kind}><w:${kind}RangeEnd w:id="5"/></w:p>`;
  const exported = zipDocument(
    pair('moveFrom', 'one') +
      pair('moveFrom', 'two') +
      pair('moveTo', 'one') +
      pair('moveTo', 'two') +
      '<w:sectPr/>'
  );
  const migrated = await migrateCollaborationRoom({ state: earlierRoom(), exported });
  if (!migrated.ok) throw new Error(JSON.stringify(migrated));
  expect(migrated.report.ok).toBe(true);
  const room = new Y.Doc();
  try {
    Y.applyUpdate(room, migrated.state);
    // The new room holds the ids the export held.
    const reread = opening(readCollaborationDocument(room));
    expect(revisionIds(reread).filter((entry) => entry.endsWith(':5'))).toHaveLength(2);
  } finally {
    room.destroy();
  }
});
