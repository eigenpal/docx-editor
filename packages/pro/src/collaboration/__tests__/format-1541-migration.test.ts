/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// "Upgrade rooms to format 1.5.4.1", step by step as the guide writes it: a format 1.5.3.1
// room with shapes is refused unchanged, exported, migrated in a dry run and for real, and the
// migrated room opens in the current format with every shape property kept. The export and
// migration functions are the guide's own code.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { strFromU8, unzipSync } from 'fflate';
import { DOCUMENT_COLLABORATION_VERSIONS } from '../document-compatibility.ts';
import { readCollaborationDocument } from '../document-read.ts';
import {
  COLLABORATION_FORMAT_VERSION,
  readCollaborationFormatVersion,
} from '../document-format.ts';
import { CollaborationSchemaError } from '../errors.ts';
import { collaborationMigrationNeed, migrateCollaborationRoom } from '../room-migration.ts';
import { zipDocument } from './document-peer-support.ts';

const NS =
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml"';
const SHAPE_PROPERTIES =
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1">' +
  '<a:lumMod val="75000"/><a:lumOff val="25000"/><a:alpha val="60000"/></a:schemeClr></a:solidFill>' +
  '<a:ln w="12700"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:prstDash val="dash"/>' +
  '<a:round/></a:ln>';
const BODY =
  '<w:p><w:r><w:t>Before the shape.</w:t></w:r></w:p>' +
  `<w:p><w:r><mc:AlternateContent ${NS}><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="0" ` +
  'distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" ' +
  'layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column">' +
  '<wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0' +
  '</wp:posOffset></wp:positionV><wp:extent cx="1828800" cy="457200"/><wp:effectExtent l="0" t="0" ' +
  'r="0" b="0"/><wp:wrapNone/><wp:docPr id="1" name="Box"/><wp:cNvGraphicFramePr/><a:graphic>' +
  '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp>' +
  '<wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="457200"/></a:xfrm>' +
  `${SHAPE_PROPERTIES}</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor>` +
  '</w:drawing></mc:Choice><mc:Fallback><w:pict><v:rect id="_x0000_s1026" ' +
  'style="width:144pt;height:36pt" fillcolor="#4472c4" strokecolor="#1f3864"/></w:pict></mc:Fallback>' +
  '</mc:AlternateContent><w:t>Shape anchor.</w:t></w:r></w:p>';

/** A room as format 1.5.3.1 saved it: this build's records, under repair version 3. */
async function formatRoom1531(): Promise<{ state: Uint8Array; exported: Uint8Array }> {
  const empty = new Y.Doc();
  const meta = empty.getMap('docx-package-meta-v1');
  meta.set('initialized', true);
  meta.set('documentId', 'shape-room-1234567890abcdef');
  for (const [field, value] of Object.entries(DOCUMENT_COLLABORATION_VERSIONS))
    meta.set(field, field === 'sharedSchemaVersion' ? value - 1 : value);
  const seeded = await migrateCollaborationRoom({
    state: Y.encodeStateAsUpdate(empty),
    exported: zipDocument(BODY),
  });
  if (!seeded.ok) throw new Error(seeded.reason);
  const room = new Y.Doc();
  Y.applyUpdate(room, seeded.state);
  // What the earlier build's export gives: the same document, read before the format moves.
  const exported = readCollaborationDocument(room);
  room.getMap('docx-package-meta-v1').set('repairVersion', 3);
  return { state: Y.encodeStateAsUpdate(room), exported };
}

// The guide's "Export rooms with the earlier build" function.
function exportRoom(state: Uint8Array) {
  const room = new Y.Doc();
  try {
    Y.applyUpdate(room, state);
    return {
      exported: readCollaborationDocument(room),
      stateDigest: createHash('sha256').update(state).digest('hex'),
    };
  } finally {
    room.destroy();
  }
}

type SavedExport = { exported: Uint8Array; stateDigest: string };

function validateRoom(state: Uint8Array): void {
  const room = new Y.Doc();
  try {
    Y.applyUpdate(room, state);
    readCollaborationDocument(room);
  } finally {
    room.destroy();
  }
}

