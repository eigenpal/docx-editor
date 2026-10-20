/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two editors in one room on a real Hocuspocus server over WebSockets. The server wrapper counts
// the room, its connections, its people, and its memory; the client telemetry reports each
// editor's status and people; concurrent edits and undo converge; and neither side carries the
// room name, a person, or the text.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import * as Y from 'yjs';
import { Hocuspocus } from '@hocuspocus/server';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  checkCollaborationRoomGeneration,
  collaborationModule,
  compactCollaborationState,
} from '@docx-editor.dev/pro/collaboration';
import {
  createCollaborationRoomId,
  createHocuspocusCollaboration,
  type HocuspocusCollaborationRoom,
} from '@docx-editor.dev/pro/collaboration/hocuspocus';
import { createTelemetry, memoryExporter, type MemoryExporter } from '../index.ts';
import { withCollaborationTelemetry } from '../hocuspocus/index.ts';
import { prometheusRegistry } from '../prometheus/index.ts';

const SECRET = 'Indemnification cap';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function docx(text: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

async function until(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const bodyXml = async (editor: DocxEditorInstance) =>
  strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);

test('two editors on a real server: room metrics, client events, convergence, no leaks', async () => {
  const saved = new Map<string, Uint8Array>();
  const serverMetrics = prometheusRegistry();
  const { config, rooms } = withCollaborationTelemetry(
    {
      async onLoadDocument({ documentName, document }) {
        const state = saved.get(documentName);
        if (state) Y.applyUpdate(document, state);
      },
      async onStoreDocument({ documentName, document }) {
        saved.set(documentName, Y.encodeStateAsUpdate(document));
      },
    },
    { exporters: [serverMetrics], sampleInterval: false }
  );
  const hocuspocus = new Hocuspocus({ ...config, quiet: true, debounce: 50, maxDebounce: 200 });
  // Hocuspocus's own Server runs on the Node.js WebSocket adapter, which refuses Bun. This is the
  // same wiring over Bun's server: one Hocuspocus connection per socket.
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
  const url = `ws://127.0.0.1:${server.port}`;
  const roomId = createCollaborationRoomId();

  const opened: HocuspocusCollaborationRoom[] = [];
  const editors: DocxEditorInstance[] = [];
  const clientEvents = memoryExporter();
  const clientMetrics = prometheusRegistry();
  const telemetry = createTelemetry({
    exporters: [clientEvents, clientMetrics],
    include: { collaborationClient: true, editing: true },
    dedupeWindowMs: 0,
  });
  const mount = (room: HocuspocusCollaborationRoom) => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: room.document,
      modules: [collaborationModule({ session: room.session }), telemetry.module],
    });
    editors.push(editor);
    return editor;
  };
  try {
    const alice = await createHocuspocusCollaboration({
      url,
      roomId,
      identity: { actorId: 'alice-actor', name: 'Alice Example' },
      bootstrap: { kind: 'create', document: docx(SECRET) },
    });
    opened.push(alice);
    const bob = await createHocuspocusCollaboration({
      url,
      roomId,
      identity: { actorId: 'bob-actor', name: 'Bob Example' },
      bootstrap: { kind: 'join' },
    });
    opened.push(bob);
    const left = mount(alice);
    const right = mount(bob);

    // The server sees one room with two connections and two people, and the room's memory.
    await until(() => {
      rooms.sample();
      const [room] = rooms.list();
      return room?.connections === 2 && room.participants === 2;
    }, 'two people in the room');
    const [stats] = rooms.list();
    expect(stats!.stateBytes).toBeGreaterThan(0);
    const scraped = serverMetrics.metrics();
    expect(scraped).toContain('docx_editor_collab_rooms_active 1');
    expect(scraped).toContain('docx_editor_collab_connections_active 2');
    expect(scraped).toContain('docx_editor_collab_participants_active 2');
    expect(scraped).toContain(
      'docx_editor_collab_room_load_duration_seconds_count{outcome="success"} 1'
    );

    // Concurrent edits from both editors converge, and so does an undo.
    expect(left.exec({ type: 'insertText', text: 'L' }).ok).toBe(true);
    expect(right.exec({ type: 'insertText', text: 'R' }).ok).toBe(true);
    await until(
      async () => (await bodyXml(left)) === (await bodyXml(right)),
      'concurrent edits to converge'
    );
    expect(await bodyXml(left)).toContain('L');
    expect(await bodyXml(left)).toContain('R');
    expect(left.exec({ type: 'undo' }).ok).toBe(true);
    await until(
      async () =>
        (await bodyXml(right)) === (await bodyXml(left)) && !(await bodyXml(right)).includes('L'),
      'the undo to reach the other editor'
    );
    await until(() => {
      rooms.sample();
      return /docx_editor_collab_updates_total [1-9]/.test(serverMetrics.metrics());
    }, 'the server to count the edits');

    // Each editor reported its status and the two people.
    const statuses = clientEvents.events.filter((event) => event.kind === 'collab.status');
    expect(statuses.filter((event) => 'status' in event && event.status === 'ready')).toHaveLength(
      2
    );
    const people = clientEvents.events.filter((event) => event.kind === 'collab.participants');
    expect(people.some((event) => 'count' in event && event.count === 2)).toBe(true);

    // One person leaves: the server counts one connection and one person.
    right.destroy();
    bob.destroy();
    await until(() => {
      rooms.sample();
      const [room] = rooms.list();
      return room?.connections === 1 && room.participants === 1;
    }, 'one person left in the room');

    // The room stores, and a person who joins later opens the same document.
    await until(
      () =>
        /docx_editor_collab_room_store_duration_seconds_count\{outcome="success"\} [1-9]/.test(
          serverMetrics.metrics()
        ),
      'the room to store'
    );
    expect(saved.has(roomId)).toBe(true);
    const carol = await createHocuspocusCollaboration({
      url,
      roomId,
      identity: { actorId: 'carol-actor', name: 'Carol Example' },
      bootstrap: { kind: 'join' },
    });
    opened.push(carol);
    const later = mount(carol);
    await until(
      async () => (await bodyXml(later)) === (await bodyXml(left)),
      'the later editor to open the same document'
    );
    expect(await bodyXml(later)).toContain('R');

    // Nothing either side reports names the room, a person, or the text.
    const reported = [
      serverMetrics.metrics(),
      JSON.stringify(rooms.list()),
      clientMetrics.metrics(),
      JSON.stringify(clientEvents.events),
    ].join('\n');
    for (const secret of [SECRET, roomId, 'Alice', 'Bob', 'Carol', 'alice-actor', 'bob-actor']) {
      expect(reported).not.toContain(secret);
    }
  } finally {
    for (const editor of editors) editor.destroy();
    for (const room of opened) room.destroy();
    await telemetry.shutdown();
    await rooms.shutdown();
    await server.stop(true);
    hocuspocus.closeConnections();
  }
}, 30_000);

