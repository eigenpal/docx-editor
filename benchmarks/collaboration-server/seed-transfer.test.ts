// What a new room costs the participant that opens it, on a real Hocuspocus server.
//
// Hocuspocus sends every document update to every connection in the room, including the one
// that sent it. A participant that seeds a new room uploads the whole document and then
// receives it back. A server that seeds the room with `createCollaborationState` sends the
// document once, and the participant uploads nothing.

import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { createCollaborationRoomId } from '@docx-editor.dev/pro/collaboration/hocuspocus';
import { readCollaborationDocument } from '@docx-editor.dev/pro/collaboration';
import {
  docxParagraphTexts,
  joinRoom,
  paragraphTexts,
  paragraphsDocx,
  startSeedServer,
  until,
  type SeedParticipant,
  type SeedServer,
} from './seed-transfer-harness.ts';

const SAMPLE = new Uint8Array(
  readFileSync(path.join(import.meta.dir, '../../examples/vite/public/sample.docx'))
);
const SEED_RECORDS_KEY = 'docx-collaboration-seeds-v1';

// A real server and a document of 2.7 MB of room state: allow for a busy machine.
setDefaultTimeout(60_000);

const servers: SeedServer[] = [];
const participants: SeedParticipant[] = [];

afterEach(async () => {
  for (const participant of participants.splice(0)) participant.destroy();
  for (const server of servers.splice(0)) await server.stop();
});

async function server(seed: 'server' | 'none', document: Uint8Array = SAMPLE): Promise<SeedServer> {
  const started = await startSeedServer({ seed, document });
  servers.push(started);
  return started;
}

async function join(
  room: SeedServer,
  peer: string,
  roomId: string,
  bootstrap: Parameters<typeof joinRoom>[1]['bootstrap']
): Promise<SeedParticipant> {
  const participant = await joinRoom(room, { peer, roomId, bootstrap });
  participants.push(participant);
  return participant;
}

/** Wait until the server holds every update the participant wrote. */
async function settled(participant: SeedParticipant): Promise<void> {
  await until(
    () => participant.room.provider.isSynced && !participant.room.provider.hasUnsyncedChanges,
    `peer ${participant.peer} to sync`
  );
  // The server answers in the same turn it applies an update; give the socket time to deliver.
  await new Promise((resolve) => setTimeout(resolve, 100));
}

function stateSize(room: SeedServer, roomId: string): number {
  const document = room.document(roomId);
  if (!document) throw new Error('the room is not loaded');
  return Y.encodeStateAsUpdate(document).byteLength;
}

