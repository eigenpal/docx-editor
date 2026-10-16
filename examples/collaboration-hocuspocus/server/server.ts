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
// Run it with Node 22.18 or later: `node server/server.ts`. Node strips the types.
// Hocuspocus v4 targets Node, not Bun.

import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Server } from '@hocuspocus/server';
import {
  CollaborationSchemaError,
  checkCollaborationRoomGeneration,
  compactCollaborationState,
  createCollaborationState,
  prepareCollaborationServerDocument,
  readCollaborationDocument,
} from '@docx-editor.dev/pro/collaboration';
import {
  requireBearerToken,
  serveMetrics,
  withCollaborationTelemetry,
} from '@docx-editor.dev/telemetry/hocuspocus';
import { prometheusRegistry } from '@docx-editor.dev/telemetry/prometheus';
import * as Y from 'yjs';
import { admissionError, authenticateDemoToken } from '../shared/admission.ts';
import { loadStoredDemoDocument } from './stored-room.ts';
import {
  DATA_DIR,
  ROOM_ID,
  roomFile,
  roomIsKnown,
  roomRecordFile,
  writeAtomically,
  writeNewFile,
} from './room-files.ts';

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

/** A room's stored state, or null when it has none. */
async function readStoredRoom(documentName: string, file: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.warn(`[room ${documentName}] saved room unavailable: ${(error as Error).message}`);
    throw admissionError('saved-room-unavailable');
  }
}

/**
 * Build and store a new room. Hocuspocus does not store state applied while it loads a room,
 * so the server writes it here, before anyone syncs: a restart then loads this room instead
 * of seeding another. The write is create-only; if another load created the room first, that
 * room is used.
 *
 * A seed refused by the library reaches the client as its failure code, such as
 * `baseline-too-large`, at once, not as a join that times out. Seeding holds this thread for
 * a while on a large document; a real server seeds in a worker with a concurrency limit.
 */
async function seedNewRoom(documentName: string, file: string): Promise<Uint8Array> {
  let state: Uint8Array;
  try {
    state = await createCollaborationState(new Uint8Array(await readFile(SEED_FILE)), {
      documentId: documentName,
      maxBytes: SEED_MAX_BYTES,
    });
  } catch (error) {
    console.warn(`[room ${documentName}] no seed: ${(error as Error).message}`);
    // An unreadable seed file is a document that cannot open, as a refused one is.
    throw admissionError(
      error instanceof CollaborationSchemaError ? error.code : 'invalid-baseline'
    );
  }
  await mkdir(DATA_DIR, { recursive: true });
  if (!(await writeNewFile(file, state))) {
    const existing = await readStoredRoom(documentName, file);
    if (!existing) throw admissionError('saved-room-unavailable');
    state = existing;
  }
  await recordRoom(documentName);
  return state;
}

/**
 * Write the room's record if it has none. The server also does this when it loads a stored
 * room, so a crash between the state write and the record write leaves no room without one.
 */
async function recordRoom(documentName: string): Promise<void> {
  const record = roomRecordFile(documentName);
  if (
    !record ||
    (await access(record).then(
      () => true,
      () => false
    ))
  )
    return;
  await writeNewFile(record, new TextEncoder().encode(new Date().toISOString()));
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

    /**
     * Load a room from disk, or seed a new one from the demo document.
     *
     * A room that has grown well past its content is compacted first, into a new generation:
     * nobody is connected yet, so no edit is in flight. The new state is stored at once.
     *
     * The server seeds a new room itself. A participant could seed it instead, but Hocuspocus
     * sends every update to every connection, the sender included: that participant would
     * upload the whole document and then download it again. A real server looks up the
     * document a room edits in its own storage.
     *
     * A room the server knows, whose state is missing, is refused with
     * `saved-room-unavailable`. Seeding it again would replace every edit with the original
     * document; refused, participants keep their copies while you restore the state.
     */
    async onLoadDocument({ documentName, document, context }) {
      // First, before any update reaches it, so the server never writes a change of its own.
      prepareCollaborationServerDocument(document);
      const file = roomFile(documentName);
      if (!file) return document;
      const stored = await readStoredRoom(documentName, file);
      if (stored) {
        await recordRoom(documentName);
        const compacted = await compactCollaborationState(stored).catch(() => null);
        if (compacted) await writeAtomically(file, compacted);
        loadStoredDemoDocument(document, compacted ?? stored);
        return document;
      }
      if (await roomIsKnown(documentName)) {
        console.warn(`[room ${documentName}] the room is known, but its state is missing`);
        throw admissionError('saved-room-unavailable');
      }
      if ((context as { createRoom?: boolean }).createRoom !== true) {
        throw admissionError('unknown-room');
      }
      Y.applyUpdate(document, await seedNewRoom(documentName, file));
      return document;
    },

    /**
     * Hocuspocus holds back a small update until its next turn, and then sends it to every
     * connection, which by then includes the first participant. Send the loaded room to nobody
     * now, so that participant receives it once, in its own sync. This hook runs after every
     * `onLoadDocument`, those of extensions included, and before anyone joins.
     */
    async afterLoadDocument({ document }) {
      document.flush();
    },

    /**
     * Refuse a client that still holds a generation of the room from before a compaction, before
     * any of its state merges. It reports `room-generation-changed` and rejoins.
     */
    async beforeHandleMessage(payload) {
      checkCollaborationRoomGeneration(payload);
    },

    /**
     * Persist the room. Hocuspocus debounces this, so a burst of typing writes once.
     *
     * TWO files, because they answer different questions. The `.ydoc` is the room — it is what
     * a joining peer needs, and it is the only one `onLoadDocument` reads back. The `.docx` is
     * what everyone else needs: something you can mail, index, diff or open in Word.
     *
     * `readCollaborationDocument` is how the second one exists at all. The server joins
     * nothing — no identity, no awareness, no session — so this job never appears in the room's
     * participant list, and it cannot write back. A real deployment does this to object storage
     * on a schedule rather than on every debounce.
     */
    async onStoreDocument({ documentName, document }) {
      const file = roomFile(documentName);
      if (!file) return;
      await mkdir(DATA_DIR, { recursive: true });
      await writeAtomically(file, Y.encodeStateAsUpdate(document));
      try {
        await writeAtomically(`${file}.docx`, readCollaborationDocument(document));
      } catch (error) {
        // A room mid-seed, or one two creators polluted, refuses to export. That must not stop
        // the `.ydoc` write above — losing the room is worse than losing one export.
        console.warn(`[room ${documentName}] no .docx export: ${(error as Error).message}`);
      }
    },

    async onConnect({ documentName }) {
      console.log(`[room ${documentName}] client connected`);
    },

    async onDisconnect({ documentName, clientsCount }) {
      console.log(`[room ${documentName}] client left, ${clientsCount} remaining`);
    },
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
