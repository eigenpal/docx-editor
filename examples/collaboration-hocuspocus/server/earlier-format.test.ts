import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import {
  collaborationMigrationNeed,
  collaborationServerExtension,
  createCollaborationState,
  readCollaborationDocument,
  type CollaborationServerEvent,
} from '@docx-editor.dev/pro/collaboration';
import { zipDocument } from '../../../packages/pro/src/collaboration/__tests__/document-peer-support.ts';
import { asEarlierFormat } from './earlier-format.ts';
import { stateDigest } from './room-files.ts';
import { createRoomStorage } from './room-storage.ts';

const ROOM = 'room-1234567890abcdefghij';
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const seed = (): Uint8Array =>
  zipDocument('<w:p><w:r><w:t>Upgrade me</w:t></w:r></w:p><w:sectPr/>');

test('the server upgrades a room that the simulation rewrote, from its stored export', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'earlier-format-'));
  directories.push(dataDir);
  const storage = createRoomStorage(dataDir);

  // A room as the server stores it: the state, and an export of that state.
  const state = await createCollaborationState(seed(), { documentId: ROOM });
  const current = new Y.Doc();
  Y.applyUpdate(current, state);
  const docx = readCollaborationDocument(current);
  current.destroy();

  // The simulation: the same document, in a state that names an earlier format.
  const earlier = asEarlierFormat(state);
  expect(collaborationMigrationNeed(earlier)).toBe('earlier-format');
  await storage.save(ROOM, { state: earlier, export: { docx, stateDigest: stateDigest(earlier) } });

  // The server loads the room, and upgrades it.
  const events: CollaborationServerEvent[] = [];
  const live = new Y.Doc();
  await collaborationServerExtension({
    storage,
    onEvent: (event) => events.push(event),
  }).onLoadDocument({ documentName: ROOM, document: live, context: {} });

  expect(events.map((event) => event.type)).toEqual(['room-upgraded']);
  const stored = await storage.load(ROOM);
  expect(collaborationMigrationNeed(stored!.state)).toBe('current');
  expect(stored!.export!.stateDigest).toBe(stateDigest(stored!.state));
  // The earlier state is kept, and the live room holds the document.
  expect(existsSync(path.join(dataDir, `${ROOM}.ydoc.previous`))).toBe(true);
  expect(readCollaborationDocument(live).byteLength).toBeGreaterThan(0);
  live.destroy();
});
