/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Cell merge and split between two participants: concurrent typing, row and column edits,
// merge against split, undo and redo, reconnect, a late joiner, and save and reopen.

import { afterEach, describe, expect, test } from 'bun:test';
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

afterEach(() => {
  harness.cleanup();
});

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
