// Watch the server upgrade saved rooms, without a second release.
//
// It rewrites every saved room so that it names an earlier collaboration format, and keeps
// the room's `.docx` export current for that state, as the earlier server would have left
// it. Start the server and open a room: the server creates the room again from the export,
// and logs `upgraded from ... to ...`.
//
// A demonstration only. Run it while the server is stopped, on rooms you do not need.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { collaborationMigrationNeed } from '@docx-editor.dev/pro/collaboration';
import { asEarlierFormat } from './earlier-format.ts';
import { DATA_DIR, ROOM_ID, stateDigest, writeAtomically } from './room-files.ts';

const USAGE = `Usage: node server/simulate-format-change.ts [options]

Rewrites every saved room so that it names an earlier collaboration format. The
next server start upgrades each room when a participant opens it. A
demonstration only: run it while the server is stopped.

Options:
  --data-dir <dir>   The directory that holds the rooms. Default: server/.data
  --help             Show this help.

Exit status: 0 when every room was rewritten or skipped, 1 otherwise, and 2 for
invalid options.`;

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
const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
  console.error(`Cannot read room directory ${directory} (${error.code ?? 'unknown error'}).`);
  process.exit(1);
});
let failed = 0;
for (const name of names.sort()) {
  const room = name.endsWith('.ydoc') ? name.slice(0, -'.ydoc'.length) : null;
  if (!room || !ROOM_ID.test(room)) continue;
  const file = path.join(directory, name);
  try {
    const state = new Uint8Array(await readFile(file));
    if (collaborationMigrationNeed(state) !== 'current') {
      console.log(`${room}: skipped, not in the current format`);
      continue;
    }
    const digest = await readFile(`${file}.docx.sha256`, 'utf8').catch(() => '');
    if (digest.trim() !== stateDigest(state)) {
      console.log(`${room}: skipped, no current export. Open the room once, then stop the server.`);
      continue;
    }
    const earlier = asEarlierFormat(state);
    // The state first, as the server's storage does. The export holds the same document.
    await writeAtomically(file, earlier);
    await writeAtomically(`${file}.docx.sha256`, new TextEncoder().encode(stateDigest(earlier)));
    console.log(`${room}: now names an earlier format`);
  } catch (error) {
    failed += 1;
    console.error(`${room}: could not rewrite: ${(error as Error).message}`);
  }
}
process.exitCode = failed > 0 ? 1 : 0;
