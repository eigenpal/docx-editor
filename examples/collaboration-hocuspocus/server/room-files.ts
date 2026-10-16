// Where the demo server keeps each room, shared by the server and the migration scripts.

import { createHash, randomBytes } from 'node:crypto';
import { access, link, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export const DATA_DIR = path.join(import.meta.dirname, '.data');

/**
 * The room id shape `@docx-editor.dev/pro` validates, repeated here.
 *
 * `documentName` is whatever the client asked for, so it is untrusted: it reaches a file path
 * below. This test admits no `.`, no `/`, and no `\`, which is what keeps a room out of a
 * directory the server did not choose.
 */
export const ROOM_ID = /^[A-Za-z0-9_-]{24,256}$/;

export function roomFile(documentName: string): string | null {
  if (!ROOM_ID.test(documentName)) return null;
  return path.join(DATA_DIR, `${documentName}.ydoc`);
}

/**
 * The record that a room exists, written once when the server creates the room and kept
 * apart from its state. A known room whose state is missing is an error, never a new room:
 * seeding it again would replace every edit with the original document. A real deployment
 * keeps this record in its database, next to the document the room edits.
 */
export function roomRecordFile(documentName: string): string | null {
  if (!ROOM_ID.test(documentName)) return null;
  return path.join(DATA_DIR, `${documentName}.room`);
}

/** Whether the server knows the room: it has the room's record or its state. */
export async function roomIsKnown(documentName: string): Promise<boolean> {
  const files = [roomRecordFile(documentName), roomFile(documentName)];
  for (const file of files) {
    if (
      file &&
      (await access(file).then(
        () => true,
        () => false
      ))
    )
      return true;
  }
  return false;
}

/**
 * Write a file that must not exist yet, through a temporary file, so a reader sees nothing or
 * the complete bytes. Resolves false, and leaves the existing file alone, when the file
 * exists: another load created it first.
 */
export async function writeNewFile(file: string, bytes: Uint8Array): Promise<boolean> {
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeDurably(temporary, bytes, 'wx');
    // `link` fails with EEXIST when the file exists, so two creators cannot both win.
    await link(temporary, file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  } finally {
    // Whatever happened, the temporary name goes: after a link the file keeps the bytes.
    await unlink(temporary).catch(() => undefined);
  }
}

/** Write `bytes` to a new file and wait for them to reach the disk. */
async function writeDurably(file: string, bytes: Uint8Array, flags: 'w' | 'wx'): Promise<void> {
  const handle = await open(file, flags);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Write through a temporary file, so a crash or a power loss mid-write keeps the previous
 * room state: the bytes reach the disk before the rename, and the rename before this returns.
 */
export async function writeAtomically(file: string, bytes: Uint8Array): Promise<void> {
  // A name of its own: two writes of one room at once must not share a temporary file.
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeDurably(temporary, bytes, 'w');
    await rename(temporary, file);
  } catch (error) {
    // A failed write must not leave its temporary file behind.
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  // The rename reaches the disk with its directory. Windows cannot open a directory to sync it,
  // and makes a rename durable without that.
  const directory = await open(path.dirname(file), 'r').catch(() => null);
  if (!directory) return;
  try {
    await directory.sync();
  } catch {
    // Some file systems refuse to sync a directory; the file itself is already on disk.
  } finally {
    await directory.close();
  }
}

/** A digest of saved room state, which ties an export to the state it was exported from. */
export function stateDigest(state: Uint8Array): string {
  return createHash('sha256').update(state).digest('hex');
}
