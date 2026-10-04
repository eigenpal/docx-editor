/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Removing the row a vertical merge starts in hands the merge to the next row (issue #1069).
// Both replicas must reach that repaired table, through concurrency, undo, and reconnect.
import { afterEach, expect, test } from 'bun:test';
import { serializeOoxmlPart, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import { createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('table-vmerge-rows', { offlineEditing: true });
afterEach(() => harness.cleanup());

const cell = (text: string, merge = ''): string =>
  `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>${merge}</w:tcPr>` +
  (text ? `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` : '<w:p/>') +
  `</w:tc>`;
const RESTART = '<w:vMerge w:val="restart"/>';
const CONTINUE = '<w:vMerge/>';

const bytes = zipDocument(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
    `<w:tr>${cell('Party')}${cell('Amount')}</w:tr>` +
    `<w:tr>${cell('Supplier', RESTART)}${cell('USD 100')}</w:tr>` +
    `<w:tr>${cell('', CONTINUE)}${cell('USD 200')}</w:tr>` +
    `<w:tr>${cell('', CONTINUE)}${cell('USD 300')}</w:tr></w:tbl><w:p/>`
);

function table(peer: Peer): OoxmlElement {
  let found: OoxmlElement | null = null;
  walk(peer.store.bodyStore().part.root, (node) => {
    if (!found && node.kind === 'table') found = node;
  });
  if (!found) throw new Error('no table');
  return found;
}

function rowIds(peer: Peer): string[] {
  return table(peer)
    .children.filter((child) => child.kind === 'tableRow')
    .map((row) => row.id);
}

/** Each row's merge markers and text, cell by cell. */
function shape(peer: Peer): string[] {
  const xml = serializeOoxmlPart(peer.store.bodyStore().part);
  return [...xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((row) =>
    [...row[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)]
      .map((tc) => {
        const merge = tc[0].includes(RESTART) ? 'R' : tc[0].includes(CONTINUE) ? 'C' : '-';
        return `${merge}:${[...tc[0].matchAll(/<w:t>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')}`;
      })
      .join(' ')
  );
}

function firstParagraphOfCell(peer: Peer, row: number, column: number): string {
  const tr = table(peer).children.filter((child) => child.kind === 'tableRow')[row]!;
  const tc = (tr as OoxmlElement).children.filter((child) => child.kind === 'tableCell')[column]!;
  const paragraph = (tc as OoxmlElement).children.find(
    (child: OoxmlNode) => child.kind === 'paragraph'
  );
  if (!paragraph) throw new Error('no paragraph');
  return paragraph.id;
}

const REPAIRED = ['-:Party -:Amount', 'R: -:USD 200', 'C: -:USD 300'];

test('deleting the merge-start row converges and survives undo, redo, and reconnect', async () => {
  const { alice, bob } = await harness.pair(bytes);
  const before = shape(alice);
  harness.apply(alice, [
    { op: 'deleteTableRow', tableId: table(alice).id, rowId: rowIds(alice)[1]! },
  ]);
  harness.expectConverged(alice, bob);
  expect(shape(bob)).toEqual(REPAIRED);

  expect(alice.room.session.undo()).toBe(true);
  harness.expectConverged(alice, bob);
  expect(shape(bob)).toEqual(before);
  expect(alice.room.session.redo()).toBe(true);
  harness.expectConverged(alice, bob);
  expect(shape(bob)).toEqual(REPAIRED);

  const rejoined = await harness.remount(bob);
  harness.expectConverged(alice, rejoined);
  expect(shape(rejoined)).toEqual(REPAIRED);
});

test('a concurrent edit in the surviving rows merges into the repaired table', async () => {
  const { alice, bob, pause, resume } = await harness.pair(bytes);
  pause();
  harness.apply(alice, [
    { op: 'deleteTableRow', tableId: table(alice).id, rowId: rowIds(alice)[1]! },
  ]);
  harness.apply(bob, [
    { op: 'insertText', paragraphId: firstParagraphOfCell(bob, 2, 1), offset: 7, text: '.50' },
  ]);
  resume();
  harness.expectConverged(alice, bob);
  expect(shape(alice)).toEqual(['-:Party -:Amount', 'R: -:USD 200.50', 'C: -:USD 300']);
});

test('a concurrent edit inside the deleted merge cell does not resurrect the row', async () => {
  const { alice, bob, pause, resume } = await harness.pair(bytes);
  pause();
  harness.apply(alice, [
    { op: 'deleteTableRow', tableId: table(alice).id, rowId: rowIds(alice)[1]! },
  ]);
  harness.apply(bob, [
    { op: 'insertText', paragraphId: firstParagraphOfCell(bob, 1, 0), offset: 8, text: ' Ltd' },
  ]);
  resume();
  harness.expectConverged(alice, bob);
  expect(shape(alice)).toEqual(REPAIRED);
});

test('concurrent deletion of the merge start and the next row converges', async () => {
  const { alice, bob, pause, resume } = await harness.pair(bytes);
  pause();
  harness.apply(alice, [
    { op: 'deleteTableRow', tableId: table(alice).id, rowId: rowIds(alice)[1]! },
  ]);
  harness.apply(bob, [{ op: 'deleteTableRow', tableId: table(bob).id, rowId: rowIds(bob)[2]! }]);
  resume();
  harness.expectConverged(alice, bob);
  // Each repair was right on its own replica. Together they leave a continuation with no
  // merged cell above it; layout starts a merge there, so it still paints as a cell.
  expect(shape(alice)).toEqual(['-:Party -:Amount', 'C: -:USD 300']);
});
