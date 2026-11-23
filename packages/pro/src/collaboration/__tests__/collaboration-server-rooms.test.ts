/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `collaborationServerExtension` in a real Hocuspocus server, with real editors on real sockets.
//
// Two editors join through the extension, edit at the same time, and converge. The room is
// stored with a `.docx` export, survives a server restart, and upgrades from that export when
// a server of another collaboration format loads it. A client of another format is refused.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();

import { afterAll, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import * as Y from 'yjs';
import { Hocuspocus } from '@hocuspocus/server';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import {
  collaborationServerExtension,
  type CollaborationRoomStorage,
  type CollaborationServerEvent,
  type StoredCollaborationRoom,
} from '../collaboration-server.ts';
import { DOCUMENT_COLLABORATION_VERSIONS } from '../document-compatibility.ts';
import { COLLABORATION_FORMAT_VERSION } from '../document-format.ts';
import { COLLABORATION_FORMAT_PARAMETER } from '../format-parameter.ts';
import {
  createCollaborationRoomId,
  createHocuspocusCollaboration,
  type HocuspocusCollaborationRoom,
} from '../hocuspocus.ts';
import { collaborationMigrationNeed } from '../room-migration.ts';
import { zipDocument } from './document-peer-support.ts';

afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const TEXT = 'Indemnification cap';
const seed = () => zipDocument(`<w:p><w:r><w:t>${TEXT}</w:t></w:r></w:p><w:sectPr/>`);

const sha256Hex = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice())), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

const bodyOf = (docx: Uint8Array) => strFromU8(unzipSync(docx)['word/document.xml']!);
const bodyXml = async (editor: DocxEditorInstance) => bodyOf(new Uint8Array(await editor.save()));

async function until(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Rooms in memory, as a database would hold them, shared by every server of a test. */
function memoryStorage() {
  const rooms = new Map<string, StoredCollaborationRoom>();
  const backups = new Map<string, Uint8Array>();
  const storage: CollaborationRoomStorage = {
    load: (name) => rooms.get(name) ?? null,
    save: (name, room) => {
      rooms.set(name, {
        state: room.state,
        export: room.export ?? rooms.get(name)?.export ?? null,
      });
    },
    backUp: (name, state) => {
      backups.set(name, state);
    },
  };
  return { storage, rooms, backups };
}

/**
 * A room server over Bun. Hocuspocus's own `Server` runs on the Node.js WebSocket adapter,
 * which refuses Bun; this is the same wiring over Bun's server.
 */
function startServer(storage: CollaborationRoomStorage, exportIntervalMs = 0) {
  const events: CollaborationServerEvent[] = [];
  const hocuspocus = new Hocuspocus({
    extensions: [
      collaborationServerExtension({
        storage,
        exportIntervalMs,
        onEvent: (event) => events.push(event),
      }),
    ],
    quiet: true,
    debounce: 50,
    maxDebounce: 200,
  });
  type Socket = { request: Request; connection?: ReturnType<Hocuspocus['handleConnection']> };
  const server = Bun.serve<Socket>({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request, bun) {
      return bun.upgrade(request, { data: { request } }) ? undefined : new Response('ok');
    },
    websocket: {
      open(socket) {
        socket.data.connection = hocuspocus.handleConnection(
          socket as never,
          socket.data.request as never
        );
      },
      message(socket, message) {
        socket.data.connection?.handleMessage(
          typeof message === 'string' ? new TextEncoder().encode(message) : new Uint8Array(message)
        );
      },
      close(socket, code, reason) {
        socket.data.connection?.handleClose({ code, reason });
      },
    },
  });
  return {
    url: `ws://127.0.0.1:${server.port}`,
    events,
    async stop() {
      hocuspocus.closeConnections();
      await server.stop(true);
    },
  };
}

/** Editors and rooms a test opened, destroyed together. */
function workspace() {
  const rooms: HocuspocusCollaborationRoom[] = [];
  const editors: DocxEditorInstance[] = [];
  return {
    async join(url: string, roomId: string, name: string, create = false) {
      const room = await createHocuspocusCollaboration({
        url,
        roomId,
        identity: { actorId: `${name}-actor`, name },
        bootstrap: create ? { kind: 'create', document: seed() } : { kind: 'join' },
      });
      rooms.push(room);
      const container = document.createElement('div');
      document.body.append(container);
      const editor = createDocxEditor({
        container,
        document: room.document,
        modules: [collaborationModule({ session: room.session })],
      });
      editors.push(editor);
      return { room, editor };
    },
    close() {
      for (const editor of editors.splice(0)) editor.destroy();
      for (const room of rooms.splice(0)) room.destroy();
    },
  };
}

