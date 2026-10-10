// One room migration in a process of its own, for `memory.mjs`.
//
//   node --expose-gc measure.mjs --paragraphs <n>
//   node --expose-gc measure.mjs --fixture <file.docx>
//
// Prints one JSON line: the document's size, the migration's time, the process's peak
// resident memory, and the heap the process used before the migration. A run under a
// `--max-old-space-size` too small for the room ends with a V8 out-of-memory exit.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { strToU8, zipSync } from 'fflate';
import * as Y from 'yjs';
import {
  DOCUMENT_COLLABORATION_VERSIONS,
  migrateCollaborationRoom,
} from '@docx-editor.dev/pro/collaboration';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WORDS =
  'the party shall provide written notice within thirty days of any change to the terms ' +
  'set out in this agreement and each schedule attached to it unless agreed otherwise';

/** A document of `count` paragraphs of about 250 characters, each with a bold run. */
function syntheticDocument(count) {
  const words = WORDS.split(' ');
  const paragraphs = [];
  for (let index = 0; index < count; index += 1) {
    // Words in a different order in each paragraph, so the file compresses as text does.
    const text = Array.from(
      { length: 42 },
      (_, at) => words[(at * 7 + index * 13 + ((index * at) % 5)) % words.length]
    ).join(' ');
    paragraphs.push(
      `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${index + 1}. </w:t></w:r>` +
        `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
    );
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${paragraphs.join('')}<w:sectPr/></w:body></w:document>`
    ),
  });
}

/** Saved state of an earlier format: the metadata a migration reads, nothing else. */
function earlierRoomState() {
  const room = new Y.Doc();
  const meta = room.getMap('docx-package-meta-v1');
  meta.set('initialized', true);
  meta.set('documentId', 'benchmark-room-1234567890abcdef');
  for (const [field, value] of Object.entries(DOCUMENT_COLLABORATION_VERSIONS)) {
    meta.set(field, value);
  }
  meta.set('sharedSchemaVersion', DOCUMENT_COLLABORATION_VERSIONS.sharedSchemaVersion - 1);
  const state = Y.encodeStateAsUpdate(room);
  room.destroy();
  return state;
}

const { values } = parseArgs({
  strict: true,
  options: { paragraphs: { type: 'string' }, fixture: { type: 'string' } },
});
const exported = values.fixture
  ? new Uint8Array(readFileSync(values.fixture))
  : syntheticDocument(Number(values.paragraphs));
const state = earlierRoomState();

globalThis.gc();
const baselineHeap = process.memoryUsage().heapUsed;
const baselineRss = process.memoryUsage().rss;
const start = performance.now();
const migrated = await migrateCollaborationRoom({ state, exported });
const seconds = (performance.now() - start) / 1000;
if (!migrated.ok) throw new Error(`migration failed: ${JSON.stringify(migrated)}`);

console.log(
  JSON.stringify({
    paragraphs: migrated.report.paragraphs,
    docxBytes: exported.byteLength,
    stateBytes: migrated.state.byteLength,
    seconds,
    // `maxRSS` is in KiB: the peak of the whole process, modules included.
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    baselineRssBytes: baselineRss,
    baselineHeapBytes: baselineHeap,
  })
);
