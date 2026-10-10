// The current build's half of the collaboration upgrade check. A room the earlier release
// wrote in this build's format must open and take edits as it is. A room of an earlier format
// must be refused, then migrated from its export, and the new room must be whole and editable.
//
//   bun benchmarks/collaboration-server/upgrade/current.ts <rooms-dir> <expected-rooms>
//     [--expect-doubled-properties]
//
// --expect-doubled-properties  the earlier release leaves two `w:pPr` after a property
//                              conflict, so some migrated room must hold that damage
//
// Prints one JSON line per room and exits 1 when any room fails. Each migrated state replaces
// the room's `.ydoc`, and a `<room>.migrated` file marks it, so the earlier build can then be
// asked to open it: it must refuse.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  normalizeParagraphIdentity,
  readOoxmlPackage,
  TreePackageStore,
  type OoxmlNode,
} from '../../../packages/core/src/store/index.ts';
import { createCollaborationDocumentPort } from '../../../packages/core/src/collaboration/replication.ts';
import {
  collaborationMigrationNeed,
  createDocumentCollaboration,
  migrateCollaborationRoom,
  readCollaborationDocument,
} from '../../../packages/pro/src/collaboration/index.ts';

/** Paragraphs of an export that hold more than one `w:pPr`: the damage the upgrade repairs. */
function doubledParagraphProperties(docx: Uint8Array): number {
  const read = readOoxmlPackage(docx);
  if (!read.ok) return 0;
  let count = 0;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'p') {
      const properties = node.children.filter(
        (child) => child.kind !== 'textValue' && child.localName === 'pPr'
      );
      if (properties.length > 1) count += 1;
    }
    for (const child of node.children) visit(child);
  };
  for (const part of read.package.parts.values()) visit(part.root);
  return count;
}

/** Every paragraph's text in a `.docx`. */
function paragraphTexts(docx: Uint8Array): string[] {
  const read = readOoxmlPackage(docx);
  if (!read.ok) return [];
  const texts: string[] = [];
  const textOf = (node: OoxmlNode): string =>
    node.kind === 'textValue' ? node.value : node.children.map(textOf).join('');
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'p') texts.push(textOf(node));
    else for (const child of node.children) visit(child);
  };
  visit(read.package.parts.get(read.package.mainDocumentPart)!.root);
  return texts;
}

const TYPED = 'Checked after the upgrade ';

/**
 * Whether a participant of the current build can join the room, type in its first paragraph,
 * and find the text in the room's shared state, which every participant and export reads.
 */
async function editable(state: Uint8Array, documentId: string): Promise<boolean> {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  Y.applyUpdate(ydoc, state);
  try {
    const room = await createDocumentCollaboration({
      ydoc,
      awareness,
      documentId,
      identity: { actorId: 'upgrade-check', name: 'Upgrade check' },
      bootstrap: { kind: 'join', timeoutMs: 5000 },
    });
    try {
      if (room.session.statusSnapshot().status !== 'ready') return false;
      const loaded = readOoxmlPackage(room.document);
      if (!loaded.ok) return false;
      const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
      const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
      const port = createCollaborationDocumentPort(store, { documentId });
      const detach = room.session.attach(port);
      try {
        let first: string | null = null;
        const visit = (node: OoxmlNode): void => {
          if (first !== null || node.kind === 'textValue') return;
          if (node.kind === 'paragraph') first = node.id;
          else for (const child of node.children) visit(child);
        };
        visit(store.bodyStore().part.root);
        if (first === null) return false;
        const paragraphId: string = first;
        const result = store.transact({ kind: 'body' }, (context) =>
          context.apply({ op: 'insertText', paragraphId, offset: 0, text: TYPED })
        );
        port.flushPendingJournals();
        if (!result.ok || room.session.statusSnapshot().status !== 'ready') return false;
        return paragraphTexts(readCollaborationDocument(ydoc)).some((text) =>
          text.startsWith(TYPED)
        );
      } finally {
        detach();
      }
    } finally {
      room.destroy();
    }
  } finally {
    awareness.destroy();
    ydoc.destroy();
  }
}

