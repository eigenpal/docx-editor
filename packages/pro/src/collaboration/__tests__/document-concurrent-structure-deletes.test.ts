/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Structure that peers delete, merge, unwrap, and undo at the same time. Each case checks the
// whole structure every peer shows, rows and cells as well as text, in both client-ID orders:
// concurrent writes to one shared key resolve by client ID, so an outcome that depends on the
// order is a defect even when every peer converges.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import type { OoxmlNode, TreeDocOp } from '@docx-editor.dev/core/store';
import { createPeerHarness, nodeText, zipDocument, type Peer } from './document-peer-support.ts';

const harnesses: ReturnType<typeof createPeerHarness>[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

const ORDERS = [
  { label: 'alice has the lower client ID', ids: { alice: 10, bob: 20, carol: 30 } },
  { label: 'alice has the higher client ID', ids: { alice: 20, bob: 10, carol: 30 } },
] as const;

function harnessWith(ids: Readonly<Record<string, number>>) {
  const harness = createPeerHarness('concurrent-structure-deletes-room', undefined, ids);
  harnesses.push(harness);
  return harness;
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (inner: string) => `<w:tc>${inner}</w:tc>`;
const grid = (columns: number) =>
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(columns)}</w:tblGrid>`;
const table = (rows: readonly (readonly string[])[]) =>
  `<w:tbl><w:tblPr/>${grid(rows[0]!.length)}` +
  rows.map((row) => `<w:tr>${row.map((cell) => tc(cell)).join('')}</w:tr>`).join('') +
  '</w:tbl>';
const document = (inner: string) => zipDocument(p('Before') + inner + p('After') + '<w:sectPr/>');

const TWO_BY_TWO = document(
  table([
    [p('a1'), p('b1')],
    [p('a2'), p('b2')],
  ])
);
const THREE_COLUMNS = document(
  table([
    [p('a1'), p('b1'), p('c1')],
    [p('a2'), p('b2'), p('c2')],
  ])
);
const CONTROL = `<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent>${p('c1')}${p('c2')}</w:sdtContent></w:sdt>`;

/** The body as every peer shows it: paragraphs by text, tables as rows of cells. */
function shape(node: OoxmlNode): unknown {
  if (node.kind === 'textValue') return null;
  if (node.kind === 'paragraph') return nodeText(node);
  const kept = (localNames: readonly string[]) =>
    node.children
      .filter((child) => child.kind !== 'textValue' && localNames.includes(child.localName))
      .map(shape);
  if (node.localName === 'tbl') return { table: kept(['tr']) };
  if (node.localName === 'tr') return kept(['tc']);
  if (node.localName === 'tc') return kept(['p', 'tbl', 'sdt']).flat();
  const children = node.children.map(shape).filter((child) => child !== null);
  if (node.localName === 'sdt') return { control: children.flat() };
  return children.flat();
}

function view(peer: Peer): unknown {
  return shape(peer.store.bodyStore().part.root);
}

function ids(peer: Peer, localName: string): string[] {
  const found: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === localName) found.push(node.id);
    node.children.forEach(visit);
  };
  visit(peer.store.bodyStore().part.root);
  return found;
}

function paragraphNamed(peer: Peer, text: string): string {
  let found: string | null = null;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph' && nodeText(node) === text) found ??= node.id;
    node.children.forEach(visit);
  };
  visit(peer.store.bodyStore().part.root);
  if (found === null) throw new Error(`no paragraph ${text}`);
  return found;
}

function expectBoth(harness: ReturnType<typeof harnessWith>, peers: Peer[], expected: unknown) {
  for (const peer of peers.slice(1)) harness.expectConverged(peers[0]!, peer);
  for (const peer of peers) expect(view(peer)).toEqual(expected);
}

const deleteRow = (peer: Peer, index = 0): TreeDocOp => ({
  op: 'deleteTableRow',
  tableId: ids(peer, 'tbl')[0]!,
  rowId: ids(peer, 'tr')[index]!,
});
const deleteColumn = (peer: Peer, index: number): TreeDocOp => ({
  op: 'deleteTableColumn',
  tableId: ids(peer, 'tbl')[0]!,
  gridColumnId: ids(peer, 'gridCol')[index]!,
});

describe('removing a content control and keeping its content', () => {
  const unwrap = (peer: Peer): TreeDocOp => ({
    op: 'removeContentControl',
    controlId: ids(peer, 'sdt')[0]!,
    keepContent: true,
  });

  test('keeps the paragraphs, on every peer, through undo and redo', async () => {
    const harness = harnessWith(ORDERS[0].ids);
    const { alice, bob } = await harness.pair(document(CONTROL));
    harness.apply(alice, [unwrap(alice)]);
    expectBoth(harness, [alice, bob], ['Before', 'c1', 'c2', 'After']);
    expect(alice.room.session.undo()).toBe(true);
    expectBoth(harness, [alice, bob], ['Before', { control: ['c1', 'c2'] }, 'After']);
    expect(alice.room.session.redo()).toBe(true);
    expectBoth(harness, [alice, bob], ['Before', 'c1', 'c2', 'After']);
  });

  test('keeps the paragraphs for a participant alone in the room', async () => {
    const harness = harnessWith(ORDERS[0].ids);
    const { alice, bob } = await harness.pair(document(CONTROL));
    harness.leave(bob);
    harness.apply(alice, [unwrap(alice)]);
    expect(view(alice)).toEqual(['Before', 'c1', 'c2', 'After']);
  });

  test('keeps the paragraphs of a control inside a table cell', async () => {
    const harness = harnessWith(ORDERS[0].ids);
    const { alice, bob } = await harness.pair(document(table([[CONTROL]])));
    harness.apply(alice, [unwrap(alice)]);
    expectBoth(harness, [alice, bob], ['Before', { table: [[['c1', 'c2']]] }, 'After']);
  });
});

describe('a cell merge while a peer deletes the row or column a merged cell came from', () => {
  // The merge moves whole paragraphs into the cell it keeps, out of the cells it removes, so
  // a concurrent delete of a removed cell's row or column does not reach them.
  for (const { label, ids: clientIds } of ORDERS) {
    test(`a horizontal merge keeps the text of a deleted column (${label})`, async () => {
      const harness = harnessWith(clientIds);
      const { alice, bob, pause, resume } = await harness.pair(TWO_BY_TWO);
      pause();
      const cells = ids(alice, 'tc');
      const tableId = ids(alice, 'tbl')[0]!;
      harness.apply(alice, [{ op: 'mergeTableCells', tableId, cellIds: [cells[0]!, cells[1]!] }]);
      harness.apply(bob, [deleteColumn(bob, 1)]);
      resume();
      expectBoth(harness, [alice, bob], ['Before', { table: [[['a1', 'b1']], [['a2']]] }, 'After']);
    });

    test(`a vertical merge keeps the text of a deleted row (${label})`, async () => {
      const harness = harnessWith(clientIds);
      const { alice, bob, pause, resume } = await harness.pair(TWO_BY_TWO);
      pause();
      const cells = ids(alice, 'tc');
      const tableId = ids(alice, 'tbl')[0]!;
      harness.apply(alice, [{ op: 'mergeTableCells', tableId, cellIds: [cells[0]!, cells[2]!] }]);
      harness.apply(bob, [deleteRow(bob, 1)]);
      resume();
      const text = JSON.stringify(view(alice));
      harness.expectConverged(alice, bob);
      expect(text).toContain('"a1"');
      expect(text).toContain('"a2"');
    });

    test(`typing a merge carries keeps showing after a column delete (${label})`, async () => {
      const harness = harnessWith(clientIds);
      const { alice, bob, pause, resume } = await harness.pair(THREE_COLUMNS);
      harness.apply(alice, [
        { op: 'insertText', paragraphId: paragraphNamed(alice, 'c1'), offset: 2, text: 'T' },
      ]);
      pause();
      const cells = ids(alice, 'tc');
      const tableId = ids(alice, 'tbl')[0]!;
      harness.apply(alice, [{ op: 'mergeTableCells', tableId, cellIds: [cells[1]!, cells[2]!] }]);
      harness.apply(bob, [deleteColumn(bob, 2)]);
      resume();
      harness.expectConverged(alice, bob);
      expect(JSON.stringify(view(bob))).toContain('"c1T"');
    });
  }
});

describe('two peers delete one row and one of them undoes', () => {
  const NESTED = document(
    table([
      [table([[p('in1')], [p('in2')]]) + p('o1'), p('b1')],
      [p('a2'), p('b2')],
    ])
  );

  for (const { label, ids: clientIds } of ORDERS) {
    test(`a row holding a nested table stays deleted (${label})`, async () => {
      const harness = harnessWith(clientIds);
      const { alice, bob, pause, resume } = await harness.pair(NESTED);
      pause();
      harness.apply(alice, [
        { op: 'insertText', paragraphId: paragraphNamed(alice, 'in1'), offset: 3, text: 'X' },
      ]);
      harness.apply(alice, [deleteRow(alice)]);
      harness.apply(bob, [deleteRow(bob)]);
      expect(bob.room.session.undo()).toBe(true);
      resume();
      expectBoth(harness, [alice, bob], ['Before', { table: [[['a2'], ['b2']]] }, 'After']);
    });

    test(`both undo, then one redoes: the row is deleted again (${label})`, async () => {
      const harness = harnessWith(clientIds);
      const { alice, bob, pause, resume } = await harness.pair(TWO_BY_TWO);
      pause();
      harness.apply(alice, [deleteRow(alice)]);
      harness.apply(bob, [deleteRow(bob)]);
      resume();
      expect(alice.room.session.undo()).toBe(true);
      expect(bob.room.session.undo()).toBe(true);
      expectBoth(
        harness,
        [alice, bob],
        [
          'Before',
          {
            table: [
              [['a1'], ['b1']],
              [['a2'], ['b2']],
            ],
          },
          'After',
        ]
      );
      expect(bob.room.session.redo()).toBe(true);
      expectBoth(harness, [alice, bob], ['Before', { table: [[['a2'], ['b2']]] }, 'After']);
    });

    test(`a third peer's offline delete and undo do not bring it back (${label})`, async () => {
      const harness = harnessWith(clientIds);
      const { alice, bob, pause, resume } = await harness.pair(TWO_BY_TWO);
      // Carol works offline and syncs by hand when she reconnects.
      const carol = await harness.joinDetached(alice, 'carol');
      pause();
      harness.apply(alice, [deleteRow(alice)]);
      harness.apply(bob, [deleteRow(bob)]);
      harness.apply(carol, [
        { op: 'insertText', paragraphId: paragraphNamed(carol, 'a1'), offset: 2, text: 'Y' },
      ]);
      harness.apply(carol, [deleteRow(carol)]);
      expect(carol.room.session.undo()).toBe(true);
      resume();
      expect(bob.room.session.undo()).toBe(true);
      for (let round = 0; round < 2; round += 1) {
        for (const peer of [alice, bob]) {
          Y.applyUpdate(
            peer.ydoc,
            Y.encodeStateAsUpdate(carol.ydoc, Y.encodeStateVector(peer.ydoc)),
            'relay'
          );
          Y.applyUpdate(
            carol.ydoc,
            Y.encodeStateAsUpdate(peer.ydoc, Y.encodeStateVector(carol.ydoc)),
            'relay'
          );
        }
      }
      expectBoth(harness, [alice, bob, carol], ['Before', { table: [[['a2'], ['b2']]] }, 'After']);
    });
  }
});