test('two editors converge, and the room is stored with an export of its state', async () => {
  const memory = memoryStorage();
  const server = startServer(memory.storage);
  const desk = workspace();
  const roomId = createCollaborationRoomId();
  try {
    const alice = await desk.join(server.url, roomId, 'Alice', true);
    const bob = await desk.join(server.url, roomId, 'Bob');

    // Concurrent edits from both editors converge, and so does an undo.
    expect(alice.editor.exec({ type: 'insertText', text: 'LEFT' }).ok).toBe(true);
    expect(bob.editor.exec({ type: 'insertText', text: 'RIGHT' }).ok).toBe(true);
    await until(
      async () => (await bodyXml(alice.editor)) === (await bodyXml(bob.editor)),
      'concurrent edits to converge'
    );
    expect(await bodyXml(alice.editor)).toContain('LEFT');
    expect(await bodyXml(alice.editor)).toContain('RIGHT');
    expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
    await until(
      async () =>
        (await bodyXml(bob.editor)) === (await bodyXml(alice.editor)) &&
        !(await bodyXml(bob.editor)).includes('LEFT'),
      'the undo to reach the other editor'
    );

    // The server stored the room with an export of exactly the stored state.
    await until(async () => {
      const stored = memory.rooms.get(roomId);
      return (
        !!stored?.export &&
        stored.export.stateDigest === (await sha256Hex(stored.state)) &&
        bodyOf(stored.export.docx).includes('RIGHT') &&
        !bodyOf(stored.export.docx).includes('LEFT')
      );
    }, 'the stored export to hold the converged document');
    expect(server.events).toEqual([]);
  } finally {
    desk.close();
    await server.stop();
  }
}, 30_000);

test('the store after the last editor leaves exports, whatever the export interval', async () => {
  const memory = memoryStorage();
  const server = startServer(memory.storage, 3_600_000);
  const desk = workspace();
  const roomId = createCollaborationRoomId();
  const current = async () => {
    const stored = memory.rooms.get(roomId);
    return !!stored?.export && stored.export.stateDigest === (await sha256Hex(stored.state));
  };
  try {
    const alice = await desk.join(server.url, roomId, 'Alice', true);
    await until(current, 'the first store to export');
    expect(alice.editor.exec({ type: 'insertText', text: 'LATE' }).ok).toBe(true);
    // Stores inside the interval write the state and leave the export stale.
    await until(async () => !!memory.rooms.get(roomId) && !(await current()), 'a stale export');
    desk.close();
    await until(
      async () =>
        (await current()) && bodyOf(memory.rooms.get(roomId)!.export!.docx).includes('LATE'),
      'the last store to export the document'
    );
  } finally {
    desk.close();
    await server.stop();
  }
}, 30_000);

test('a stored room survives a server restart, and a late editor reads it', async () => {
  const memory = memoryStorage();
  const desk = workspace();
  const roomId = createCollaborationRoomId();
  const first = startServer(memory.storage);
  try {
    const alice = await desk.join(first.url, roomId, 'Alice', true);
    expect(alice.editor.exec({ type: 'insertText', text: 'KEPT' }).ok).toBe(true);
    await until(
      () => bodyOf(memory.rooms.get(roomId)?.export?.docx ?? seed()).includes('KEPT'),
      'the edit to reach storage'
    );
  } finally {
    desk.close();
    await first.stop();
  }

  const second = startServer(memory.storage);
  try {
    const carol = await desk.join(second.url, roomId, 'Carol');
    expect(await bodyXml(carol.editor)).toContain('KEPT');
    expect(second.events).toEqual([]);
  } finally {
    desk.close();
    await second.stop();
  }
}, 30_000);

