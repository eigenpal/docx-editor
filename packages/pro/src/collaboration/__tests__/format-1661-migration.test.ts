/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// "Upgrade rooms to format 1.6.6.1": a format 1.5.5.1 room is refused unchanged, and a room
// seeded again from its export opens in the current format, with its paragraphs in order and
// its records under the short root names.
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { DOCUMENT_COLLABORATION_VERSIONS } from '../document-compatibility.ts';
import { readCollaborationDocument } from '../document-read.ts';
import {
  COLLABORATION_FORMAT_VERSION,
  readCollaborationFormatVersion,
} from '../document-format.ts';
import { CollaborationSchemaError } from '../errors.ts';
import { collaborationMigrationNeed, migrateCollaborationRoom } from '../room-migration.ts';
import { PACKAGE_META_KEY } from '../document/schema.ts';
import { nodeText, zipDocument } from './document-peer-support.ts';
import { collectKind, loadPackage } from './document-support.ts';

const PIECES = ['ab', 'cd', 'e', 'f', 'g', 'h', 'End'];
const BODY = PIECES.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');

/** The roots format 1.5.5.1 wrote its records to. */
const EARLIER_ROOTS = [
  'docx-package-nodes-v1',
  'docx-package-parts-v1',
  'docx-package-rels-v1',
  'docx-package-overrides-v1',
  'docx-package-defaults-v1',
  'docx-package-binaries-v1',
  'docx-package-namespaces-v1',
  'docx-package-attributes-v1',
  'docx-package-bindings-v1',
];

const EARLIER_VERSIONS = {
  ...DOCUMENT_COLLABORATION_VERSIONS,
  sharedSchemaVersion: 5,
  repairVersion: 5,
};

/** Roots whose names stay, because they hold few entries or every release reads them. */
const KEPT_ROOTS = new Set([
  PACKAGE_META_KEY,
  'docx-package-blobs-v1',
  'docx-collaboration-seeds-v1',
]);

/**
 * A room as format 1.5.5.1 saved it: the format fields of shared schema version 5 and repair
 * version 5, and records under the long root names. The upgrade reads only the format fields
 * and the export, so a record in each long root stands for the earlier records.
 */
async function formatRoom1551(): Promise<{ state: Uint8Array; exported: Uint8Array }> {
  const seed = new Y.Doc();
  const meta = seed.getMap(PACKAGE_META_KEY);
  meta.set('initialized', true);
  meta.set('documentId', 'split-room-1234567890abcdef');
  // Migration seeds only a room of an earlier format.
  for (const [field, value] of Object.entries(EARLIER_VERSIONS)) meta.set(field, value);
  const seeded = await migrateCollaborationRoom({
    state: Y.encodeStateAsUpdate(seed),
    exported: zipDocument(BODY),
  });
  if (!seeded.ok) throw new Error(seeded.reason);
  const current = new Y.Doc();
  Y.applyUpdate(current, seeded.state);
  const exported = readCollaborationDocument(current);

  const room = new Y.Doc();
  const earlierMeta = room.getMap(PACKAGE_META_KEY);
  for (const [key, value] of current.getMap(PACKAGE_META_KEY).entries())
    earlierMeta.set(key, value);
  for (const [field, value] of Object.entries(EARLIER_VERSIONS)) earlierMeta.set(field, value);
  for (const name of EARLIER_ROOTS) room.getMap(name).set('earlier-record', name);
  return { state: Y.encodeStateAsUpdate(room), exported };
}

const paragraphs = (docx: Uint8Array) => collectKind(loadPackage(docx), 'paragraph').map(nodeText);

describe('upgrade rooms to format 1.6.6.1', () => {
  test('the current format is 1.6.6.1', () => {
    expect(COLLABORATION_FORMAT_VERSION).toBe('docx-collaboration:1.6.6.1');
  });

  test('this build refuses a format 1.5.5.1 room before reading it, and leaves it unchanged', async () => {
    const { state } = await formatRoom1551();
    const before = Buffer.from(state).toString('hex');
    expect(collaborationMigrationNeed(state)).toBe('earlier-format');
    const room = new Y.Doc();
    Y.applyUpdate(room, state);
    expect(() => readCollaborationDocument(room)).toThrow(CollaborationSchemaError);
    expect(Buffer.from(state).toString('hex')).toBe(before);
  });

  test('a room seeded again from its export opens in the current format, in order', async () => {
    const earlier = await formatRoom1551();
    expect(paragraphs(earlier.exported)).toEqual(PIECES);
    const migrated = await migrateCollaborationRoom({
      state: earlier.state,
      exported: earlier.exported,
    });
    if (!migrated.ok) throw new Error(migrated.reason);
    expect(collaborationMigrationNeed(migrated.state)).toBe('current');
    const room = new Y.Doc();
    Y.applyUpdate(room, migrated.state);
    expect(readCollaborationFormatVersion(room)).toBe(COLLABORATION_FORMAT_VERSION);
    expect(paragraphs(readCollaborationDocument(room))).toEqual(PIECES);
    // The upgraded room starts again from the export: no record stays under a long name.
    for (const name of room.share.keys()) {
      if (KEPT_ROOTS.has(name)) continue;
      expect(EARLIER_ROOTS).not.toContain(name);
      expect(name.length).toBeLessThanOrEqual(5);
    }
  });
});
