import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  DOCUMENT_COLLABORATION_VERSIONS,
  readCollaborationDocument,
} from '@docx-editor.dev/pro/collaboration';
import { zipDocument } from '../../../packages/pro/src/collaboration/__tests__/document-peer-support.ts';
import { isCurrentFormat, migrateRoom, paragraphTexts } from './room-migration.ts';

// An export of a room that concurrent property edits left with two `w:pPr` in one paragraph.
const EXPORT = zipDocument(
  '<w:p><w:r><w:t>Before</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:pPr><w:jc w:val="right"/></w:pPr>' +
    '<w:r><w:t>Doubled</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>After</w:t></w:r></w:p><w:sectPr/>'
);

test('a migrated room holds every paragraph of its export, and the editor shows them', async () => {
  const migrated = await migrateRoom(EXPORT, 'migrated-room-1234567890abcd');
  expect(migrated.paragraphs).toBe(3);
  expect(migrated.hidden).toBe(0);
  expect(isCurrentFormat(migrated.state)).toBe(true);
  const room = new Y.Doc();
  try {
    Y.applyUpdate(room, migrated.state);
    expect(paragraphTexts(readCollaborationDocument(room))).toEqual([
      { text: 'Before', shown: true },
      { text: 'Doubled', shown: true },
      { text: 'After', shown: true },
    ]);
  } finally {
    room.destroy();
  }
});

test('room state of an earlier format is not current', () => {
  const earlier = new Y.Doc();
  try {
    const meta = earlier.getMap('docx-package-meta-v1');
    meta.set('initialized', true);
    meta.set('documentId', 'earlier-room-1234567890abcdef');
    for (const [field, value] of Object.entries(DOCUMENT_COLLABORATION_VERSIONS)) {
      meta.set(field, value);
    }
    meta.set('sharedSchemaVersion', DOCUMENT_COLLABORATION_VERSIONS.sharedSchemaVersion - 1);
    expect(isCurrentFormat(Y.encodeStateAsUpdate(earlier))).toBe(false);
  } finally {
    earlier.destroy();
  }
});