test('a room of an earlier format upgrades on load, and two editors then edit it', async () => {
  const memory = memoryStorage();
  const desk = workspace();
  const roomId = createCollaborationRoomId();
  const before = startServer(memory.storage);
  try {
    const alice = await desk.join(before.url, roomId, 'Alice', true);
    expect(alice.editor.exec({ type: 'insertText', text: 'EARLIER' }).ok).toBe(true);
    await until(
      () => bodyOf(memory.rooms.get(roomId)?.export?.docx ?? seed()).includes('EARLIER'),
      'the edit to reach storage'
    );
  } finally {
    desk.close();
    await before.stop();
  }

  // Make the stored room one that an earlier build wrote: the same state under an earlier
  // format, with the export that build made from it.
  const stored = memory.rooms.get(roomId)!;
  const room = new Y.Doc();
  Y.applyUpdate(room, stored.state);
  room
    .getMap('docx-package-meta-v1')
    .set('sharedSchemaVersion', DOCUMENT_COLLABORATION_VERSIONS.sharedSchemaVersion - 1);
  const earlierState = Y.encodeStateAsUpdate(room);
  room.destroy();
  expect(collaborationMigrationNeed(earlierState)).toBe('earlier-format');
  memory.rooms.set(roomId, {
    state: earlierState,
    export: { docx: stored.export!.docx, stateDigest: await sha256Hex(earlierState) },
  });

  const after = startServer(memory.storage);
  try {
    const bob = await desk.join(after.url, roomId, 'Bob');
    const carol = await desk.join(after.url, roomId, 'Carol');
    expect(await bodyXml(bob.editor)).toContain('EARLIER');
    expect(after.events.map((event) => event.type)).toEqual(['room-upgraded']);
    expect(after.events[0]).toMatchObject({ roomName: roomId, to: COLLABORATION_FORMAT_VERSION });
    // The earlier state is kept, and storage holds a room of this build's format.
    expect(memory.backups.get(roomId)).toEqual(earlierState);
    expect(collaborationMigrationNeed(memory.rooms.get(roomId)!.state)).toBe('current');

    // The upgraded room is an ordinary room: concurrent edits and undo converge.
    expect(bob.editor.exec({ type: 'insertText', text: 'BOBTEXT' }).ok).toBe(true);
    expect(carol.editor.exec({ type: 'insertText', text: 'CAROLTEXT' }).ok).toBe(true);
    await until(
      async () =>
        (await bodyXml(bob.editor)) === (await bodyXml(carol.editor)) &&
        (await bodyXml(bob.editor)).includes('BOBTEXT') &&
        (await bodyXml(bob.editor)).includes('CAROLTEXT'),
      'edits in the upgraded room to converge'
    );
    expect(bob.editor.exec({ type: 'undo' }).ok).toBe(true);
    await until(
      async () =>
        (await bodyXml(carol.editor)) === (await bodyXml(bob.editor)) &&
        !(await bodyXml(carol.editor)).includes('BOBTEXT'),
      'the undo to reach the other editor'
    );
    await until(
      () => bodyOf(memory.rooms.get(roomId)!.export!.docx).includes('CAROLTEXT'),
      'the upgraded room to be stored with a new export'
    );
  } finally {
    desk.close();
    await after.stop();
  }
}, 30_000);

test('a client that names another format, or none, is refused before it syncs', async () => {
  const memory = memoryStorage();
  const server = startServer(memory.storage);
  const roomId = createCollaborationRoomId();
  const refusedWith = (url: string) =>
    new Promise<string>((resolve, reject) => {
      const provider = new HocuspocusProvider({
        url,
        name: roomId,
        document: new Y.Doc(),
        token: 'token',
        onAuthenticationFailed: ({ reason }) => {
          provider.destroy();
          resolve(reason);
        },
        onSynced: () => {
          provider.destroy();
          reject(new Error('the client synced'));
        },
      });
    });
  try {
    expect(await refusedWith(server.url)).toBe('collaboration-format-mismatch');
    expect(
      await refusedWith(
        `${server.url}?${COLLABORATION_FORMAT_PARAMETER}=docx-collaboration:0.0.0.0`
      )
    ).toBe('collaboration-format-mismatch');
    // Nothing loaded or stored a room for a client that was never admitted.
    expect(memory.rooms.size).toBe(0);
  } finally {
    await server.stop();
  }
}, 30_000);
