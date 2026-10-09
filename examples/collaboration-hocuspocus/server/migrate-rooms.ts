// Move every saved room to the current collaboration format, the second step of a room
// migration. Run `export-rooms.ts` with the build that created the rooms first, then this
// with the new build, while the server is stopped.
//
//   node server/migrate-rooms.ts            migrate, and keep each old state as a backup
//   node server/migrate-rooms.ts --dry-run  check every room, and write nothing
//
// For each room, the new state is seeded from the room's export and checked against it: the
// same paragraphs, with the same text. Only then is the old state kept as
// `<room>.ydoc.previous` and replaced. A room in the current format is left as it is.

import { copyFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, ROOM_ID, writeAtomically } from './room-files.ts';
import { isCurrentFormat, migrateRoom } from './room-migration.ts';

const dryRun = process.argv.includes('--dry-run');
let failed = 0;
for (const name of (await readdir(DATA_DIR)).sort()) {
  const room = name.endsWith('.ydoc') ? name.slice(0, -'.ydoc'.length) : null;
  if (!room || !ROOM_ID.test(room)) continue;
  const stateFile = path.join(DATA_DIR, name);
  try {
    if (isCurrentFormat(new Uint8Array(await readFile(stateFile)))) {
      console.log(`${room}: already current`);
      continue;
    }
    const exported = await readFile(path.join(DATA_DIR, `${room}.migration.docx`)).catch(() => {
      throw new Error('no export: run export-rooms.ts with the build that created the room');
    });
    const migrated = await migrateRoom(new Uint8Array(exported), room);
    const hidden =
      migrated.hidden > 0 ? `, ${migrated.hidden} kept but not editable in the editor` : '';
    if (!dryRun) {
      await copyFile(stateFile, `${stateFile}.previous`);
      await writeAtomically(stateFile, migrated.state);
    }
    console.log(
      `${room}: ${dryRun ? 'would migrate' : 'migrated'}, ${migrated.paragraphs} paragraphs${hidden}`
    );
  } catch (error) {
    failed += 1;
    console.error(`${room}: not migrated: ${(error as Error).message}`);
  }
}
process.exitCode = failed > 0 ? 1 : 0;
