/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A saved room of an earlier format moves to this build's format through an export: the new
// room is seeded from it and checked against it before anything replaces the earlier room.
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
  migrateCollaborationRoom,
  migrationContentsOf,
  type MigrationContents,
  type MigrationParagraph,
} from '../room-migration.ts';
import { zipDocument } from './document-peer-support.ts';

const EARLIER_ID = 'earlier-room-1234567890abcdef';
const SCHEMA = DOCUMENT_COLLABORATION_VERSIONS.sharedSchemaVersion;

/** Room state whose version fields are this build's, with the given fields changed. */
function roomOfFormat(
  change: Partial<Record<string, number | undefined>>,
  documentId: string | null = EARLIER_ID
): Uint8Array {
  const room = new Y.Doc();
  try {
    const meta = room.getMap('docx-package-meta-v1');
    meta.set('initialized', true);
    if (documentId !== null) meta.set('documentId', documentId);
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

const earlierRoom = () => roomOfFormat({ sharedSchemaVersion: SCHEMA - 1 });

function metaOf(state: Uint8Array): Y.Map<unknown> {
  const room = new Y.Doc();
  Y.applyUpdate(room, state);
  return room.getMap('docx-package-meta-v1');
}

describe('migrating a saved room', () => {
  test('an export with a paragraph that holds two w:pPr migrates whole and shown', async () => {
    const exported = zipDocument(
      '<w:p><w:r><w:t>Before</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:pPr><w:jc w:val="right"/></w:pPr>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>Doubled</w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>In a cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        '<w:p><w:r><w:t>After</w:t></w:r></w:p><w:sectPr/>'
    );
    const migrated = await migrateCollaborationRoom({ state: earlierRoom(), exported });
    if (!migrated.ok) throw new Error(JSON.stringify(migrated));
    expect(migrated.report).toEqual({
      ok: true,
      failed: [],
      from: expect.stringMatching(/^docx-collaboration:/),
      to: COLLABORATION_FORMAT_VERSION,
      documentId: EARLIER_ID,
      paragraphs: 4,
      hidden: 0,
      hiddenAt: [],
      changedParts: [],
      differenceCount: 0,
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

  test('the new room keeps the earlier document ID, which its clients open it with', async () => {
    const exported = zipDocument('<w:p><w:r><w:t>Text</w:t></w:r></w:p><w:sectPr/>');
    const kept = await migrateCollaborationRoom({ state: earlierRoom(), exported });
    if (!kept.ok) throw new Error(JSON.stringify(kept));
    expect(metaOf(kept.state).get('documentId')).toBe(EARLIER_ID);

    const renamed = await migrateCollaborationRoom({
      state: earlierRoom(),
      exported,
      documentId: '  renamed-room-1234567890abcdef ',
    });
    if (!renamed.ok) throw new Error(JSON.stringify(renamed));
    expect(renamed.report.documentId).toBe('renamed-room-1234567890abcdef');
    expect(metaOf(renamed.state).get('documentId')).toBe('renamed-room-1234567890abcdef');

    await expect(
      migrateCollaborationRoom({ state: earlierRoom(), exported, documentId: '   ' })
    ).rejects.toThrow('invalid-document-id');
  });

  test('a room from before formats were versioned migrates and reports it', async () => {
    const exported = zipDocument('<w:p><w:r><w:t>Old</w:t></w:r></w:p><w:sectPr/>');
    const migrated = await migrateCollaborationRoom({
      state: roomOfFormat({ sharedSchemaVersion: undefined }),
      exported,
    });
    expect(migrated.ok && migrated.report.from).toBe('unversioned');
  });

  test('a room in this format or a later one is refused, not replaced', async () => {
    const exported = zipDocument('<w:p/><w:sectPr/>');
    expect(await migrateCollaborationRoom({ state: roomOfFormat({}), exported })).toEqual({
      ok: false,
      reason: 'current',
    });
    expect(
      await migrateCollaborationRoom({
        state: roomOfFormat({ sharedSchemaVersion: SCHEMA + 1 }),
        exported,
      })
    ).toEqual({ ok: false, reason: 'later-format' });
  });

  test('unusable inputs throw stable codes', async () => {
    const exported = zipDocument('<w:p/><w:sectPr/>');
    await expect(
      migrateCollaborationRoom({ state: new Uint8Array([1, 2, 3, 4, 5]), exported })
    ).rejects.toThrow('invalid-baseline');
    await expect(
      migrateCollaborationRoom({ state: Y.encodeStateAsUpdate(new Y.Doc()), exported })
    ).rejects.toThrow('not-initialized');
    await expect(
      migrateCollaborationRoom({ state: earlierRoom(), exported: new Uint8Array([80, 75, 3]) })
    ).rejects.toThrow('invalid-baseline');
  });

  // Room state that each published release saved, with the document it holds.
  const releases = resolve(import.meta.dir, '../../../../../.collaboration/releases');
  for (const release of readdirSync(releases).filter((name) =>
    existsSync(resolve(releases, name, 'fixture.json'))
  )) {
    test(`a room that ${release} saved migrates and keeps its document ID`, async () => {
      const saved = JSON.parse(
        readFileSync(resolve(releases, release, 'fixture.json'), 'utf8')
      ) as { document: string; state: string };
      const state = new Uint8Array(Buffer.from(saved.state, 'base64'));
      expect(collaborationMigrationNeed(state)).toBe('earlier-format');
      const migrated = await migrateCollaborationRoom({
        state,
        exported: new Uint8Array(Buffer.from(saved.document, 'base64')),
      });
      if (!migrated.ok) throw new Error(JSON.stringify(migrated));
      expect(migrated.report.from).toBe('docx-collaboration:1.3.1.1');
      expect(migrated.report.documentId).toBe('old-room');
      expect(metaOf(migrated.state).get('documentId')).toBe('old-room');
    });
  }

  for (const fixture of [
    'images-wrap-sides.docx',
    'images-header.docx',
    'hyperlink-demo.docx',
    'block-sdt-showcase.docx',
    'complex-styles.docx',
    'docx-editor-numbering.docx',
    'endnotes-tracked-changes.docx',
    'header-with-table-and-paragraphs.docx',
  ]) {
    test(`${fixture} migrates with the same text, formatting, media, and links`, async () => {
      const exported = new Uint8Array(
        readFileSync(resolve(import.meta.dir, '../../../../../e2e/fixtures', fixture))
      );
      const migrated = await migrateCollaborationRoom({ state: earlierRoom(), exported });
      if (!migrated.ok) throw new Error(JSON.stringify(migrated));
      expect(migrated.report.failed).toEqual([]);
    });
  }

  test('a paragraph the editor cannot show is kept and counted', async () => {
    // A table inside a paragraph is not a paragraph shape the editor shows.
    const exported = zipDocument(
      '<w:p><w:r><w:t>Shown</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Odd</w:t></w:r><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl></w:p>' +
        '<w:sectPr/>'
    );
    const migrated = await migrateCollaborationRoom({ state: earlierRoom(), exported });
    if (!migrated.ok) throw new Error(JSON.stringify(migrated));
    expect(migrated.report.hidden).toBeGreaterThan(0);
    expect(migrated.report.hiddenAt).toEqual([{ part: '/word/document.xml', paragraph: 2 }]);
  });

  test('saved state reports whether it needs a migration', () => {
    expect(collaborationMigrationNeed(roomOfFormat({}))).toBe('current');
    expect(collaborationMigrationNeed(earlierRoom())).toBe('earlier-format');
    expect(collaborationMigrationNeed(roomOfFormat({ sharedSchemaVersion: SCHEMA + 1 }))).toBe(
      'later-format'
    );
    // A room from before formats were versioned has no version fields.
    expect(collaborationMigrationNeed(roomOfFormat({ sharedSchemaVersion: undefined }))).toBe(
      'earlier-format'
    );
    expect(() => collaborationMigrationNeed(Y.encodeStateAsUpdate(new Y.Doc()))).toThrow(
      'not-initialized'
    );
    expect(() => collaborationMigrationNeed(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(
      'invalid-baseline'
    );
  });
});

describe('the migration check', () => {
  const ROOM = {
    from: 'docx-collaboration:1.3.1.1',
    to: 'docx-collaboration:1.4.2.1',
    documentId: 'r',
  };
  const paragraph = (
    text: string,
    index: number,
    formatting = 'plain',
    part = '/word/document.xml'
  ): MigrationParagraph => ({ part, index, text, formatting, shown: true });
  const contents = (paragraphs: MigrationParagraph[]): MigrationContents => ({
    paragraphs,
    media: new Map(),
    links: [],
    parts: new Map(),
  });

  test('names each changed, missing, and added paragraph by its part and position', () => {
    const before = contents([
      paragraph('One', 1),
      paragraph('Two', 2),
      paragraph('Note', 1, 'plain', '/word/footnotes.xml'),
    ]);
    expect(compareMigrationContents(before, before, ROOM)).toMatchObject({
      ok: true,
      failed: [],
      differenceCount: 0,
    });
    const report = compareMigrationContents(
      before,
      contents([paragraph('One', 1, 'bold'), paragraph('Too', 2)]),
      ROOM
    );
    expect(report.ok).toBe(false);
    expect(report.failed).toEqual(['paragraphs', 'text', 'formatting']);
    expect(report.differences).toEqual([
      {
        part: '/word/document.xml',
        paragraph: 1,
        kind: 'formatting',
        expected: 'One',
        actual: 'One',
      },
      { part: '/word/document.xml', paragraph: 2, kind: 'text', expected: 'Two', actual: 'Too' },
      {
        part: '/word/footnotes.xml',
        paragraph: 1,
        kind: 'missing',
        expected: 'Note',
        actual: null,
      },
    ]);
    expect(
      compareMigrationContents(contents([]), contents([paragraph('New', 1)]), ROOM).differences
    ).toEqual([
      { part: '/word/document.xml', paragraph: 1, kind: 'added', expected: null, actual: 'New' },
    ]);
  });

  test('lists the first 20 differences and counts them all', () => {
    const many = Array.from({ length: 30 }, (_, at) => paragraph(`P${at}`, at + 1));
    const changed = many.map((entry) => ({ ...entry, text: `${entry.text}!` }));
    const report = compareMigrationContents(contents(many), contents(changed), ROOM);
    expect(report.differenceCount).toBe(30);
    expect(report.differences).toHaveLength(20);
  });

  test('a new room that lost a media part or a link target fails the check', () => {
    const paragraphs = [paragraph('Text', 1)];
    const before: MigrationContents = {
      paragraphs,
      media: new Map([
        ['digest-of-logo', '/word/media/logo.png'],
        ['digest-of-chart', '/word/media/chart.emf'],
      ]),
      links: ['hyperlink https://example.com/a', 'hyperlink https://example.com/a'],
      parts: new Map(),
    };
    const report = compareMigrationContents(
      before,
      {
        paragraphs,
        media: new Map([['digest-of-logo', '/word/media/image1.png']]),
        links: ['hyperlink https://example.com/a'],
        parts: new Map(),
      },
      ROOM
    );
    expect(report.failed).toEqual(['media', 'links']);
    // A renamed part with the same bytes is no loss; a part whose bytes are gone is.
    expect(report.missingMedia).toEqual(['/word/media/chart.emf']);
    // One of two links to the same target is gone.
    expect(report.missingLinks).toEqual(['hyperlink https://example.com/a']);
    expect(compareMigrationContents(before, before, ROOM).ok).toBe(true);
  });

  test('formatting compares properties and character formatting, not how runs are split', async () => {
    const formatting = async (body: string) =>
      (await migrationContentsOf(zipDocument(`${body}<w:sectPr/>`))).paragraphs[0]!.formatting;
    const bold = await formatting('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r></w:p>');
    // The same formatting in two runs, and an empty w:rPr, are no change.
    expect(
      await formatting(
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bo</w:t></w:r>' +
          '<w:r><w:rPr><w:b/></w:rPr><w:t>ld</w:t></w:r></w:p>'
      )
    ).toBe(bold);
    expect(await formatting('<w:p><w:r><w:rPr/><w:t>Bold</w:t></w:r></w:p>')).toBe(
      await formatting('<w:p><w:r><w:t>Bold</w:t></w:r></w:p>')
    );
    // Lost character formatting, formatting on other characters, and lost paragraph
    // properties are each a change.
    expect(await formatting('<w:p><w:r><w:t>Bold</w:t></w:r></w:p>')).not.toBe(bold);
    expect(
      await formatting(
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bo</w:t></w:r><w:r><w:t>ld</w:t></w:r></w:p>'
      )
    ).not.toBe(bold);
    expect(
      await formatting(
        '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r></w:p>'
      )
    ).not.toBe(bold);
  });

  test('structure compares every XML part, ignoring only what each save writes anew', async () => {
    const partsOf = async (body: string) =>
      (await migrationContentsOf(zipDocument(`${body}<w:sectPr/>`))).parts.get(
        '/word/document.xml'
      );
    const table = (span: string) =>
      `<w:tbl><w:tr><w:tc><w:tcPr>${span}</w:tcPr><w:p><w:r><w:t>Cell</w:t></w:r></w:p>` +
      '</w:tc></w:tr></w:tbl>';
    // A lost cell merge is a change the paragraph checks cannot see.
    expect(await partsOf(table('<w:gridSpan w:val="2"/>'))).not.toBe(await partsOf(table('')));
    // IDs a save renumbers consistently are no change; anchors that point elsewhere are.
    const anchored = (first: string, second: string, ends: readonly [string, string]) =>
      `<w:p><w:commentRangeStart w:id="${first}"/><w:r><w:t>One</w:t></w:r>` +
      `<w:commentRangeEnd w:id="${ends[0]}"/><w:bookmarkStart w:id="${first}" w:name="a"/>` +
      `<w:bookmarkEnd w:id="${ends[0]}"/></w:p>` +
      `<w:p><w:commentRangeStart w:id="${second}"/><w:r><w:t>Two</w:t></w:r>` +
      `<w:commentRangeEnd w:id="${ends[1]}"/><w:bookmarkStart w:id="${second}" w:name="b"/>` +
      `<w:bookmarkEnd w:id="${ends[1]}"/></w:p>`;
    const original = await partsOf(anchored('0', '1', ['0', '1']));
    expect(await partsOf(anchored('7', '3', ['7', '3']))).toBe(original);
    expect(await partsOf(anchored('0', '1', ['1', '0']))).not.toBe(original);
    const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
    // A comment extension names its comment's paragraph by ID: renumbered paragraph IDs are
    // no change, and a done state that moved to the other comment is.
    const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
    const extended = async (ids: readonly [string, string], done: readonly [string, string]) =>
      extendedOf(ids, [
        [ids[0], done[0]],
        [ids[1], done[1]],
      ]);
    const extendedOf = async (
      ids: readonly [string, string],
      entries: readonly (readonly [string, string])[]
    ) => {
      const exported = zipDocument(
        `<w:p xmlns:w14="${W14}" w14:paraId="${ids[0]}"><w:r><w:t>One</w:t></w:r></w:p>` +
          `<w:p xmlns:w14="${W14}" w14:paraId="${ids[1]}"><w:r><w:t>Two</w:t></w:r></w:p>` +
          '<w:sectPr/>',
        {
          overrides:
            '<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/>',
          extraXml: {
            'word/commentsExtended.xml':
              `<w15:commentsEx xmlns:w15="${W15}">` +
              entries
                .map(([id, done]) => `<w15:commentEx w15:paraId="${id}" w15:done="${done}"/>`)
                .join('') +
              '</w15:commentsEx>',
          },
        }
      );
      const parts = (await migrationContentsOf(exported)).parts;
      expect(parts.has('/word/commentsExtended.xml')).toBe(true);
      return JSON.stringify([...parts]);
    };
    const comments = await extended(['00000001', '00000002'], ['1', '0']);
    expect(await extended(['0000000A', '0000000B'], ['1', '0'])).toBe(comments);
    // The first comment's done state on the second comment's paragraph.
    expect(
      await extendedOf(
        ['00000001', '00000002'],
        [
          ['00000002', '1'],
          ['00000001', '0'],
        ]
      )
    ).not.toBe(comments);
    // So is a tracked change's author.
    const inserted = (author: string) =>
      `<w:p><w:ins w:id="1" w:author="${author}" w:date="2026-01-01T00:00:00Z">` +
      '<w:r><w:t>New</w:t></w:r></w:ins></w:p>';
    expect(await partsOf(inserted('A'))).not.toBe(await partsOf(inserted('B')));
    // Paragraph IDs and renumbered w:id values are not.
    const tagged = (paraId: string, id: string) =>
      `<w:p xmlns:w14="${W14}" w14:paraId="${paraId}"><w:ins w:id="${id}" w:author="A" ` +
      'w:date="2026-01-01T00:00:00Z"><w:r><w:t>New</w:t></w:r></w:ins></w:p>';
    expect(await partsOf(tagged('00000001', '1'))).toBe(await partsOf(tagged('7FFFFFFE', '42')));

    const parts = (fingerprint: string) => new Map([['/word/document.xml', fingerprint]]);
    const report = compareMigrationContents(
      { ...contents([paragraph('Same', 1)]), parts: parts('before') },
      { ...contents([paragraph('Same', 1)]), parts: parts('after') },
      ROOM
    );
    expect(report.failed).toEqual(['structure']);
    expect(report.changedParts).toEqual(['/word/document.xml']);
  });
});
