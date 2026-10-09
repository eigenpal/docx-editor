import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import {
  DOCUMENT_COLLABORATION_VERSIONS,
  collaborationMigrationNeed,
  migrateCollaborationRoom,
} from '@docx-editor.dev/pro/collaboration';
import { zipDocument } from '../../../packages/pro/src/collaboration/__tests__/document-peer-support.ts';
import { stateDigest } from './room-files.ts';
import {
  allRoomsServable,
  exportDigestFileOf,
  exportFileOf,
  migrateStoredRooms,
} from './room-migration.ts';

// An export of a room that concurrent property edits left with two `w:pPr` in one paragraph.
const EXPORT = zipDocument(
  '<w:p><w:r><w:t>Before</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:pPr><w:jc w:val="right"/></w:pPr>' +
    '<w:r><w:t>Doubled</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>After</w:t></w:r></w:p><w:sectPr/>'
);

const ROOMS = {
  earlier: 'earlier-room-1234567890abcdefg',
  current: 'current-room-1234567890abcdefg',
  noExport: 'no-export-room-1234567890abcd',
  later: 'later-room-1234567890abcdefghi',
};

/** Room state whose shared schema version is this build's plus `shift`. */
function roomOfSchema(shift: number): Uint8Array {
  const room = new Y.Doc();
  try {
    const meta = room.getMap('docx-package-meta-v1');
    meta.set('initialized', true);
    meta.set('documentId', 'stored-room-1234567890abcdefg');
    for (const [field, value] of Object.entries(DOCUMENT_COLLABORATION_VERSIONS)) {
      meta.set(field, value);
    }
    meta.set('sharedSchemaVersion', DOCUMENT_COLLABORATION_VERSIONS.sharedSchemaVersion + shift);
    return Y.encodeStateAsUpdate(room);
  } finally {
    room.destroy();
  }
}

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function storedRooms(): Promise<Record<string, Uint8Array>> {
  directory = await mkdtemp(path.join(tmpdir(), 'room-migration-'));
  const current = await migrateCollaborationRoom(EXPORT, { documentId: ROOMS.current });
  if (!current.ok) throw new Error('could not seed the current room');
  const states = {
    [ROOMS.earlier]: roomOfSchema(-1),
    [ROOMS.current]: current.state,
    [ROOMS.noExport]: roomOfSchema(-1),
    [ROOMS.later]: roomOfSchema(1),
  };
  for (const [room, state] of Object.entries(states)) {
    await writeFile(path.join(directory, `${room}.ydoc`), state);
  }
  await writeFile(exportFileOf(directory, ROOMS.earlier), EXPORT);
  await writeFile(
    exportDigestFileOf(directory, ROOMS.earlier),
    stateDigest(states[ROOMS.earlier]!)
  );
  return states;
}

const bytesOf = async (file: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(path.join(directory, file)));
const stateOf = (room: string): Promise<Uint8Array> => bytesOf(`${room}.ydoc`);

describe('migrating the rooms the server stores', () => {
  test('a dry run reports every room and writes nothing', async () => {
    const states = await storedRooms();
    const before = (await readdir(directory)).sort();
    const results = await migrateStoredRooms(directory, { dryRun: true });
    expect(results.map((result) => [result.room, result.outcome])).toEqual([
      [ROOMS.current, 'current'],
      [ROOMS.earlier, 'would-migrate'],
      [ROOMS.later, 'later-format'],
      [ROOMS.noExport, 'no-export'],
    ]);
    expect((await readdir(directory)).sort()).toEqual(before);
    expect(await stateOf(ROOMS.earlier)).toEqual(states[ROOMS.earlier]!);
    expect(allRoomsServable(results)).toBe(false);
  });

  test('a run replaces only the checked room, keeps its earlier state, and resumes', async () => {
    const states = await storedRooms();
    const results = await migrateStoredRooms(directory);
    const earlier = results.find((result) => result.room === ROOMS.earlier)!;
    expect(earlier.outcome).toBe('migrated');
    if ('report' in earlier) {
      expect(earlier.report).toEqual({
        ok: true,
        paragraphs: 3,
        hidden: 0,
        differences: [],
        missingMedia: [],
        missingLinks: [],
      });
    }
    expect(collaborationMigrationNeed(await stateOf(ROOMS.earlier))).toBe('current');
    expect(await bytesOf(`${ROOMS.earlier}.ydoc.previous`)).toEqual(states[ROOMS.earlier]!);
    // Rooms that were not migrated are untouched.
    for (const room of [ROOMS.current, ROOMS.noExport, ROOMS.later]) {
      expect(await stateOf(room)).toEqual(states[room]!);
    }
    // A second run finds the migrated room current and changes nothing.
    const migrated = await stateOf(ROOMS.earlier);
    const again = await migrateStoredRooms(directory);
    expect(again.find((result) => result.room === ROOMS.earlier)!.outcome).toBe('current');
    expect(await stateOf(ROOMS.earlier)).toEqual(migrated);
  });

  test('a room edited after its export is refused and left as it is', async () => {
    const states = await storedRooms();
    // People edited the room after the export: its state is no longer the one exported.
    const edited = roomOfSchema(-1);
    const changed = new Y.Doc();
    try {
      Y.applyUpdate(changed, edited);
      changed.getMap('docx-package-meta-v1').set('editedAfterExport', true);
      await writeFile(
        path.join(directory, `${ROOMS.earlier}.ydoc`),
        Y.encodeStateAsUpdate(changed)
      );
    } finally {
      changed.destroy();
    }
    const before = await stateOf(ROOMS.earlier);
    const results = await migrateStoredRooms(directory);
    expect(results.find((result) => result.room === ROOMS.earlier)!.outcome).toBe('stale-export');
    expect(await stateOf(ROOMS.earlier)).toEqual(before);
    expect(await stateOf(ROOMS.earlier)).not.toEqual(states[ROOMS.earlier]!);
    expect(allRoomsServable(results)).toBe(false);
  });
});
