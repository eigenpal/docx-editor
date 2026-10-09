// Move every saved room to the current collaboration format, the second step of a room
// migration. Run `export-rooms.ts` with the build that created the rooms first, then this
// with the new build, while the server is stopped.
//
//   node server/migrate-rooms.ts                       migrate, keeping each earlier state
//   node server/migrate-rooms.ts --dry-run             check every room and write nothing
//   node server/migrate-rooms.ts --report report.json  also write the results as JSON
//
// Each room is seeded from its export and checked against it: the same paragraphs with the
// same text, the same media, and the same link targets. Only then is its earlier state kept
// as `<room>.ydoc.previous` and replaced. A room already in the current format is left as it
// is, so a second run resumes. The exit status is 1 when any room is not servable after the
// run.

import { writeFile } from 'node:fs/promises';
import { DATA_DIR } from './room-files.ts';
import { allRoomsServable, migrateStoredRooms } from './room-migration.ts';

const dryRun = process.argv.includes('--dry-run');
const reportAt = process.argv.indexOf('--report');
const reportFile = reportAt >= 0 ? process.argv[reportAt + 1] : undefined;

const results = await migrateStoredRooms(DATA_DIR, { dryRun });
for (const result of results) {
  if ('report' in result) {
    const { paragraphs, hidden, differences, missingMedia, missingLinks } = result.report;
    const notes = [
      `${paragraphs} paragraphs`,
      ...(hidden > 0 ? [`${hidden} kept but not editable in the editor`] : []),
      ...(missingMedia.length > 0 ? [`${missingMedia.length} media parts missing`] : []),
      ...(missingLinks.length > 0 ? [`${missingLinks.length} link targets missing`] : []),
      ...(differences.length > 0
        ? [`${differences.length} differ, first at ${differences[0]!.paragraph}`]
        : []),
    ];
    console.log(`${result.room}: ${result.outcome}, ${notes.join(', ')}`);
  } else if ('detail' in result) {
    console.error(`${result.room}: ${result.outcome}: ${result.detail}`);
  } else {
    console.log(`${result.room}: ${result.outcome}`);
  }
}
if (reportFile) await writeFile(reportFile, `${JSON.stringify(results, null, 2)}\n`);
process.exitCode = allRoomsServable(results) ? 0 : 1;