// The guide's "Migrate each room" function, over in-memory storage.
function storageOf(rooms: Map<string, Uint8Array>, exports: Map<string, SavedExport>) {
  const backups = new Map<string, Uint8Array>();
  const storage = {
    readRoom: async (roomId: string) => rooms.get(roomId)!,
    readExport: async (roomId: string) => exports.get(roomId) ?? null,
    backUpRoom: async (roomId: string, state: Uint8Array) => void backups.set(roomId, state),
    writeRoom: async (roomId: string, state: Uint8Array) => void rooms.set(roomId, state),
  };
  async function migrateRoom(roomId: string, dryRun: boolean) {
    const state = await storage.readRoom(roomId);
    try {
      const need = collaborationMigrationNeed(state);
      if (need === 'later-format') return need;
      if (need === 'current') {
        validateRoom(state);
        return 'current';
      }
      const saved = await storage.readExport(roomId);
      if (!saved) return 'no-export';
      const digest = createHash('sha256').update(state).digest('hex');
      if (saved.stateDigest !== digest) return 'stale-export';
      const migrated = await migrateCollaborationRoom({ state, exported: saved.exported });
      if (!migrated.ok)
        return migrated.reason === 'check-failed' ? 'failed-check' : migrated.reason;
      if (dryRun) return 'would-migrate';
      await storage.backUpRoom(roomId, state);
      await storage.writeRoom(roomId, migrated.state);
      return 'migrated';
    } catch (error) {
      if (!(error instanceof CollaborationSchemaError)) throw error;
      return 'error';
    }
  }
  return { migrateRoom, backups };
}

const documentXml = (docx: Uint8Array) => strFromU8(unzipSync(docx)['word/document.xml']!);

describe('upgrade rooms to format 1.5.4.1', () => {
  test('this build refuses a format 1.5.3.1 room before reading it, and leaves it unchanged', async () => {
    const { state } = await formatRoom1531();
    const before = Buffer.from(state).toString('hex');
    expect(collaborationMigrationNeed(state)).toBe('earlier-format');
    expect(() => validateRoom(state)).toThrow(CollaborationSchemaError);
    expect(Buffer.from(state).toString('hex')).toBe(before);
    expect(COLLABORATION_FORMAT_VERSION).toBe('docx-collaboration:1.5.4.1');
  });

  test('the guide steps export, dry-run, migrate, and rerun a room with shapes', async () => {
    const earlier = await formatRoom1531();
    const rooms = new Map([['room', earlier.state]]);
    const exports = new Map<string, SavedExport>();
    const { migrateRoom, backups } = storageOf(rooms, exports);
    // Without an export there is nothing to seed from.
    expect(await migrateRoom('room', true)).toBe('no-export');
    // The earlier build's export, hashed with the state it read.
    exports.set('room', {
      exported: earlier.exported,
      stateDigest: createHash('sha256').update(earlier.state).digest('hex'),
    });
    expect(await migrateRoom('room', true)).toBe('would-migrate');
    expect(rooms.get('room')).toBe(earlier.state);
    expect(await migrateRoom('room', false)).toBe('migrated');
    expect(backups.get('room')).toBe(earlier.state);
    // A rerun after the write finds the room current.
    expect(await migrateRoom('room', false)).toBe('current');

    const migrated = rooms.get('room')!;
    expect(collaborationMigrationNeed(migrated)).toBe('current');
    const room = new Y.Doc();
    Y.applyUpdate(room, migrated);
    expect(readCollaborationFormatVersion(room)).toBe(COLLABORATION_FORMAT_VERSION);
    const xml = documentXml(exportRoom(migrated).exported);
    // Theme transforms, alpha, dash, join and the VML fallback all survive the move.
    for (const kept of [
      '<a:lumMod val="75000"/>',
      '<a:lumOff val="25000"/>',
      '<a:alpha val="60000"/>',
      '<a:prstDash val="dash"/>',
      '<a:round/>',
      'fillcolor="#4472c4"',
    ])
      expect(xml).toContain(kept);
  });

  test('a room that changed after its export is not migrated', async () => {
    const earlier = await formatRoom1531();
    const changed = new Y.Doc();
    Y.applyUpdate(changed, earlier.state);
    changed.getMap('extra').set('edit', 1);
    const rooms = new Map([['room', Y.encodeStateAsUpdate(changed)]]);
    const exports = new Map<string, SavedExport>([
      [
        'room',
        {
          exported: earlier.exported,
          stateDigest: createHash('sha256').update(earlier.state).digest('hex'),
        },
      ],
    ]);
    expect(await storageOf(rooms, exports).migrateRoom('room', false)).toBe('stale-export');
  });
});
