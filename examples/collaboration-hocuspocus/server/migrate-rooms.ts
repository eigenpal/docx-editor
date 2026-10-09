// Move every saved room to the current collaboration format, the second step of a room
// migration. Run `export-rooms.ts` with the build that created the rooms first, then this
// with the new build, while the server is stopped.
//
// Each room is seeded from its export and checked against it: every XML part, every media
// file, and every link target. Only then is its earlier state kept as `<room>.ydoc.previous`
// and replaced. A room already in the current
// format is left as it is, so a second run resumes.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DATA_DIR } from './room-files.ts';
import { allRoomsServable, migrateStoredRooms } from './room-migration.ts';

const USAGE = `Usage: node server/migrate-rooms.ts [options]

Moves every saved room to the current collaboration format. Run export-rooms.ts
with the earlier build first, and stop the server before you run this.

Options:
  --dry-run          Check every room and write nothing.
  --report <file>    Also write the result for each room as JSON. The file holds
                     document text for rooms that fail the check.
  --data-dir <dir>   The directory that holds the rooms. Default: server/.data
  --help             Show this help.

Exit status: 0 when every room can be served after the run, 1 otherwise, and 2
for invalid options.`;

let options;
try {
  options = parseArgs({
    strict: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      report: { type: 'string' },
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
const results = await migrateStoredRooms(directory, { dryRun: options['dry-run'] });
for (const result of results) {
  if ('report' in result) {
    const { paragraphs, hidden, hiddenAt, failed, changedParts, differenceCount, differences } =
      result.report;
    const { missingMedia, missingLinks } = result.report;
    const first = differences[0];
    const notes = [
      paragraphs === 1 ? '1 paragraph' : `${paragraphs} paragraphs`,
      ...(hidden > 0
        ? [
            `${hidden} kept but not editable in the editor, first at ` +
              `${hiddenAt[0]!.part} #${hiddenAt[0]!.paragraph}; check them`,
          ]
        : []),
      ...(failed.length > 0 ? [`failed checks: ${failed.join(', ')}`] : []),
      ...(changedParts.length > 0 ? [`parts that differ: ${changedParts.join(' ')}`] : []),
      ...(first
        ? [
            `${differenceCount} paragraphs differ, first: ${first.kind} at ${first.part} #${first.paragraph}`,
          ]
        : []),
      ...(missingMedia.length > 0 ? [`${missingMedia.length} media parts missing`] : []),
      ...(missingLinks.length > 0 ? [`${missingLinks.length} link targets missing`] : []),
    ];
    console.log(`${result.room}: ${result.outcome}, ${notes.join(', ')}`);
  } else if ('detail' in result) {
    console.error(`${result.room}: ${result.outcome}: ${result.detail}`);
  } else {
    console.log(`${result.room}: ${result.outcome}`);
  }
}
const count = (outcome: string) => results.filter((result) => result.outcome === outcome).length;
console.log(
  `${results.length} rooms: ${count('migrated')} migrated, ${count('would-migrate')} would migrate, ` +
    `${count('current')} current, ${results.length - count('migrated') - count('would-migrate') - count('current')} need attention`
);
if (options.report) {
  await writeFile(options.report, `${JSON.stringify(results, null, 2)}\n`);
}
process.exitCode = allRoomsServable(results) ? 0 : 1;
