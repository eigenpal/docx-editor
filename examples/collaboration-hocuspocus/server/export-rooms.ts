// Export every saved room as a `.docx`, the first step of a room migration.
//
// Run it with the build that created the rooms: only that build can read their format. It
// uses nothing but `readCollaborationDocument`, which every 2.x build has, and `room-files.ts`,
// which uses only Node.js. Copy both files into a project where the earlier build is installed.
// Then run `migrate-rooms.ts` with the new build.
//
// Beside each export it writes the SHA-256 of the state it was exported from. The migration
// refuses a room whose state changed since, so edits made after the export are never lost.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as Y from 'yjs';
import { readCollaborationDocument } from '@docx-editor.dev/pro/collaboration';
import { DATA_DIR, ROOM_ID, stateDigest, writeAtomically } from './room-files.ts';

const USAGE = `Usage: node server/export-rooms.ts [options]

Exports every saved room as <room>.migration.docx, with the SHA-256 of its state
in <room>.migration.sha256. Run it with the build that created the rooms, while
the server is stopped. Running it again replaces earlier exports.

Options:
  --data-dir <dir>   The directory that holds the rooms. Default: server/.data
  --help             Show this help.

Exit status: 0 when every room was exported, 1 otherwise, and 2 for invalid
options.`;

let options;
try {
  options = parseArgs({
    strict: true,
    options: {
      'data-dir': { type: 'string', default: DATA_DIR },
      help: { type: 'boolean', default: false },
    },
  }).values;
} catch (error) {
  console.error(`${(error as Error).message}\n\n${USAGE}`);
  process.exit(2);
}
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

const directory = path.resolve(options['data-dir']);
let exported = 0;
let failed = 0;
for (const name of (await readdir(directory)).sort()) {
  const room = name.endsWith('.ydoc') ? name.slice(0, -'.ydoc'.length) : null;
  if (!room || !ROOM_ID.test(room)) continue;
  const document = new Y.Doc();
  try {
    const state = new Uint8Array(await readFile(path.join(directory, name)));
    Y.applyUpdate(document, state);
    await writeAtomically(
      path.join(directory, `${room}.migration.docx`),
      readCollaborationDocument(document)
    );
    await writeAtomically(
      path.join(directory, `${room}.migration.sha256`),
      new TextEncoder().encode(stateDigest(state))
    );
    exported += 1;
    console.log(`${room}: exported`);
  } catch (error) {
    failed += 1;
    console.error(`${room}: could not export: ${(error as Error).message}`);
  } finally {
    document.destroy();
  }
}
console.log(`${exported + failed} rooms: ${exported} exported, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