/** A Hocuspocus room server over Bun, with the generation gate and compaction on demand. */
function startRoomServer() {
  const saved = new Map<string, Uint8Array>();
  const state = { compactNextLoad: false };
  const metrics = prometheusRegistry();
  const { config, rooms } = withCollaborationTelemetry(
    {
      async onLoadDocument({ documentName, document }) {
        let stored = saved.get(documentName);
        if (stored && state.compactNextLoad) {
          state.compactNextLoad = false;
          const compacted = await compactCollaborationState(stored, { minimumGain: 1 });
          if (compacted) saved.set(documentName, (stored = compacted));
        }
        if (stored) Y.applyUpdate(document, stored);
      },
      async beforeHandleMessage(payload) {
        checkCollaborationRoomGeneration(payload);
      },
      async onStoreDocument({ documentName, document }) {
        saved.set(documentName, Y.encodeStateAsUpdate(document));
      },
    },
    { exporters: [metrics], sampleInterval: false }
  );
  const hocuspocus = new Hocuspocus({ ...config, quiet: true, debounce: 50, maxDebounce: 200 });
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
    saved,
    state,
    metrics,
    rooms,
    stop: async () => {
      await server.stop(true);
      hocuspocus.closeConnections();
    },
  };
}

test('two tabs, a delete during an edit, a reconnect, and a compacted room', async () => {
  const server = startRoomServer();
  const roomId = createCollaborationRoomId();
  const opened: HocuspocusCollaborationRoom[] = [];
  const editors: DocxEditorInstance[] = [];
  const clients: { shutdown(): Promise<void> }[] = [];
  const mount = (room: HocuspocusCollaborationRoom) => {
    const events = memoryExporter();
    const telemetry = createTelemetry({
      exporters: [events],
      include: { collaborationClient: true, editing: true },
      dedupeWindowMs: 0,
    });
    clients.push(telemetry);
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: room.document,
      modules: [collaborationModule({ session: room.session }), telemetry.module],
    });
    editors.push(editor);
    return { editor, events };
  };
  const statuses = (events: MemoryExporter) =>
    events.events
      .filter((event) => event.kind === 'collab.status')
      .map((event) => [
        (event as { status: string }).status,
        (event as { code?: string }).code ?? null,
      ]);
  const join = async (actorId: string, name: string, create?: Uint8Array) => {
    const room = await createHocuspocusCollaboration({
      url: server.url,
      roomId,
      identity: { actorId, name },
      bootstrap: create ? { kind: 'create', document: create } : { kind: 'join' },
    });
    opened.push(room);
    return room;
  };
  let restoreLog = () => {};
  try {
    const alice = await join('alice-actor', 'Alice Example', docx(SECRET));
    const bob = await join('bob-actor', 'Bob Example');
    // The same person in a second tab: one more connection, and one more presence.
    const aliceTab = await join('alice-actor', 'Alice Example');
    const left = mount(alice);
    const right = mount(bob);
    const tab = mount(aliceTab);
    await until(() => {
      server.rooms.sample();
      const [room] = server.rooms.list();
      return room?.connections === 3 && room.participants === 3;
    }, 'three connections and three presences');

    // One person deletes the text while another types: all three converge.
    left.editor.exec({ type: 'selectAll' });
    expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'B' }).ok).toBe(true);
    await until(async () => {
      const [a, b, c] = await Promise.all(editors.map(bodyXml));
      return a === b && b === c;
    }, 'the delete and the edit to converge');
    expect(await bodyXml(left.editor)).not.toContain(SECRET);

    // A dropped connection: the server counts it gone, the client reports it, an offline
    // edit merges after the reconnect.
    bob.provider.disconnect();
    await until(
      () => statuses(right.events).some(([status]) => status === 'disconnected'),
      'the disconnect'
    );
    await until(
      () => server.rooms.list()[0]?.connections === 2,
      'the server to see two connections'
    );
    expect(right.editor.exec({ type: 'insertText', text: 'Z' }).ok).toBe(true);
    await bob.provider.connect();
    await until(
      async () => (await bodyXml(left.editor)).includes('Z'),
      'the offline edit to merge'
    );
    await until(
      () => statuses(right.events).at(-1)?.[0] === 'ready',
      'the client to report ready again'
    );
    expect(statuses(right.events).at(-1)).toEqual(['ready', null]);

    // The room is compacted while Bob is away: his reconnect is refused, and both sides say so.
    bob.provider.disconnect();
    for (const editor of [left.editor, tab.editor]) editor.destroy();
    for (const room of [alice, aliceTab]) room.destroy();
    await until(() => server.rooms.list().length === 0, 'the room to unload');
    server.state.compactNextLoad = true;
    // Hocuspocus logs the refusal this step expects.
    const log = console.error;
    console.error = () => {};
    restoreLog = () => (console.error = log);
    void bob.provider.connect();
    await until(
      () =>
        statuses(right.events).some(
          ([status, code]) => status === 'error' && code === 'collab.room-generation-changed'
        ),
      'the client to report the changed generation'
    );
    expect(server.metrics.metrics()).toContain(
      'docx_editor_collab_message_refusals_total{reason="room-generation-changed"}'
    );

    const reported = [
      server.metrics.metrics(),
      JSON.stringify(server.rooms.list()),
      JSON.stringify([...left.events.events, ...right.events.events, ...tab.events.events]),
    ].join('\n');
    for (const secret of [SECRET, roomId, 'Alice', 'Bob', 'alice-actor', 'bob-actor']) {
      expect(reported).not.toContain(secret);
    }
  } finally {
    for (const editor of editors) editor.destroy();
    for (const room of opened) room.destroy();
    for (const client of clients) await client.shutdown();
    await server.rooms.shutdown();
    await server.stop();
    restoreLog();
  }
}, 40_000);
