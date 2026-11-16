/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Cell merge and split between two participants: concurrent typing, row and column edits,
// merge against split, undo and redo, reconnect, a late joiner, and save and reopen.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlElement,
  type OoxmlNode,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('table-merge-split-room');
/** Fixed client IDs, for a case whose outcome depends on which concurrent write Yjs keeps. */
const ordered = createPeerHarness('table-merge-split-ordered', undefined, {
  alice: 100,
  bob: 200,
  carol: 300,
  late: 999,
});

afterEach(() => {
  harness.cleanup();
  ordered.cleanup();
});

/** Deliver every update between the peers, a detached one among them, until they agree. */
function syncAll(peers: readonly Peer[]): void {
  for (let round = 0; round < 3; round += 1) {
    for (const from of peers) {
      for (const to of peers) {
        if (from === to) continue;
        const update = Y.encodeStateAsUpdate(from.ydoc, Y.encodeStateVector(to.ydoc));
        Y.applyUpdate(to.ydoc, update, 'relay');
      }
    }
  }
}

const P = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const CELL = (text: string) => `<w:tc>${P(text)}</w:tc>`;
const ROW = (...cells: string[]) => `<w:tr>${cells.join('')}</w:tr>`;
const TABLE = zipDocument(
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
    ROW(CELL('a'), CELL('b'), CELL('c')) +
    ROW(CELL('d'), CELL('e'), CELL('f')) +
    ROW(CELL('g'), CELL('h'), CELL('i')) +
    `</w:tbl>${P('Tail')}<w:sectPr/>`
);

function tableOf(peer: Peer): OoxmlElement {
  let found: OoxmlElement | null = null;
  walk(peer.store.bodyStore().part.root, (node) => {
    if (!found && node.kind === 'table') found = node;
  });
  if (!found) throw new Error('no table');
  return found;
}

function cellIds(peer: Peer): string[][] {
  return tableOf(peer)
    .children.filter((child) => child.kind === 'tableRow')
    .map((row) =>
      (row as OoxmlElement).children.filter((c) => c.kind === 'tableCell').map((c) => c.id)
    );
}

function cellParagraph(peer: Peer, row: number, cell: number): OoxmlNode {
  const table = tableOf(peer);
  const target = cellIds(peer)[row]![cell]!;
  let found: OoxmlNode | null = null;
  walk(table, (node) => {
    if (found || node.id !== target) return;
    walk(node, (inner) => {
      if (!found && inner.kind === 'paragraph') found = inner;
    });
  });
  if (!found) throw new Error('no cell paragraph');
  return found;
}

/** Rows of cell texts, paragraphs joined by `+`. */
function texts(peer: Peer): string[][] {
  return tableOf(peer)
    .children.filter((child) => child.kind === 'tableRow')
    .map((row) =>
      (row as OoxmlElement).children
        .filter((c) => c.kind === 'tableCell')
        .map((cell) =>
          (cell as OoxmlElement).children
            .filter((c) => c.kind === 'paragraph')
            .map(nodeText)
            .join('+')
        )
    );
}

function gridColumns(peer: Peer): string[] {
  const grid = tableOf(peer).children.find(
    (child) => child.kind !== 'textValue' && child.localName === 'tblGrid'
  ) as OoxmlElement;
  return grid.children.map((child) => child.id);
}

function merge(peer: Peer, rows: readonly [number, number][]): TreeDocOp {
  const ids = cellIds(peer);
  return {
    op: 'mergeTableCells',
    tableId: tableOf(peer).id,
    cellIds: rows.map(([row, cell]) => ids[row]![cell]!),
  };
}

function split(peer: Peer, row: number, cell: number, rows: number, columns: number): TreeDocOp {
  return {
    op: 'splitTableCell',
    tableId: tableOf(peer).id,
    cellId: cellIds(peer)[row]![cell]!,
    rows,
    columns,
  };
}

/** Every row of the table covers the same grid, so the result is a table a reader can open. */
function expectWholeGrid(peer: Peer): void {
  const bytes = writeOoxmlPackage(harness.packageOf(peer));
  const reopened = readOoxmlPackage(bytes);
  expect(reopened.ok).toBe(true);
  const columns = gridColumns(peer).length;
  for (const row of tableOf(peer).children.filter((child) => child.kind === 'tableRow')) {
    let covered = 0;
    for (const cell of (row as OoxmlElement).children) {
      if (cell.kind !== 'tableCell') continue;
      const tcPr = cell.children.find((c) => c.localName === 'tcPr') as OoxmlElement | undefined;
      const span = tcPr?.children.find(
        (c) => c.kind !== 'textValue' && c.localName === 'gridSpan'
      ) as OoxmlElement | undefined;
      covered += Number(span?.attributes.find((a) => a.localName === 'val')?.value ?? '1');
    }
    expect(covered).toBe(columns);
  }
}

