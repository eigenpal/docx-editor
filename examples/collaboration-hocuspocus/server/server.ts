// A Hocuspocus room server for the docx-editor collaboration replica.
//
// The client uses `useHocuspocusCollaboration`, which owns a `Y.Doc` and an
// `@hocuspocus/provider`. This file is the other end of that socket: it authenticates the
// connection, holds the shared document while people are in the room, and writes it to disk
// so the room survives a restart.
//
// What travels the socket is the Yjs replica of the canonical package, and Hocuspocus treats
// it as an opaque `Y.Doc`. The server reads OOXML in two places only: it seeds a new room from
// the demo document, and it exports each stored room as a `.docx` file.
//
// `collaborationServerExtension` does the room's part: it refuses a client of another collaboration
// format, prepares the room document, refuses a replica of an earlier room generation, checks
// a saved room before it loads, and stores each room with its export. With that export, a
// server of a later collaboration format upgrades the room when it loads it.
//
// Run it with Node 22.18 or later: `node server/server.ts`. Node strips the types.
// Hocuspocus v4 targets Node, not Bun.

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Server } from '@hocuspocus/server';
import {
  CollaborationSchemaError,
  createCollaborationState,
  collaborationServerExtension,
  type CollaborationServerEvent,
  type CreateCollaborationRoomRequest,
} from '@docx-editor.dev/pro/collaboration';
import {
  requireBearerToken,
  serveMetrics,
  withCollaborationTelemetry,
} from '@docx-editor.dev/telemetry/hocuspocus';
import { prometheusRegistry } from '@docx-editor.dev/telemetry/prometheus';
import { admissionError, authenticateDemoToken } from '../shared/admission.ts';
import { DATA_DIR, ROOM_ID, roomIsKnown } from './room-files.ts';
import { createRoomStorage } from './room-storage.ts';

const PORT = Number(process.env.PORT ?? 1234);

/** The document every new room starts from: the one the app serves as `/sample.docx`. */
const SEED_FILE = path.join(import.meta.dirname, '../../vite/public/sample.docx');

/**
 * The largest document, expanded, this server seeds a room from. Seeding costs about a second
 * of CPU for each MiB of expanded XML, so a public server keeps this small.
 */
const SEED_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The shared secret the demo client sends as its Hocuspocus token.
 *
 * A real server verifies a signed token here and derives the user from it. See the note on
 * `onAuthenticate` below.
 */
const TOKEN = process.env.COLLAB_TOKEN ?? 'demo-token';

/**
 * Room telemetry: rooms, connections, people, room memory, and why connections were refused.
 * Prometheus scrapes `/metrics`; `/rooms` lists each room's size. No room name reaches a
 * metric. Protect both paths in a real deployment, as you protect other operational endpoints.
 */
const metrics = prometheusRegistry();

/**
 * The state of a new room, seeded from the demo document. The collaboration extension stores it
 * before anyone syncs, so a restart loads this room instead of seeding another.
 *
 * The server seeds a new room itself. A participant could seed it instead, but Hocuspocus
 * sends every update to every connection, the sender included: that participant would upload
 * the whole document and then download it again. A real server looks up the document a room
 * edits in its own storage.
 *
 * A seed refused by the library reaches the client as its failure code, such as
 * `baseline-too-large`, at once, not as a join that times out. Seeding holds this thread for
 * a while on a large document; a real server seeds in a worker with a concurrency limit.
 */
async function createRoom({ roomName, context }: CreateCollaborationRoomRequest) {
  // Only the tab that starts a room may create it; `onAuthenticate` put that in the context.
  if ((context as { createRoom?: boolean }).createRoom !== true) {
    throw admissionError('unknown-room');
  }
  try {
    await mkdir(DATA_DIR, { recursive: true });
    return await createCollaborationState(new Uint8Array(await readFile(SEED_FILE)), {
      documentId: roomName,
      maxBytes: SEED_MAX_BYTES,
    });
  } catch (error) {
    console.warn(`[room ${roomName}] no seed: ${(error as Error).message}`);
    // An unreadable seed file is a document that cannot open, as a refused one is.
    throw admissionError(
      error instanceof CollaborationSchemaError ? error.code : 'invalid-baseline'
    );
  }
}

/** What the server did to a room. Events hold positions and codes, never document text. */
function logRoomEvent(event: CollaborationServerEvent): void {
  if (event.type === 'room-upgraded') {
    console.log(`[room ${event.roomName}] upgraded from ${event.from} to ${event.to}`);
  } else if (event.type === 'room-upgrade-refused') {
    console.warn(`[room ${event.roomName}] not upgraded: ${event.reason} ${event.code ?? ''}`);
  } else if (event.type === 'room-export-failed') {
    console.warn(`[room ${event.roomName}] not stored, no .docx export: ${event.code}`);
  } else {
    console.warn(`[room ${event.roomName}] ${event.type}: ${event.code}`);
  }
}

const { config, rooms } = withCollaborationTelemetry(
  {
    port: PORT,
    name: 'docx-editor-collaboration',
    /**
     * Every connection is queued until this resolves, so nothing reaches a document before the
     * server has admitted the client.
     *
     * The demo checks a shared secret and compatible versions before sync. Version claims
     * prevent accidental mixed-client rooms; they do not authenticate the client build.
     * A real deployment verifies a signed token and returns
     * the user it names as the connection context. Do that and the client's display name stops
     * being the authority on who someone is — this demo trusts it, because there is nobody to
     * ask.
     */
    async onAuthenticate({ token, documentName }) {
      if (!ROOM_ID.test(documentName)) throw admissionError('unknown-room');
      const { createRoom } = authenticateDemoToken(token, TOKEN);
      // Only the tab that starts a room may create it. An invite link to a room the server
      // does not know is refused here, before the room loads.
      if (!createRoom && !(await roomIsKnown(documentName))) throw admissionError('unknown-room');
      return { room: documentName, createRoom };
    },

    async onConnect({ documentName }) {
      console.log(`[room ${documentName}] client connected`);
    },

    async onDisconnect({ documentName, clientsCount }) {
      console.log(`[room ${documentName}] client left, ${clientsCount} remaining`);
    },
    // The room's part of the server. It runs before the hooks below.
    extensions: [
      collaborationServerExtension({
        storage: createRoomStorage(),
        createRoom,
        // A saved room at least twice the size of a fresh build of its content is compacted
        // when it loads: nobody is connected yet, so no edit is in flight.
        compactOnLoad: true,
        onEvent: logRoomEvent,
      }),
    ],
  },
  {
    exporters: [metrics],
    // The demo's admission refusal says "invalid token"; count it under a stable label.
    reasonOf: (error) =>
      (error as { reason?: unknown } | null)?.reason === 'invalid token'
        ? 'unauthorized'
        : undefined,
  }
);

const server = new Server({
  ...config,
  // `/metrics` holds counts only. The room list is served only with a scrape token set.
  onRequest: serveMetrics(
    metrics,
    process.env.METRICS_TOKEN
      ? {
          rooms: { telemetry: rooms, path: '/rooms' },
          authorize: requireBearerToken(process.env.METRICS_TOKEN),
        }
      : {}
  ),
});

await server.listen();
console.log(`Hocuspocus is listening on ws://127.0.0.1:${PORT}`);
console.log(`Rooms are stored in ${DATA_DIR}`);
console.log(`Metrics: http://127.0.0.1:${PORT}/metrics (set METRICS_TOKEN to serve /rooms)`);