describe('a new room on a Hocuspocus server', () => {
  test('a participant that seeds the room receives its own seed back', async () => {
    // The control for the measurement below: the echo it rules out is real and measurable.
    const room = await server('none');
    const roomId = createCollaborationRoomId();
    const creator = await join(room, 'creator', roomId, {
      kind: 'create-or-join',
      document: SAMPLE,
      electionWindowMs: 50,
    });
    await settled(creator);
    const state = stateSize(room, roomId);
    const traffic = room.traffic('creator');
    console.log(
      `participant seed: state ${state} B, creator sent ${traffic.syncSent} B and received ${traffic.syncReceived} B of sync`
    );
    expect(traffic.syncSent).toBeGreaterThan(state * 0.9);
    expect(traffic.syncReceived).toBeGreaterThan(state * 0.9);
  });

  test('a server seed reaches the creator once, and the creator uploads nothing', async () => {
    const room = await server('server');
    const roomId = createCollaborationRoomId();
    const creator = await join(room, 'creator', roomId, {
      kind: 'create-or-join',
      document: SAMPLE,
    });
    await settled(creator);
    const state = stateSize(room, roomId);
    const traffic = room.traffic('creator');
    console.log(
      `server seed: state ${state} B, creator sent ${traffic.syncSent} B and received ${traffic.syncReceived} B of sync`
    );
    // One copy of the room, and no seed-sized echo.
    expect(traffic.syncReceived).toBeGreaterThan(state * 0.9);
    expect(traffic.syncReceived).toBeLessThan(state * 1.1);
    expect(traffic.syncSent).toBeLessThan(state * 0.05);
    expect(room.seeds()).toBe(1);
    expect(room.document(roomId)!.getArray(SEED_RECORDS_KEY).length).toBe(1);
    expect(paragraphTexts(creator.store)).toEqual(docxParagraphTexts(SAMPLE));

    // A second participant receives the whole document, and the creator receives only its edit.
    const before = room.traffic('creator').syncReceived;
    const second = await join(room, 'second', roomId, { kind: 'join' });
    expect(paragraphTexts(second.store)).toEqual(docxParagraphTexts(SAMPLE));
    second.insert(0, 0, 'Z');
    await until(
      () => paragraphTexts(creator.store)[0]?.startsWith('Z') === true,
      'the edit to reach the creator'
    );
    expect(room.traffic('creator').syncReceived - before).toBeLessThan(state * 0.05);
    expect(room.traffic('second').syncSent).toBeLessThan(state * 0.05);

    // Save and reopen: the stored room reads back as the seed plus the edit.
    await settled(second);
    await until(
      () => docxParagraphTexts(readCollaborationDocument(stored(room, roomId)))[0]?.[0] === 'Z',
      'the server to store the edit'
    );
    const saved = docxParagraphTexts(readCollaborationDocument(stored(room, roomId)));
    expect(saved).toEqual(paragraphTexts(second.store));
    expect(creator.statuses.filter((status) => status.startsWith('error'))).toEqual([]);
    expect(second.statuses.filter((status) => status.startsWith('error'))).toEqual([]);
  });

  test('a loaded room reaches the first participant once, seeded or stored', async () => {
    // Hocuspocus holds back an update below `flushMaxBytes` until the next turn, and then sends
    // it to every connection, so the state applied in `onLoadDocument` would follow the
    // participant's own sync. The server flushes it before the first connection joins.
    const room = await server('server', paragraphsDocx(['Small room', 'Two paragraphs']));
    const roomId = createCollaborationRoomId();
    const first = await join(room, 'first', roomId, { kind: 'join' });
    await settled(first);
    const state = stateSize(room, roomId);
    expect(room.traffic('first').largeSyncReceived(state / 2)).toBe(1);
    first.destroy();
    await until(() => room.document(roomId) === undefined, 'the server to unload the room');
    const again = await join(room, 'again', roomId, { kind: 'join' });
    await settled(again);
    expect(room.traffic('again').largeSyncReceived(state / 2)).toBe(1);
    expect(room.seeds()).toBe(1);
    expect(paragraphTexts(again.store)).toEqual(['Small room', 'Two paragraphs']);
  });

  test('participants that race to open a new room all join the one server seed', async () => {
    const room = await server('server', paragraphsDocx(['First paragraph', 'Second paragraph']));
    const roomId = createCollaborationRoomId();
    const joined = await Promise.all(
      ['a', 'b', 'c'].map((peer) =>
        join(room, peer, roomId, {
          kind: 'create-or-join',
          document: paragraphsDocx(['First paragraph', 'Second paragraph']),
        })
      )
    );
    expect(room.seeds()).toBe(1);
    expect(room.document(roomId)!.getArray(SEED_RECORDS_KEY).length).toBe(1);
    for (const participant of joined) {
      expect(paragraphTexts(participant.store)).toEqual(['First paragraph', 'Second paragraph']);
    }
  });

  test('a room seeded again after its state was lost refuses the earlier replica', async () => {
    // Without a new generation, the earlier replica would merge a second copy of the document,
    // and every participant would report `concurrent-seed`.
    const room = await server('server', paragraphsDocx(['Only paragraph']));
    const roomId = createCollaborationRoomId();
    const first = await join(room, 'first', roomId, { kind: 'join' });
    first.disconnect();
    await until(() => room.document(roomId) === undefined, 'the server to unload the room');
    room.storage.delete(roomId);
    const later = await join(room, 'later', roomId, { kind: 'join' });
    await first.reconnect();
    await until(
      () => first.statuses.includes('error:room-generation-changed'),
      'the earlier replica to be refused'
    );
    expect(room.document(roomId)!.getArray(SEED_RECORDS_KEY).length).toBe(1);
    expect(paragraphTexts(later.store)).toEqual(['Only paragraph']);
    expect(later.statuses.filter((status) => status.startsWith('error'))).toEqual([]);
  });
});

function stored(room: SeedServer, roomId: string): Y.Doc {
  const state = room.storage.get(roomId);
  if (!state) throw new Error('the room was not stored');
  const document = new Y.Doc();
  Y.applyUpdate(document, state);
  return document;
}
