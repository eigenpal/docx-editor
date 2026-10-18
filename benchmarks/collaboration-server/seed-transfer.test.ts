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

  test('joins aborted while their socket connects reject at once and close their sockets', async () => {
    const room = await server('server', paragraphsDocx(['Abort while connecting']));
    const outcomes: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      const abort = new AbortController();
      if (index % 3 === 0) abort.abort();
      else setTimeout(() => abort.abort(), index % 4);
      outcomes.push(
        await join(room, `abort-${index}`, createCollaborationRoomId(), {
          kind: 'join',
          signal: abort.signal,
        }).then(
          () => 'joined',
          (error: { code?: string }) => error.code ?? 'threw'
        )
      );
    }
    expect(
      outcomes.filter((outcome) => outcome !== 'joined' && outcome !== 'initialization-aborted')
    ).toEqual([]);
    expect(
      outcomes.filter((outcome) => outcome === 'initialization-aborted').length
    ).toBeGreaterThanOrEqual(10);
    // Every aborted join closed whatever connection it had opened.
    await until(
      () =>
        outcomes.every(
          (outcome, index) => outcome === 'joined' || room.traffic(`abort-${index}`).closed
        ),
      'the aborted joins to close their sockets'
    );
  });

  test('a join aborted before it starts opens no connection', async () => {
    const room = await server('server', paragraphsDocx(['Never opened']));
    const abort = new AbortController();
    abort.abort();
    await expect(
      join(room, 'pre-aborted', createCollaborationRoomId(), {
        kind: 'create-or-join',
        document: SAMPLE,
        signal: abort.signal,
      })
    ).rejects.toMatchObject({ code: 'initialization-aborted' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(room.connections.filter((entry) => entry.peer === 'pre-aborted')).toEqual([]);
    expect(room.authenticated).not.toContain('pre-aborted');
    expect(room.seeds()).toBe(0);
  });

  test('a join aborted while the server loads the room sends no sync or token after the abort', async () => {
    const room = await startSeedServer({
      seed: 'server',
      document: paragraphsDocx(['Slow room']),
      loadDelayMs: () => 500,
    });
    servers.push(room);
    const abort = new AbortController();
    const pending = join(room, 'slow', createCollaborationRoomId(), {
      kind: 'join',
      signal: abort.signal,
    });
    // The token reaches the server, which starts to load the room; then the participant leaves.
    await until(() => room.authenticated.includes('slow'), 'the server to authenticate the join');
    abort.abort();
    const started = performance.now();
    await expect(pending).rejects.toMatchObject({ code: 'initialization-aborted' });
    expect(performance.now() - started).toBeLessThan(100);
    const sentAtAbort = room.traffic('slow').sentTypes.length;
    await until(() => room.traffic('slow').closed, 'the aborted join to close its socket');
    // Wait past the load: the server finished it for nobody.
    await new Promise((resolve) => setTimeout(resolve, 700));
    // After the abort the provider only says goodbye: it clears its presence (awareness, 1)
    // and closes (7). No token (2), sync (0), or stateless message (5) follows.
    expect(room.traffic('slow').sentTypes.slice(sentAtAbort)).toEqual([1, 7]);
    expect(room.connections.filter((entry) => entry.peer === 'slow')).toHaveLength(1);
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

  test('a known room whose stored state is lost is refused, and its edits stay with the participant', async () => {
    // Seeding it again would replace the edit below with the original file.
    const room = await server('server', paragraphsDocx(['Original']));
    const roomId = createCollaborationRoomId();
    const editor = await join(room, 'editor', roomId, { kind: 'join' });
    editor.insert(0, 0.999, ' EDITED');
    await settled(editor);
    await until(() => storedTexts(room, roomId)[0] === 'Original EDITED', 'the edit to be stored');
    await editor.disconnect();
    await until(() => room.document(roomId) === undefined, 'the server to unload the room');
    room.storage.delete(roomId);
    await editor.reconnect();
    await until(
      () => editor.statuses.includes('error:saved-room-unavailable'),
      'the participant to be refused'
    );
    expect(paragraphTexts(editor.store)).toEqual(['Original EDITED']);
    await expect(
      join(room, 'late', roomId, { kind: 'create-or-join', document: SAMPLE })
    ).rejects.toMatchObject({ code: 'saved-room-unavailable' });
    expect(room.seeds()).toBe(1);
    expect(room.storage.has(roomId)).toBe(false);

    // Restoring the stored state lets the participant continue, edit included.
    room.storage.set(roomId, Y.encodeStateAsUpdate(editor.room.ydoc));
    const restored = await join(room, 'restored', roomId, { kind: 'join' });
    expect(paragraphTexts(restored.store)).toEqual(['Original EDITED']);
  });

  test('a room seeded again after its record and state were lost refuses the earlier replica', async () => {
    // The last defense: the new seed has a new generation, so the earlier replica is refused
    // instead of merging a second copy of the document, which every participant would report
    // as `concurrent-seed`.
    const room = await server('server', paragraphsDocx(['Only paragraph']));
    const roomId = createCollaborationRoomId();
    const first = await join(room, 'first', roomId, { kind: 'join' });
    await first.disconnect();
    await until(() => room.document(roomId) === undefined, 'the server to unload the room');
    room.storage.delete(roomId);
    room.created.delete(roomId);
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

function storedTexts(room: SeedServer, roomId: string): string[] {
  if (!room.storage.has(roomId)) return [];
  return docxParagraphTexts(readCollaborationDocument(stored(room, roomId)));
}

function stored(room: SeedServer, roomId: string): Y.Doc {
  const state = room.storage.get(roomId);
  if (!state) throw new Error('the room was not stored');
  const document = new Y.Doc();
  Y.applyUpdate(document, state);
  return document;
}
