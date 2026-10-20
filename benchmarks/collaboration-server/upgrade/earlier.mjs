// The earlier build's half of the collaboration upgrade check. It runs inside a directory
// where an earlier published release is installed, never against this repository's sources.
//
//   node earlier.mjs create <fixtures-dir> <rooms-dir>
//     For each fixture, two participants edit one room: typing, then concurrent changes to
//     one paragraph's alignment while one participant is out of sync. The script saves each
//     room's state as <room>.ydoc and exports it with the earlier build as
//     <room>.migration.docx, as a server running the earlier build does before a migration.
//
//   node earlier.mjs open <rooms-dir>
//     Opens each room the current build migrated (marked by <room>.migrated), and prints one
//     JSON line per room: whether the earlier build refused it. It must, so a stale server
//     cannot serve a room that a newer build migrated.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  createDocumentCollaboration,
  readCollaborationDocument,
} from '@docx-editor.dev/pro/collaboration';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration/replication';
import {
  normalizeParagraphIdentity,
  readOoxmlPackage,
  TreePackageStore,
} from '@docx-editor.dev/core/store';

const BODY = { kind: 'body' };

async function participant(ydoc, bootstrap, name) {
  const awareness = new Awareness(ydoc);
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'upgrade-check',
    identity: { actorId: name, name },
    bootstrap,
  });
  const loaded = readOoxmlPackage(room.document);
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  const port = createCollaborationDocumentPort(store, { documentId: 'upgrade-check' });
  const detach = room.session.attach(port);
  const paragraphs = () => {
    const ids = [];
    const visit = (node) => {
      if (node.kind === 'paragraph') ids.push(node.id);
      if (node.kind === 'textValue') return;
      for (const child of node.children) visit(child);
    };
    visit(store.bodyStore().part.root);
    return ids;
  };
  const apply = (op) => {
    store.transact(BODY, (context) => context.apply(op));
    port.flushPendingJournals();
  };
  const destroy = () => {
    detach();
    room.destroy();
    awareness.destroy();
  };
  return { ydoc, paragraphs, apply, destroy };
}

async function create(fixturesDir, roomsDir) {
  const fixtures = (await readdir(fixturesDir)).filter((name) => name.endsWith('.docx')).sort();
  for (const [index, fixture] of fixtures.entries()) {
    const room = `upgrade-room-${String(index).padStart(2, '0')}-1234567890abcdef`;
    const bytes = new Uint8Array(await readFile(path.join(fixturesDir, fixture)));
    const aliceDoc = new Y.Doc();
    const alice = await participant(aliceDoc, { kind: 'create', document: bytes }, 'alice');
    const bobDoc = new Y.Doc();
    Y.applyUpdate(bobDoc, Y.encodeStateAsUpdate(aliceDoc));
    const bob = await participant(bobDoc, { kind: 'join', timeoutMs: 5000 }, 'bob');
    const exchange = () => {
      Y.applyUpdate(bobDoc, Y.encodeStateAsUpdate(aliceDoc, Y.encodeStateVector(bobDoc)), 'peer');
      Y.applyUpdate(aliceDoc, Y.encodeStateAsUpdate(bobDoc, Y.encodeStateVector(aliceDoc)), 'peer');
    };
    let edited = 0;
    // Typing first: after the conflict below, the earlier build refuses every later edit.
    try {
      alice.apply({
        op: 'insertText',
        paragraphId: alice.paragraphs()[0],
        offset: 0,
        text: 'Upgraded ',
      });
      edited += 1;
    } catch {
      // Counted below: a room without the typing tests too little.
    }
    exchange();
    // Each participant aligns the first paragraph while the other is out of sync.
    for (const [peer, value] of [
      [alice, 'center'],
      [bob, 'right'],
    ]) {
      try {
        peer.apply({
          op: 'setParagraphProperties',
          paragraphId: peer.paragraphs()[0],
          properties: [{ localName: 'jc', attributes: { val: value } }],
        });
        edited += 1;
      } catch {
        // Counted below.
      }
    }
    exchange();
    await writeFile(path.join(roomsDir, `${room}.ydoc`), Y.encodeStateAsUpdate(aliceDoc));
    let exported = false;
    try {
      await writeFile(
        path.join(roomsDir, `${room}.migration.docx`),
        readCollaborationDocument(aliceDoc)
      );
      exported = true;
    } catch (error) {
      console.error(`${room}: the earlier build could not export: ${error.message}`);
    }
    console.log(JSON.stringify({ room, fixture, edited, exported }));
    // Every room must carry the conflict and the typing, or the check tests nothing.
    if (edited < 3 || !exported) process.exitCode = 1;
    alice.destroy();
    bob.destroy();
  }
}

async function open(roomsDir) {
  const files = await readdir(roomsDir);
  const migrated = files.filter((file) => file.endsWith('.migrated'));
  for (const name of migrated.map((file) => `${file.slice(0, -'.migrated'.length)}.ydoc`).sort()) {
    const ydoc = new Y.Doc();
    let refused = false;
    try {
      Y.applyUpdate(ydoc, new Uint8Array(await readFile(path.join(roomsDir, name))));
      readCollaborationDocument(ydoc);
    } catch {
      refused = true;
    }
    console.log(JSON.stringify({ room: name.slice(0, -'.ydoc'.length), refused }));
    ydoc.destroy();
  }
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'create') await create(args[0], args[1]);
else if (mode === 'open') await open(args[0]);
else throw new Error(`unknown mode ${mode}`);
