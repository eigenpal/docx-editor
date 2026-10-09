// Export every saved room as a `.docx`, the first step of a room migration.
//
// Run it with the build that created the rooms: only that build can read their format.
// It uses nothing but `readCollaborationDocument`, which every 2.x build has, so it runs
// unchanged with an earlier deployment. Then run `migrate-rooms.ts` with the new build.
//
//   node server/export-rooms.ts

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as Y from 'yjs';
import { readCollaborationDocument } from '@docx-editor.dev/pro/collaboration';
import { DATA_DIR, ROOM_ID, writeAtomically } from './room-files.ts';

let failed = 0;
for (const name of (await readdir(DATA_DIR)).sort()) {
  const room = name.endsWith('.ydoc') ? name.slice(0, -'.ydoc'.length) : null;
  if (!room || !ROOM_ID.test(room)) continue;
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, new Uint8Array(await readFile(path.join(DATA_DIR, name))));
    await writeAtomically(
      path.join(DATA_DIR, `${room}.migration.docx`),
      readCollaborationDocument(document)
    );
    console.log(`exported ${room}`);
  } catch (error) {
    failed += 1;
    console.error(`could not export ${room}: ${(error as Error).message}`);
  } finally {
    document.destroy();
  }
}
process.exitCode = failed > 0 ? 1 : 0;
