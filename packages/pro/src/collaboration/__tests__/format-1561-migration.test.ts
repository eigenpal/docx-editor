/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// "Upgrade rooms to format 1.5.6.1": a format 1.5.5.1 room is refused unchanged, and a room
// seeded again from its export opens in the current format with its paragraphs in order.
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
import { nodeText, zipDocument } from './document-peer-support.ts';
import { collectKind, loadPackage } from './document-support.ts';

const PIECES = ['ab', 'cd', 'e', 'f', 'g', 'h', 'End'];
const BODY = PIECES.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');

/** A room as format 1.5.5.1 saved it: this build's records, under repair version 5. */
async function formatRoom1551(): Promise<{ state: Uint8Array; exported: Uint8Array }> {
  const empty = new Y.Doc();
  const meta = empty.getMap('docx-package-meta-v1');
  meta.set('initialized', true);
  meta.set('documentId', 'split-room-1234567890abcdef');
  for (const [field, value] of Object.entries(DOCUMENT_COLLABORATION_VERSIONS))
    meta.set(field, field === 'repairVersion' ? 5 : value);
  const seeded = await migrateCollaborationRoom({
    state: Y.encodeStateAsUpdate(empty),
    exported: zipDocument(BODY),
  });
  if (!seeded.ok) throw new Error(seeded.reason);
  const room = new Y.Doc();
  Y.applyUpdate(room, seeded.state);
  const exported = readCollaborationDocument(room);
  room.getMap('docx-package-meta-v1').set('repairVersion', 5);
  return { state: Y.encodeStateAsUpdate(room), exported };
}

const paragraphs = (docx: Uint8Array) => collectKind(loadPackage(docx), 'paragraph').map(nodeText);

describe('upgrade rooms to format 1.5.6.1', () => {
  test('the current format is 1.5.6.1', () => {
    expect(COLLABORATION_FORMAT_VERSION).toBe('docx-collaboration:1.5.6.1');
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
  });
});