async function concurrently(
  alice: (peer: Peer) => TreeDocOp[],
  bob: (peer: Peer) => TreeDocOp[]
): Promise<{ alice: Peer; bob: Peer }> {
  const pair = await harness.pair(TABLE);
  // Both build their ops against the shared start, then edit at once.
  const aliceOps = alice(pair.alice);
  const bobOps = bob(pair.bob);
  pair.pause();
  harness.apply(pair.alice, aliceOps);
  harness.apply(pair.bob, bobOps);
  pair.resume();
  expect(pair.alice.room.session.status()).toBe('ready');
  expect(pair.bob.room.session.status()).toBe('ready');
  harness.expectConverged(pair.alice, pair.bob);
  const late = await harness.join(pair.alice, 'late');
  harness.expectConverged(pair.alice, late);
  return pair;
}

describe('cell merge in collaboration', () => {
  test('a merge synchronizes, undoes, redoes, and survives reconnect and reopen', async () => {
    const { alice, bob } = await harness.pair(TABLE);
    harness.apply(alice, [
      merge(alice, [
        [0, 0],
        [0, 2],
      ]),
    ]);
    harness.expectConverged(alice, bob);
    expect(texts(bob)).toEqual([['a+b+c'], ['d', 'e', 'f'], ['g', 'h', 'i']]);
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(texts(bob)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      ['g', 'h', 'i'],
    ]);
    expect(alice.room.session.redo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(texts(bob)[0]).toEqual(['a+b+c']);
    const reconnected = await harness.remount(bob);
    harness.expectConverged(alice, reconnected);
    expectWholeGrid(reconnected);
  });

  test('a rectangle merge moves every cell content into the merged cell on both peers', async () => {
    const { alice, bob } = await harness.pair(TABLE);
    harness.apply(alice, [
      merge(alice, [
        [0, 0],
        [1, 1],
      ]),
    ]);
    expect(texts(alice)[0]![0]).toBe('a+b+d+e');
    harness.expectConverged(alice, bob);
    expect(texts(bob)[0]![0]).toBe('a+b+d+e');
  });

  test('typing in a cell a peer merges away keeps the typing in the merged cell', async () => {
    const { alice } = await concurrently(
      (peer) => [
        merge(peer, [
          [0, 0],
          [1, 1],
        ]),
      ],
      (peer) => [
        { op: 'insertText', paragraphId: cellParagraph(peer, 1, 1).id, offset: 1, text: 'X' },
      ]
    );
    expect(texts(alice)[0]![0]).toBe('a+b+d+eX');
    expectWholeGrid(alice);
  });

  test('a merge while a peer inserts a row inside the merged rows converges', async () => {
    const { alice } = await concurrently(
      (peer) => [
        merge(peer, [
          [0, 0],
          [2, 0],
        ]),
      ],
      (peer) => [
        {
          op: 'insertTableRow',
          tableId: tableOf(peer).id,
          rowId: tableOf(peer).children.filter((c) => c.kind === 'tableRow')[1]!.id,
          where: 'below',
        },
      ]
    );
    expect(nodeText(tableOf(alice))).toContain('adg');
    expect(texts(alice).length).toBe(4);
  });

  test('a merge while a peer deletes a merged column converges', async () => {
    const { alice } = await concurrently(
      (peer) => [
        merge(peer, [
          [0, 0],
          [0, 2],
        ]),
      ],
      (peer) => [
        { op: 'deleteTableColumn', tableId: tableOf(peer).id, gridColumnId: gridColumns(peer)[2]! },
      ]
    );
    expect(texts(alice).length).toBe(3);
  });

  test('a merge and a split of the same cells converge', async () => {
    const { alice } = await concurrently(
      (peer) => [
        merge(peer, [
          [0, 0],
          [0, 1],
        ]),
      ],
      (peer) => [split(peer, 0, 0, 1, 2)]
    );
    expect(nodeText(tableOf(alice))).toContain('a');
    expect(nodeText(tableOf(alice))).toContain('b');
  });

  test('typing in an empty cell a peer merges away is discarded on every replica', async () => {
    // The merge drops an empty cell's paragraph, as deleting an empty paragraph does, and text
    // typed into it at the same time goes with it. Both replicas and a late joiner agree.
    const empty = zipDocument(
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
        ROW(CELL('a'), '<w:tc><w:p/></w:tc>') +
        ROW(CELL('c'), CELL('d')) +
        `</w:tbl>${P('Tail')}<w:sectPr/>`
    );
    const pair = await harness.pair(empty);
    const mergeOp = merge(pair.alice, [
      [0, 0],
      [0, 1],
    ]);
    const typing: TreeDocOp = {
      op: 'insertText',
      paragraphId: cellParagraph(pair.bob, 0, 1).id,
      offset: 0,
      text: 'TYPED',
    };
    pair.pause();
    harness.apply(pair.alice, [mergeOp]);
    harness.apply(pair.bob, [typing]);
    pair.resume();
    harness.expectConverged(pair.alice, pair.bob);
    const late = await harness.join(pair.alice, 'late');
    harness.expectConverged(pair.alice, late);
    expect(texts(late)).toEqual([['a'], ['c', 'd']]);
    expectWholeGrid(late);
  });

  test("undo of a merge keeps a peer's typing made after it", async () => {
    const { alice, bob } = await harness.pair(TABLE);
    harness.apply(alice, [
      merge(alice, [
        [1, 0],
        [1, 2],
      ]),
    ]);
    harness.expectConverged(alice, bob);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: cellParagraph(bob, 1, 0).id, offset: 0, text: 'Z' },
    ]);
    harness.expectConverged(alice, bob);
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(nodeText(tableOf(bob))).toContain('Z');
  });

  // Both peers merge the same cells at once, and one undoes its merge. The undo empties the
  // other peer's deletion of the merged-away cell, which that peer writes again. A paragraph
  // the undoing peer split in that cell meanwhile is listed only there, so it shows only when
  // the cell keeps the survivor its merge named.
  test('a paragraph split in a cell two peers merge away stays when one peer undoes', async () => {
    const pair = await harness.pair(TABLE);
    const { alice, bob } = pair;
    const merged = (peer: Peer) =>
      merge(peer, [
        [0, 0],
        [0, 1],
      ]);
    const paragraph = cellParagraph(alice, 0, 1).id;
    pair.pause();
    harness.apply(alice, [merged(alice)]);
    alice.room.session.flushPendingJournals();
    expect(alice.room.session.undo()).toBe(true);
    harness.apply(bob, [merged(bob)]);
    harness.apply(alice, [
      { op: 'insertText', paragraphId: paragraph, offset: 1, text: 'XY' },
      { op: 'splitParagraph', paragraphId: paragraph, offset: 0 },
    ]);
    pair.resume();
    harness.expectConverged(alice, bob);
    expect(texts(alice)[0]).toEqual(['a++bXY', 'c']);
    const late = await harness.join(alice, 'late');
    harness.expectConverged(alice, late);
    expectWholeGrid(late);
    // Undo and redo on both sides keep the typed paragraph.
    alice.room.session.flushPendingJournals();
    bob.room.session.flushPendingJournals();
    expect(bob.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(nodeText(tableOf(alice))).toContain('bXY');
    expect(bob.room.session.redo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(texts(bob)[0]).toEqual(['a++bXY', 'c']);
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(nodeText(tableOf(bob))).toContain('b');
    for (const peer of [alice, bob]) expect(peer.room.session.status()).toBe('ready');
  });

  // The peer that undid redoes its merge after the other peer wrote its survivor again, and
  // then the other peer undoes. The redo writes its own survivor too, so the cell keeps one.
  test('a paragraph split in a cell two peers merge away stays through a redo and an undo', async () => {
    const pair = await harness.pair(TABLE);
    const { alice, bob } = pair;
    const carol = await harness.joinDetached(alice, 'carol');
    const sync = () => syncAll([alice, bob, carol]);
    const merged = (peer: Peer) =>
      merge(peer, [
        [0, 0],
        [0, 1],
      ]);
    const paragraph = cellParagraph(carol, 0, 1).id;
    pair.pause();
    harness.apply(alice, [merged(alice)]);
    alice.room.session.flushPendingJournals();
    expect(alice.room.session.undo()).toBe(true);
    harness.apply(bob, [merged(bob)]);
    harness.apply(carol, [
      { op: 'insertText', paragraphId: paragraph, offset: 1, text: 'XY' },
      { op: 'splitParagraph', paragraphId: paragraph, offset: 0 },
    ]);
    pair.resume();
    sync();
    for (const peer of [bob, carol]) harness.expectConverged(alice, peer);
    expect(texts(alice)[0]).toEqual(['a++bXY', 'c']);
    alice.room.session.flushPendingJournals();
    bob.room.session.flushPendingJournals();
    expect(alice.room.session.redo()).toBe(true);
    sync();
    expect(bob.room.session.undo()).toBe(true);
    sync();
    for (const peer of [bob, carol]) harness.expectConverged(alice, peer);
    expect(texts(carol)[0]).toEqual(['a++bXY', 'c']);
    const late = await harness.join(alice, 'late');
    harness.expectConverged(alice, late);
    expect(texts(late)[0]).toEqual(['a++bXY', 'c']);
    expectWholeGrid(late);
    for (const peer of [alice, bob, carol]) expect(peer.room.session.status()).toBe('ready');
  });

  // The two keys of a merged-away cell resolve apart: a column delete and undo that only alice
  // saw makes Yjs keep alice's deletion and bob's survivor. Bob's undo then empties only the
  // survivor, and alice writes the survivor her merge named again.
  test('a merged-away cell keeps a survivor when an undo empties only the survivor', async () => {
    const pair = await ordered.pair(TABLE);
    const { alice, bob } = pair;
    const carol = await ordered.joinDetached(alice, 'carol');
    pair.pause();
    ordered.apply(carol, [
      { op: 'deleteTableColumn', tableId: tableOf(carol).id, gridColumnId: gridColumns(carol)[1]! },
    ]);
    carol.room.session.flushPendingJournals();
    expect(carol.room.session.undo()).toBe(true);
    syncAll([carol, alice]);
    carol.room.session.flushPendingJournals();
    const paragraph = cellParagraph(carol, 0, 1).id;
    ordered.apply(carol, [
      { op: 'insertText', paragraphId: paragraph, offset: 1, text: 'XY' },
      { op: 'splitParagraph', paragraphId: paragraph, offset: 0 },
    ]);
    for (const peer of [alice, bob]) {
      ordered.apply(peer, [
        merge(peer, [
          [0, 0],
          [0, 1],
        ]),
      ]);
      peer.room.session.flushPendingJournals();
    }
    pair.resume();
    syncAll([alice, bob, carol]);
    expect(bob.room.session.undo()).toBe(true);
    syncAll([alice, bob, carol]);
    for (const peer of [bob, carol]) ordered.expectConverged(alice, peer);
    expect(texts(carol)[0]).toEqual(['a++bXY', 'c']);
    expect(alice.room.session.undo()).toBe(true);
    syncAll([alice, bob, carol]);
    expect(alice.room.session.redo()).toBe(true);
    expect(bob.room.session.redo()).toBe(true);
    syncAll([alice, bob, carol]);
    for (const peer of [bob, carol]) ordered.expectConverged(alice, peer);
    expect(nodeText(tableOf(alice))).toContain('bXY');
    const late = await ordered.join(alice, 'late');
    ordered.expectConverged(alice, late);
    for (const peer of [alice, bob, carol]) expect(peer.room.session.status()).toBe('ready');
  });
});