describe('a redo after a peer wrote its dropped delete again', () => {
  // The undoing peer's write wins the shared key, so its undo empties it, and the other peer
  // writes its delete again. A redo of the first peer's delete must still stand on its own:
  // the other peer's later undo of its delete leaves the row deleted.
  const DELETED = ['Before', { table: [[['a2'], ['b2']]] }, 'After'];
  const BACK = [
    'Before',
    {
      table: [
        [['a1'], ['b1']],
        [['a2'], ['b2']],
      ],
    },
    'After',
  ];

  test('the redo stands when the other peer undoes', async () => {
    const harness = harnessWith({ alice: 10, bob: 20 });
    const { alice, bob, pause, resume } = await harness.pair(TWO_BY_TWO);
    pause();
    harness.apply(alice, [deleteRow(alice)]);
    harness.apply(bob, [deleteRow(bob)]);
    expect(bob.room.session.undo()).toBe(true);
    resume();
    expectBoth(harness, [alice, bob], DELETED);
    expect(bob.room.session.redo()).toBe(true);
    expectBoth(harness, [alice, bob], DELETED);
    expect(alice.room.session.undo()).toBe(true);
    expectBoth(harness, [alice, bob], DELETED);
    expect(bob.room.session.undo()).toBe(true);
    expectBoth(harness, [alice, bob], BACK);
    // Alice's undo took back nothing Bob's write had not replaced: her redo still deletes.
    expect(alice.room.session.redo()).toBe(true);
    expectBoth(harness, [alice, bob], DELETED);
    expect(alice.room.session.undo()).toBe(true);
    expectBoth(harness, [alice, bob], BACK);
  });

  test('with three peers, each later undo leaves the redo standing', async () => {
    const harness = harnessWith({ alice: 10, carol: 20, bob: 30 });
    const { alice, bob, pause, resume } = await harness.pair(TWO_BY_TWO);
    const carol = await harness.joinDetached(alice, 'carol');
    const sync = () => {
      for (let round = 0; round < 3; round += 1) {
        for (const peer of [alice, bob]) {
          Y.applyUpdate(
            peer.ydoc,
            Y.encodeStateAsUpdate(carol.ydoc, Y.encodeStateVector(peer.ydoc)),
            'relay'
          );
          Y.applyUpdate(
            carol.ydoc,
            Y.encodeStateAsUpdate(peer.ydoc, Y.encodeStateVector(carol.ydoc)),
            'relay'
          );
        }
      }
    };
    pause();
    harness.apply(alice, [deleteRow(alice)]);
    harness.apply(bob, [deleteRow(bob)]);
    harness.apply(carol, [deleteRow(carol)]);
    expect(bob.room.session.undo()).toBe(true);
    resume();
    sync();
    expectBoth(harness, [alice, bob, carol], DELETED);
    expect(bob.room.session.redo()).toBe(true);
    sync();
    expectBoth(harness, [alice, bob, carol], DELETED);
    expect(alice.room.session.undo()).toBe(true);
    sync();
    expectBoth(harness, [alice, bob, carol], DELETED);
    expect(carol.room.session.undo()).toBe(true);
    sync();
    expectBoth(harness, [alice, bob, carol], DELETED);
    expect(bob.room.session.undo()).toBe(true);
    sync();
    expectBoth(harness, [alice, bob, carol], BACK);
  });

  test('when both peers redo, the last undo brings the row back', async () => {
    const harness = harnessWith({ alice: 10, bob: 20 });
    const { alice, bob, pause, resume } = await harness.pair(TWO_BY_TWO);
    pause();
    harness.apply(alice, [deleteRow(alice)]);
    harness.apply(bob, [deleteRow(bob)]);
    expect(bob.room.session.undo()).toBe(true);
    resume();
    expect(alice.room.session.undo()).toBe(true);
    expectBoth(harness, [alice, bob], BACK);
    expect(bob.room.session.redo()).toBe(true);
    expectBoth(harness, [alice, bob], DELETED);
    expect(alice.room.session.redo()).toBe(true);
    expectBoth(harness, [alice, bob], DELETED);
    expect(alice.room.session.undo()).toBe(true);
    expectBoth(harness, [alice, bob], DELETED);
    expect(bob.room.session.undo()).toBe(true);
    expectBoth(harness, [alice, bob], BACK);
  });
});
