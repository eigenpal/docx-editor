/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A long table's row edits restart its pagination at a kept page, and its rows are reused
// across structure reads. Between two participants, each keeps a layout session over its own
// store: remote row inserts and deletes arrive between local layout passes, concurrent with
// local row edits, with typing in a row the other peer deletes, and with undo and redo. After each step both
// peers' layouts equal a fresh layout of the same document, and the documents converge.

import { afterEach, expect, test } from 'bun:test';
import type { OoxmlElement, OoxmlNode, TreeDocOp } from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../../../../core/src/layout/layout-session.ts';
import { createParagraphLayoutCache } from '../../../../core/src/layout/layout-cache.ts';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
} from '../../../../core/src/layout/semantic-layout.ts';
import { tablePageRestartTestRecorder } from '../../../../core/src/layout/table-page-restart.ts';
import { createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('table-restart-layout-room');
afterEach(() => harness.cleanup());

const ROWS = 120;
const P = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const CELL = (content: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
const rule = (edge: string) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;
// A thick compound bottom rule: a row that ends a page fits only when the next row follows it.
const BORDERS =
  `<w:tblBorders>${['top', 'left', 'right', 'insideV', 'insideH'].map(rule).join('')}` +
  '<w:bottom w:val="thickThinLargeGap" w:sz="96" w:space="0" w:color="000000"/></w:tblBorders>';
/** Exact-height, `w:cantSplit`, and plain rows. */
const ROW = (r: number) => {
  const trPr =
    r % 5 === 0
      ? `<w:trPr><w:trHeight w:val="${600 + 200 * (r % 4)}" w:hRule="exact"/></w:trPr>`
      : r % 5 === 2
        ? '<w:trPr><w:cantSplit/></w:trPr>'
        : '';
  const first =
    r % 5 === 2 ? `<w:p><w:r><w:t>C${r}</w:t><w:br/><w:t>x</w:t></w:r></w:p>` : P(`R${r}a`);
  return `<w:tr>${trPr}${CELL(first)}${CELL(P(`R${r}b`))}</w:tr>`;
};
const FIXTURE = zipDocument(
  P('Before the table') +
    `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblLayout w:type="fixed"/>${BORDERS}</w:tblPr>` +
    '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
    Array.from({ length: ROWS }, (_, r) => ROW(r)).join('') +
    `</w:tbl>${P('After the table')}` +
    '<w:sectPr><w:pgSz w:w="7000" w:h="4200"/><w:pgMar w:top="400" w:bottom="400" w:left="400" ' +
    'w:right="400" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
);

const measurer = createFixedMeasurer(6, 14);
const partOf = (peer: Peer) => peer.store.bodyStore().part;

/** A layout session over one peer's store, as an editor keeps one between passes. */
function viewOf(peer: Peer) {
  const session = createLayoutSession();
  // The layout cache's line type comes through two module paths here.
  const cache = createParagraphLayoutCache() as Parameters<
    typeof layoutSemanticDocument
  >[2]['cache'];
  let revision = 0;
  const lay = () =>
    layoutSemanticDocument(partOf(peer), (revision += 1), {
      measurer,
      compatibilityMode: 15,
      session,
      cache,
    });
  lay();
  return {
    /** Lay out incrementally and expect the pages of a fresh layout of the same document. */
    check(label: string): ReturnType<typeof lay> {
      const live = lay();
      const fresh = layoutSemanticDocument(partOf(peer), revision, {
        measurer,
        compatibilityMode: 15,
      });
      expect([label, live.pages.length > 3]).toEqual([label, true]);
      expect([label, JSON.stringify(live.pages)]).toEqual([label, JSON.stringify(fresh.pages)]);
      return live;
    },
  };
}

function tableOf(peer: Peer): OoxmlElement {
  let found: OoxmlElement | null = null;
  walk(partOf(peer).root, (node) => {
    if (!found && node.kind === 'table') found = node as OoxmlElement;
  });
  if (!found) throw new Error('no table');
  return found;
}
const rows = (peer: Peer) =>
  tableOf(peer).children.filter((child): child is OoxmlElement => child.kind === 'tableRow');
const firstParagraph = (row: OoxmlNode): OoxmlNode => {
  let found: OoxmlNode | null = null;
  walk(row, (node) => {
    if (!found && node.kind === 'paragraph') found = node;
  });
  if (!found) throw new Error('no paragraph');
  return found;
};

const insertRow = (peer: Peer, at: number, where: 'above' | 'below'): TreeDocOp => ({
  op: 'insertTableRow',
  tableId: tableOf(peer).id,
  rowId: rows(peer)[at]!.id,
  where,
});
const deleteRow = (peer: Peer, at: number): TreeDocOp => ({
  op: 'deleteTableRow',
  tableId: tableOf(peer).id,
  rowId: rows(peer)[at]!.id,
});
const rowHeight = (peer: Peer, at: number, heightTwips: number): TreeDocOp => ({
  op: 'setTableRowHeight',
  tableId: tableOf(peer).id,
  rowId: rows(peer)[at]!.id,
  heightTwips,
});

test('remote row edits between local layout passes keep both peers equal to a fresh layout', async () => {
  const pair = await harness.pair(FIXTURE);
  const { alice, bob } = pair;
  const views = { alice: viewOf(alice), bob: viewOf(bob) };
  const checkBoth = (label: string) => {
    views.alice.check(`alice ${label}`);
    const layout = views.bob.check(`bob ${label}`);
    harness.expectConverged(alice, bob);
    return layout;
  };
  const restarts = tablePageRestartTestRecorder();
  try {
    // One peer edits, and the other lays out after the edit arrives.
    harness.apply(alice, [insertRow(alice, 80, 'below')]);
    checkBoth('remote insert');
    harness.apply(bob, [deleteRow(bob, 60)]);
    const layout = checkBoth('remote delete');
    // The rows beside rows that open a page decide those breaks.
    const openers = layout.pages
      .flatMap((page) => page.fragments)
      .flatMap((fragment) => (fragment.kind === 'table' ? [fragment.rows[0]!.id] : []))
      .slice(1, 6);
    for (const opener of openers) {
      const at = rows(alice).findIndex((row) => row.id === opener);
      harness.apply(alice, [rowHeight(alice, at + 1, 200)]);
      checkBoth(`remote height after row ${at}`);
      harness.apply(bob, [rowHeight(bob, at - 1, 200)]);
      checkBoth(`remote height before row ${at}`);
    }

    // Both edit rows at once: each lays out its own edit before the other's arrives.
    pair.pause();
    harness.apply(alice, [insertRow(alice, 30, 'above')]);
    harness.apply(bob, [deleteRow(bob, 90), insertRow(bob, 95, 'below')]);
    views.alice.check('alice local before merge');
    views.bob.check('bob local before merge');
    pair.resume();
    checkBoth('concurrent row edits');

    // One peer types in a row the other deletes.
    const target = 70;
    const paragraph = firstParagraph(rows(alice)[target]!);
    pair.pause();
    harness.apply(alice, [
      { op: 'insertText', paragraphId: paragraph.id, offset: 0, text: 'typed while deleted ' },
    ]);
    harness.apply(bob, [deleteRow(bob, target)]);
    views.alice.check('alice typing before merge');
    views.bob.check('bob delete before merge');
    pair.resume();
    checkBoth('typing in a deleted row');

    // A row near the end and the first row.
    harness.apply(bob, [insertRow(bob, rows(bob).length - 1, 'below'), deleteRow(bob, 0)]);
    checkBoth('end and start');

    // Undo and redo of row edits, each laid out by both peers between the steps.
    harness.apply(alice, [insertRow(alice, 50, 'below')]);
    checkBoth('insert before undo');
    expect(alice.room.session.undo()).toBe(true);
    checkBoth('undo of an insert');
    expect(alice.room.session.redo()).toBe(true);
    checkBoth('redo of an insert');
    harness.apply(bob, [deleteRow(bob, 45)]);
    checkBoth('delete before undo');
    expect(bob.room.session.undo()).toBe(true);
    checkBoth('undo of a delete');
    // One peer undoes while the other deletes rows near the restored row.
    pair.pause();
    expect(alice.room.session.undo()).toBe(true);
    harness.apply(bob, [deleteRow(bob, 52), deleteRow(bob, 48)]);
    views.alice.check('alice undo before merge');
    views.bob.check('bob delete before merge');
    pair.resume();
    checkBoth('undo concurrent with deletes');
  } finally {
    restarts.dispose();
  }
  // The checks cover passes that restart at a kept page.
  expect(restarts.restarts).toBeGreaterThan(0);
}, 60_000);
