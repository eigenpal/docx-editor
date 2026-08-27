// A Hocuspocus room server for the docx-editor collaboration replica.
//
// The client uses `useHocuspocusCollaboration`, which owns a `Y.Doc` and an
// `@hocuspocus/provider`. This file is the other end of that socket: it authenticates the
// connection, holds the shared document while people are in the room, and writes it to disk
// so the room survives a restart.
//
// The server never parses OOXML. What travels the socket is the Yjs replica of the canonical
// package, and Hocuspocus treats it as an opaque `Y.Doc`.
//
// Run it with Node 22.18 or later: `node server/server.ts`. Node strips the types.
// Hocuspocus v4 targets Node, not Bun.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Server } from '@hocuspocus/server';
import { readCollaborationDocument } from '@docx-editor.dev/pro/collaboration';
import * as Y from 'yjs';

const PORT = Number(process.env.PORT ?? 1234);

/**
 * The shared secret the demo client sends as its Hocuspocus token.
 *
 * A real server verifies a signed token here and derives the user from it. See the note on
 * `onAuthenticate` below.
 */
const TOKEN = process.env.COLLAB_TOKEN ?? 'demo-token';

const DATA_DIR = path.join(import.meta.dirname, '.data');

/**
 * The room id shape `@docx-editor.dev/pro` validates, repeated here.
 *
 * `documentName` is whatever the client asked for, so it is untrusted: it reaches a file path
 * below. This test admits no `.`, no `/`, and no `\`, which is what keeps a room out of a
 * directory the server did not choose.
 */
const ROOM_ID = /^[A-Za-z0-9_-]{24,256}$/;

function roomFile(documentName: string): string | null {
  if (!ROOM_ID.test(documentName)) return null;
  return path.join(DATA_DIR, `${documentName}.ydoc`);
}

const server = new Server({
  port: PORT,
  name: 'docx-editor-collaboration',

  /**
   * Every connection is queued until this resolves, so nothing reaches a document before the
   * server has admitted the client.
   *
   * The demo checks one shared secret. A real deployment verifies a signed token and returns
   * the user it names as the connection context. Do that and the client's display name stops
   * being the authority on who someone is — this demo trusts it, because there is nobody to
   * ask.
   */
  async onAuthenticate({ token, documentName }) {
    if (!ROOM_ID.test(documentName)) throw new Error('unknown room');
    if (token !== TOKEN) throw new Error('invalid token');
    return { room: documentName };
  },

  /** Seed a newly opened room from disk. A room nobody has saved yet stays empty. */
  async onLoadDocument({ documentName, document }) {
    const file = roomFile(documentName);
    if (!file) return document;
    const stored = await readFile(file).catch(() => null);
    if (stored) Y.applyUpdate(document, new Uint8Array(stored));
    return document;
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
    await writeFile(file, Y.encodeStateAsUpdate(document));
    try {
      await writeFile(`${file}.docx`, readCollaborationDocument(document));
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
});

await server.listen();
console.log(`Hocuspocus is listening on ws://127.0.0.1:${PORT}`);
console.log(`Rooms are stored in ${DATA_DIR}`);
