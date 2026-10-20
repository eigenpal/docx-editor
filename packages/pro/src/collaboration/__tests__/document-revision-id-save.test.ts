/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Saving gives every revision annotation its own `@w:id`. The pass works on the export
// snapshot only, so shared state keeps the ids the room holds, every peer saves the same
// unique ids, and a peer that joins later converges with the room.

import { afterEach, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { writeOoxmlPackage, type OoxmlNode } from '@docx-editor.dev/core/store';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

const peers = createPeerHarness('revision-id-save-room');
afterEach(() => peers.cleanup());

const OTHER = 'w:author="Other" w:date="2020-01-01T00:00:00Z"';

function savedIds(peer: Peer): string[] {
  const saved = writeOoxmlPackage(peers.packageOf(peer));
  const xml = strFromU8(unzipSync(saved)['word/document.xml']!);
  return [...xml.matchAll(/<w:ins\b[^>]*?\bw:id="([^"]*)"/g)].map((match) => match[1]!);
}

function liveIds(peer: Peer): string[] {
  const pkg = peers.packageOf(peer);
  const ids: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'ins') {
      ids.push(node.attributes.find((attribute) => attribute.localName === 'id')?.value ?? '');
    }
    for (const child of node.children) visit(child);
  };
  visit(pkg.parts.get(pkg.mainDocumentPart)!.root);
  return ids;
}

test('concurrent tracked edits that share an id save unique ids on both peers', async () => {
  const bytes = zipDocument(
    `<w:p><w:ins w:id="1" ${OTHER}><w:r><w:t>abcdef</w:t></w:r></w:ins></w:p>` +
      '<w:p><w:r><w:t>plain</w:t></w:r></w:p><w:sectPr/>'
  );
  const { alice, bob, pause, resume } = await peers.pair(bytes);
  pause();
  peers.apply(alice, [
    {
      op: 'insertText',
      paragraphId: peers.paragraphIdAt(alice, 0),
      offset: 3,
      text: 'A',
      revision: { author: 'alice', date: '2021-01-01T00:00:00Z' },
    },
  ]);
  peers.apply(bob, [
    {
      op: 'insertText',
      paragraphId: peers.paragraphIdAt(bob, 1),
      offset: 0,
      text: 'B',
      revision: { author: 'bob', date: '2021-01-01T00:00:00Z' },
    },
  ]);
  resume();
  peers.expectConverged(alice, bob);

  // Shared state holds the split pieces and both new insertions under the ids they minted.
  const live = liveIds(alice);
  expect(live).toEqual(liveIds(bob));
  expect(new Set(live).size).toBeLessThan(live.length);

  // Saving writes nothing to the room.
  const updates: Uint8Array[] = [];
  const record = (update: Uint8Array) => updates.push(update);
  alice.ydoc.on('update', record);
  bob.ydoc.on('update', record);
  const fromAlice = savedIds(alice);
  const fromBob = savedIds(bob);
  alice.ydoc.off('update', record);
  bob.ydoc.off('update', record);
  expect(updates).toHaveLength(0);
  expect(liveIds(alice)).toEqual(live);

  expect(new Set(fromAlice).size).toBe(fromAlice.length);
  expect(fromAlice).toHaveLength(live.length);
  expect(fromBob).toEqual(fromAlice);

  // A peer that joins now opens the room's ids and converges with it.
  const carol = await peers.join(alice, 'carol');
  peers.expectConverged(alice, carol);
  expect(liveIds(carol)).toEqual(live);
  expect(savedIds(carol)).toEqual(fromAlice);

  // Undo and redo move shared state; every save on the way still writes unique ids.
  expect(alice.room.session.undo()).toBe(true);
  peers.expectConverged(alice, bob);
  const afterUndo = savedIds(bob);
  expect(new Set(afterUndo).size).toBe(afterUndo.length);
  expect(alice.room.session.redo()).toBe(true);
  peers.expectConverged(alice, bob);
  expect(liveIds(bob)).toEqual(live);
  expect(savedIds(bob)).toEqual(fromAlice);
});
