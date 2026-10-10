// Where the demo server keeps each room, shared by the server and the migration scripts.

import { createHash, randomBytes } from 'node:crypto';
import { open, rename } from 'node:fs/promises';
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
 * Write through a temporary file, so a crash or a power loss mid-write keeps the previous
 * room state: the bytes reach the disk before the rename, and the rename before this returns.
 */
export async function writeAtomically(file: string, bytes: Uint8Array): Promise<void> {
  // A name of its own: two writes of one room at once must not share a temporary file.
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const handle = await open(temporary, 'w');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
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
