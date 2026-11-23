// Room storage for `collaborationServerExtension`, over the files in `.data`.
//
// Each room is three files. `<room>.ydoc` is the room state. `<room>.ydoc.docx` is an export
// of it, and `<room>.ydoc.docx.sha256` is the digest of the state that the export was made
// from. Every build reads a `.docx`, so a server with another collaboration format creates the
// room again from the export when it loads the room. The digest tells it whether the export
// belongs to the stored state.
//
// A real deployment keeps the same three values in a database row or in object storage.
import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CollaborationRoomExport,
  CollaborationRoomStorage,
} from '@docx-editor.dev/pro/collaboration';
import { admissionError } from '../shared/admission.ts';
import { DATA_DIR, ROOM_ID, writeAtomically, writeNewFile } from './room-files.ts';

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false
  );

/** A file's bytes, or null when the file does not exist. */
async function readOptional(file: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Room storage in `dataDir`.
 *
 * `roomName` is whatever the client asked for, so it is untrusted, and it reaches a file path
 * here. A name that is not a room ID has no file: it loads as no room, and it is not stored.
 */
export function createRoomStorage(dataDir: string = DATA_DIR): CollaborationRoomStorage {
  const stateFile = (roomName: string) =>
    ROOM_ID.test(roomName) ? path.join(dataDir, `${roomName}.ydoc`) : null;
  const recordFile = (file: string) => file.replace(/\.ydoc$/, '.room');
  const exportFile = (file: string) => `${file}.docx`;
  const digestFile = (file: string) => `${file}.docx.sha256`;
  /** The state an upgrade replaced, kept until you accept the upgrade. */
  const previousFile = (file: string) => `${file}.previous`;

  /**
   * Write the room's record if it has none. A room with state gets one on each load and each
   * store, so a stop between the state write and the record write leaves no room without one.
   */
  const recordRoom = async (file: string): Promise<void> => {
    await writeNewFile(recordFile(file), new TextEncoder().encode(new Date().toISOString()));
  };

  const readExport = async (file: string): Promise<CollaborationRoomExport | null> => {
    const [docx, digest] = await Promise.all([
      readOptional(exportFile(file)),
      readOptional(digestFile(file)),
    ]);
    if (!docx || !digest) return null;
    return { docx, stateDigest: new TextDecoder().decode(digest).trim() };
  };

  return {
    async load(roomName) {
      const file = stateFile(roomName);
      if (!file) return null;
      let state: Uint8Array | null;
      try {
        state = await readOptional(file);
      } catch (error) {
        console.warn(`[room ${roomName}] saved room unavailable: ${(error as Error).message}`);
        throw admissionError('saved-room-unavailable');
      }
      if (!state) {
        // A room the server knows, whose state is missing, is an error and never a new room:
        // creating it again would replace every edit with the original document.
        if (await exists(recordFile(file))) {
          console.warn(`[room ${roomName}] the room is known, but its state is missing`);
          throw admissionError('saved-room-unavailable');
        }
        return null;
      }
      await recordRoom(file);
      // An export that cannot be read is no export: the room loads, and cannot upgrade.
      return { state, export: await readExport(file).catch(() => null) };
    },

    async save(roomName, room) {
      const file = stateFile(roomName);
      if (!file) throw new Error('The room name is not a room ID.');
      await mkdir(dataDir, { recursive: true });
      // The state first. If the server stops between the writes, the digest names a state
      // that is not the stored one. The export is then not used, and the next load of the
      // room replaces it.
      await writeAtomically(file, room.state);
      await recordRoom(file);
      if (room.export) {
        await writeAtomically(exportFile(file), room.export.docx);
        await writeAtomically(digestFile(file), new TextEncoder().encode(room.export.stateDigest));
      }
    },

    async backUp(roomName, state) {
      const file = stateFile(roomName);
      if (!file) throw new Error('The room name is not a room ID.');
      await writeAtomically(previousFile(file), state);
    },
  };
}
