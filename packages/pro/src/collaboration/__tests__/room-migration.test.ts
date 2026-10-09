/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A saved room of an earlier format moves to this build's format through an export: the new
// room is seeded from it and checked against it before anything replaces the earlier room.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Y from 'yjs';
import { DOCUMENT_COLLABORATION_VERSIONS } from '../document-compatibility.ts';
import { readCollaborationDocument } from '../document-read.ts';
import {
  COLLABORATION_FORMAT_VERSION,
  readCollaborationFormatVersion,
} from '../document-format.ts';
import { readCollaborationRoomGeneration } from '../room-generation.ts';
import {
  collaborationMigrationNeed,
  compareMigrationContents,
  compareMigrationParagraphs,
  migrateCollaborationRoom,
} from '../room-migration.ts';
import { zipDocument } from './document-peer-support.ts';

/** Room state whose version fields are this build's, with one field changed. */
function roomOfFormat(change: Partial<Record<string, number | undefined>>): Uint8Array {
  const room = new Y.Doc();
  try {
    const meta = room.getMap('docx-package-meta-v1');
    meta.set('initialized', true);
    meta.set('documentId', 'formatted-room-1234567890abcd');
    for (const [field, value] of Object.entries({
      ...DOCUMENT_COLLABORATION_VERSIONS,
      ...change,
    })) {
      if (value !== undefined) meta.set(field, value);
    }
    return Y.encodeStateAsUpdate(room);
  } finally {
    room.destroy();
  }
}

describe('migrating a saved room', () => {
  test('an export with a paragraph that holds two w:pPr migrates whole and shown', async () => {
    const exported = zipDocument(
      '<w:p><w:r><w:t>Before</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:pPr><w:jc w:val="right"/></w:pPr>' +
        '<w:r><w:t>Doubled</w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>In a cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        '<w:p><w:r><w:t>After</w:t></w:r></w:p><w:sectPr/>'
    );
    const migrated = await migrateCollaborationRoom(exported, {
      documentId: 'migrated-room-1234567890abcd',
    });
    if (!migrated.ok) throw new Error(JSON.stringify(migrated.report));
    expect(migrated.report).toEqual({
      ok: true,
      paragraphs: 4,
      hidden: 0,
      differences: [],
      missingMedia: [],
      missingLinks: [],
    });
    expect(collaborationMigrationNeed(migrated.state)).toBe('current');
    const room = new Y.Doc();
    try {
      Y.applyUpdate(room, migrated.state);
      expect(readCollaborationFormatVersion(room)).toBe(COLLABORATION_FORMAT_VERSION);
      // A new generation: a replica of the earlier room is refused and rejoins.
      expect(readCollaborationRoomGeneration(room)).not.toBe('');
      expect(readCollaborationDocument(room).byteLength).toBeGreaterThan(0);
    } finally {
      room.destroy();
    }
  });

  for (const fixture of [
    'images-wrap-sides.docx',
    'hyperlink-demo.docx',
    'block-sdt-showcase.docx',
  ]) {
    test(`${fixture} migrates with every paragraph, media part, and link target`, async () => {
      const exported = new Uint8Array(
        readFileSync(resolve(import.meta.dir, '../../../../../e2e/fixtures', fixture))
      );
      const migrated = await migrateCollaborationRoom(exported, {
        documentId: 'fixture-room-1234567890abcdefg',
      });
      expect(migrated.report.missingMedia).toEqual([]);
      expect(migrated.report.missingLinks).toEqual([]);
      expect(migrated.report.differences).toEqual([]);
      expect(migrated.ok).toBe(true);
    });
  }

  test('a paragraph the editor cannot show is kept and counted', async () => {
    // A table inside a paragraph is not a paragraph shape the editor shows.
    const exported = zipDocument(
      '<w:p><w:r><w:t>Shown</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Odd</w:t></w:r><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl></w:p>' +
        '<w:sectPr/>'
    );
    const migrated = await migrateCollaborationRoom(exported, {
      documentId: 'hidden-room-1234567890abcdef',
    });
    expect(migrated.ok).toBe(true);
    expect(migrated.report.hidden).toBeGreaterThan(0);
  });

  test('a new room that lost or changed text fails the check', () => {
    const shown = (text: string) => ({ text, shown: true });
    expect(
      compareMigrationParagraphs([shown('One'), shown('Two')], [shown('One'), shown('Two')])
    ).toEqual({
      ok: true,
      paragraphs: 2,
      hidden: 0,
      differences: [],
      missingMedia: [],
      missingLinks: [],
    });
    expect(compareMigrationParagraphs([shown('One'), shown('Two')], [shown('One')])).toEqual({
      ok: false,
      paragraphs: 2,
      hidden: 0,
      differences: [{ paragraph: 2, expected: 'Two', actual: null }],
      missingMedia: [],
      missingLinks: [],
    });
    expect(compareMigrationParagraphs([shown('One')], [shown('Ones')]).ok).toBe(false);
  });

  test('a new room that lost a media part or a link target fails the check', () => {
    const paragraphs = [{ text: 'Text', shown: true }];
    const before = {
      paragraphs,
      media: new Map([
        ['digest-of-logo', '/word/media/logo.png'],
        ['digest-of-chart', '/word/media/chart.emf'],
      ]),
      links: ['hyperlink https://example.com/a', 'hyperlink https://example.com/a'],
    };
    const report = compareMigrationContents(before, {
      paragraphs,
      media: new Map([['digest-of-logo', '/word/media/image1.png']]),
      links: ['hyperlink https://example.com/a'],
    });
    expect(report.ok).toBe(false);
    // A renamed part with the same bytes is no loss; a part whose bytes are gone is.
    expect(report.missingMedia).toEqual(['/word/media/chart.emf']);
    // One of two links to the same target is gone.
    expect(report.missingLinks).toEqual(['hyperlink https://example.com/a']);
    expect(compareMigrationContents(before, before).ok).toBe(true);
  });

  test('saved state reports whether it needs a migration', () => {
    const schema = DOCUMENT_COLLABORATION_VERSIONS.sharedSchemaVersion;
    expect(collaborationMigrationNeed(roomOfFormat({}))).toBe('current');
    expect(collaborationMigrationNeed(roomOfFormat({ sharedSchemaVersion: schema - 1 }))).toBe(
      'earlier-format'
    );
    expect(collaborationMigrationNeed(roomOfFormat({ sharedSchemaVersion: schema + 1 }))).toBe(
      'later-format'
    );
    // A room from before formats were versioned has no version fields.
    expect(collaborationMigrationNeed(roomOfFormat({ sharedSchemaVersion: undefined }))).toBe(
      'earlier-format'
    );
    expect(() => collaborationMigrationNeed(Y.encodeStateAsUpdate(new Y.Doc()))).toThrow(
      'not-initialized'
    );
  });
});