const roomsDir = process.argv[2];
const expectedRooms = Number(process.argv[3]);
const expectDoubled = process.argv.includes('--expect-doubled-properties');
if (!roomsDir || !Number.isSafeInteger(expectedRooms)) {
  throw new Error('usage: current.ts <rooms-dir> <expected-rooms>');
}
let checked = 0;
let migratedRooms = 0;
let failed = 0;
let damaged = 0;
for (const name of (await readdir(roomsDir)).filter((file) => file.endsWith('.ydoc')).sort()) {
  const room = name.slice(0, -'.ydoc'.length);
  const problems: string[] = [];
  checked += 1;
  // The earlier build typed into every room before it exported it: the export must hold it.
  const exportedFirst = new Uint8Array(
    await readFile(path.join(roomsDir, `${room}.migration.docx`))
  );
  if (!paragraphTexts(exportedFirst).some((text) => text.includes('Upgraded '))) {
    problems.push('the export lost the text the earlier build typed');
  }
  const earlier = new Uint8Array(await readFile(path.join(roomsDir, name)));
  const need = collaborationMigrationNeed(earlier);
  if (need === 'later-format') problems.push('a later build wrote this room');
  if (need === 'current') {
    // The same format: no migration, and the room must serve as it is.
    // The ID `earlier.mjs` gave every room.
    if (!(await editable(earlier, 'upgrade-check'))) problems.push('a participant cannot join it');
    if (problems.length > 0) failed += 1;
    console.log(JSON.stringify({ room, path: 'current', problems }));
    continue;
  }
  // This build must not read the earlier room as if it were its own.
  const stale = new Y.Doc();
  try {
    Y.applyUpdate(stale, earlier);
    readCollaborationDocument(stale);
    problems.push('the current build read a room of an earlier format');
  } catch {
    // Refused, as it must be.
  } finally {
    stale.destroy();
  }
  const exported = exportedFirst;
  const doubled = doubledParagraphProperties(exported);
  if (doubled > 0) damaged += 1;
  const migrated = await migrateCollaborationRoom({ state: earlier, exported });
  if (!migrated.ok) {
    problems.push(
      migrated.reason === 'check-failed'
        ? `check failed: ${JSON.stringify(migrated.report.differences.slice(0, 3))}`
        : `refused: ${migrated.reason}`
    );
  } else {
    if (migrated.report.hidden > 0) {
      problems.push(`${migrated.report.hidden} paragraphs are not editable`);
    }
    if (collaborationMigrationNeed(migrated.state) !== 'current') {
      problems.push('the migrated room is not in the current format');
    }
    // The earlier build's participants opened the room with this ID; the migration keeps it.
    if (!(await editable(migrated.state, migrated.report.documentId))) {
      problems.push('a participant cannot join it');
    }
    await writeFile(path.join(roomsDir, name), migrated.state);
    await writeFile(path.join(roomsDir, `${room}.migrated`), '');
    migratedRooms += 1;
  }
  if (problems.length > 0) failed += 1;
  console.log(
    JSON.stringify({
      room,
      path: 'migrated',
      paragraphs: 'report' in migrated ? migrated.report.paragraphs : 0,
      doubledParagraphProperties: doubled,
      problems,
    })
  );
}
if (checked !== expectedRooms) {
  failed += 1;
  console.log(JSON.stringify({ problem: `expected ${expectedRooms} rooms, found ${checked}` }));
}
// From a release with the conflict damage, a check no room carried it through tests nothing.
if (expectDoubled && damaged === 0) {
  failed += 1;
  console.log(JSON.stringify({ problem: 'no migrated room held a paragraph with two w:pPr' }));
}
console.log(
  JSON.stringify({
    rooms: checked,
    migrated: migratedRooms,
    failed,
    roomsWithDoubledProperties: damaged,
  })
);
process.exitCode = failed > 0 ? 1 : 0;
