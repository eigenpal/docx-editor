// Where the demo server keeps each room, shared by the server and the migration scripts.

import { rename, writeFile } from 'node:fs/promises';
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

/** Write through a temporary file, so a crash mid-write keeps the previous room state. */
export async function writeAtomically(file: string, bytes: Uint8Array): Promise<void> {
  await writeFile(`${file}.tmp`, bytes);
  await rename(`${file}.tmp`, file);
}
