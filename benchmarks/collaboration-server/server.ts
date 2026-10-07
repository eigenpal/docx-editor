// The Hocuspocus room server under test.
//
// It does the work a production deployment does on every room:
//   - authenticate each connection and refuse incompatible collaboration formats
//   - hold the shared `Y.Doc` while participants are connected
//   - store the room, and export it as DOCX, each time Hocuspocus persists it
//
// The server never parses OOXML on the edit path. The DOCX export in `onStoreDocument` is the
// only document-aware work, and Hocuspocus debounces it.
//
// Hocuspocus v4 targets Node, so the runner starts this file with Node 22.18 or later.
// Settings come from the environment: PORT, BENCH_TOKEN, BENCH_DATA_DIR, and BENCH_COMPACT_GAIN
// (the size ratio past which a room is compacted when it loads; default 2).

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Server } from '@hocuspocus/server';
import {
  assertCollaborationFormatCompatibility,
  CollaborationSchemaError,
  checkCollaborationRoomGeneration,
  compactCollaborationState,
  prepareCollaborationServerDocument,
  readCollaborationDocument,
} from '@docx-editor.dev/pro/collaboration';
import * as Y from 'yjs';

const PORT = Number(process.env.PORT ?? 1234);
const TOKEN = process.env.BENCH_TOKEN ?? 'benchmark-token';
const DATA_DIR = process.env.BENCH_DATA_DIR ?? path.join(import.meta.dirname, '.data');
const ROOM_ID = /^[A-Za-z0-9_-]{24,256}$/;
/** When set, each store appends its sizes and the DOCX export time here, for disk figures. */
const STORE_LOG = process.env.BENCH_STORE_LOG;

function refusal(reason: string): Error & { readonly reason: string } {
  // Hocuspocus v4 sends `.reason` in its permission-denied message.
  return Object.assign(new Error(reason), { reason });
}

function roomFile(documentName: string): string | null {
  return ROOM_ID.test(documentName) ? path.join(DATA_DIR, `${documentName}.ydoc`) : null;
}

const server = new Server({
  port: PORT,
  name: 'docx-editor-collaboration-benchmark',
  quiet: true,

  async onAuthenticate({ token, documentName }) {
    if (!ROOM_ID.test(documentName)) throw refusal('unknown room');
    let envelope: { token?: unknown; collaborationVersion?: unknown };
    try {
      envelope = JSON.parse(token) as typeof envelope;
    } catch {
      throw refusal('invalid token');
    }
    if (envelope?.token !== TOKEN) throw refusal('invalid token');
    try {
      assertCollaborationFormatCompatibility(envelope.collaborationVersion);
    } catch (error) {
      if (error instanceof CollaborationSchemaError) throw refusal(error.code);
      throw error;
    }
    return { room: documentName };
  },

  async onLoadDocument({ documentName, document }) {
    // First, before any update reaches it, so the server never writes a change of its own.
    prepareCollaborationServerDocument(document);
    const file = roomFile(documentName);
    if (!file) return document;
    const stored = await readFile(file).catch(() => null);
    if (!stored) return document;
    // Nobody is connected yet: a room grown well past its content becomes a new generation.
    const compacted = await compactCollaborationState(new Uint8Array(stored), {
      minimumGain: Number(process.env.BENCH_COMPACT_GAIN ?? 2),
    }).catch(() => null);
    if (compacted) await writeFile(file, compacted);
    Y.applyUpdate(document, compacted ?? new Uint8Array(stored));
    return document;
  },

  // A client holding a generation from before a compaction is refused before it merges.
  async beforeHandleMessage(payload) {
    checkCollaborationRoomGeneration(payload);
  },

  async onStoreDocument({ documentName, document }) {
    const file = roomFile(documentName);
    if (!file) return;
    await mkdir(DATA_DIR, { recursive: true });
    const state = Y.encodeStateAsUpdate(document);
    await writeFile(file, state);
    let docxBytes = 0;
    const exportStarted = performance.now();
    try {
      const docx = readCollaborationDocument(document);
      docxBytes = docx.byteLength;
      await writeFile(`${file}.docx`, docx);
    } catch (error) {
      console.warn(`[room ${documentName}] no .docx export: ${(error as Error).message}`);
    }
    if (STORE_LOG) {
      const line = {
        t: performance.timeOrigin + performance.now(),
        roomBytes: state.byteLength,
        docxBytes,
        exportMs: performance.now() - exportStarted,
      };
      await appendFile(STORE_LOG, `${JSON.stringify(line)}\n`);
    }
  },
});

await server.listen();
console.log(`Hocuspocus is listening on ws://127.0.0.1:${PORT}`);