describe('cell split in collaboration', () => {
  test('a split synchronizes, undoes, redoes, and survives reconnect and reopen', async () => {
    const { alice, bob } = await harness.pair(TABLE);
    harness.apply(alice, [split(alice, 1, 1, 2, 2)]);
    harness.expectConverged(alice, bob);
    expect(texts(bob).length).toBe(4);
    expect(gridColumns(bob).length).toBe(4);
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(texts(bob)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      ['g', 'h', 'i'],
    ]);
    expect(alice.room.session.redo()).toBe(true);
    harness.expectConverged(alice, bob);
    const reconnected = await harness.remount(bob);
    harness.expectConverged(alice, reconnected);
    expectWholeGrid(reconnected);
  });

  test('typing in a cell a peer splits keeps the typing in the first new cell', async () => {
    const { alice } = await concurrently(
      (peer) => [split(peer, 1, 1, 1, 3)],
      (peer) => [
        { op: 'insertText', paragraphId: cellParagraph(peer, 1, 1).id, offset: 1, text: 'Y' },
      ]
    );
    expect(texts(alice)[1]![1]).toBe('eY');
  });

  test('two peers split different cells of one row and converge', async () => {
    const { alice } = await concurrently(
      (peer) => [split(peer, 0, 0, 1, 2)],
      (peer) => [split(peer, 0, 2, 1, 2)]
    );
    expect(nodeText(tableOf(alice))).toContain('abc');
  });

  test('a split into rows while a peer deletes that row converges', async () => {
    const { alice } = await concurrently(
      (peer) => [split(peer, 1, 0, 2, 1)],
      (peer) => [
        {
          op: 'deleteTableRow',
          tableId: tableOf(peer).id,
          rowId: tableOf(peer).children.filter((c) => c.kind === 'tableRow')[1]!.id,
        },
      ]
    );
    expect(nodeText(tableOf(alice))).toContain('a');
  });
});
