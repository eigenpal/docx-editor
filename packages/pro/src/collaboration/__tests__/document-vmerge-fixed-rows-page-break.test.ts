/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two vertical merges (`w:vMerge`, `CT_VMerge`, ECMA-376 Part 1, 17.4.84) from one head row
// over `hRule="exact"` rows (`w:trHeight`, `CT_Height`, 17.4.80; `ST_HeightRule`, 17.18.37).
// The page break falls below the head row, so the merged text continues on the next page.
// Live replicas lay out the same text there after concurrent edits, undo, redo, a deletion
// during a remote edit, and a cold join.
import { afterEach, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument } from '../../../../core/src/layout/semantic-layout.ts';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('vmerge-fixed-rows-page-break', { offlineEditing: true });
afterEach(() => harness.cleanup());

const p = (text: string) =>
  '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="exact" w:before="0" w:after="0"/></w:pPr>' +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (body: string, merge = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${merge}</w:tcPr>${body}</w:tc>`;
const RESTART = '<w:vMerge w:val="restart"/>';
const CONTINUE = '<w:vMerge/>';
const tr = (twips: number, cells: string) =>
  `<w:tr><w:trPr><w:trHeight w:val="${twips}" w:hRule="exact"/></w:trPr>${cells}</w:tr>`;
// The 630pt opening paragraph leaves room for the 6pt head row only.
const body =
  '<w:p><w:pPr><w:spacing w:line="12600" w:lineRule="exact"/></w:pPr><w:r><w:t>Intro</w:t></w:r></w:p>' +
  '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
  tr(
    120,
    tc(p('SHORT-1') + p('SHORT-2') + p('SHORT-3'), RESTART) + tc(p('M0')) + tc(p('LONG'), RESTART)
  ) +
  tr(1000, tc('<w:p/>', CONTINUE) + tc(p('M1')) + tc('<w:p/>', CONTINUE)) +
  tr(400, tc(p('K2')) + tc(p('M2')) + tc('<w:p/>', CONTINUE)) +
  '</w:tbl><w:p/>';
const geometry = { width: 612, height: 720, margin: { top: 40, bottom: 40, left: 40, right: 40 } };
const measurer = {
  measure: (text: string) => [...text].length * 5,
  lineMetrics: () => ({ height: 12, baseline: 10 }),
};

function paragraph(peer: Peer, label: string): OoxmlNode {
  let result: OoxmlNode | undefined;
  walk(peer.store.bodyStore().part.root, (node) => {
    if (result === undefined && node.kind === 'paragraph' && nodeText(node).startsWith(label))
      result = node;
  });
  if (!result) throw new Error(`Missing synthetic paragraph ${label}`);
  return result;
}

type Layout = ReturnType<typeof layoutSemanticDocument>;

type Block = Layout['pages'][number]['fragments'][number];

/** The merged lines of a block, with the lines of nested tables in it. */
function mergedLines(block: Block): string[] {
  if (block.kind === 'paragraph')
    return block.lines
      .map((line) => line.spans.map((span) => span.text).join(''))
      .filter((text) => /^(SHORT|LONG|STAIR|NESTED)/.test(text));
  if (block.kind !== 'table') return [];
  return block.rows.flatMap((row) =>
    row.cells.flatMap((cell) => cell.blocks.flatMap((child) => mergedLines(child)))
  );
}

/** Each merged line's text on each page, as the layout paints it. */
function mergedTextOf(layout: Layout): string[][] {
  return layout.pages.map((page) => page.fragments.flatMap(mergedLines));
}

/** The live layout's merged text, which a save and reopen keeps. */
function mergedTextByPage(peer: Peer): string[][] {
  const part = peer.store.bodyStore().part;
  const revision = peer.store.bodyStore().revision;
  const live = mergedTextOf(layoutSemanticDocument(part, revision, { geometry, measurer }));
  const reopened = readOoxmlPart(serializeOoxmlPart(part), {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!reopened.ok) throw new Error(reopened.reason);
  expect(
    mergedTextOf(layoutSemanticDocument(reopened.part, revision, { geometry, measurer }))
  ).toEqual(live);
  return live;
}

function expectCarried(peer: Peer, expected: readonly string[]): void {
  const pages = mergedTextByPage(peer);
  expect(pages[0]).toEqual([]);
  expect([...pages[1]!].sort()).toEqual([...expected].sort());
}

test('live replicas carry merged text over fixed rows to the next page', async () => {
  const { alice, bob, pause, resume } = await harness.pair(zipDocument(body));
  const initial = ['SHORT-1', 'SHORT-2', 'SHORT-3', 'LONG'];
  expectCarried(alice, initial);
  expectCarried(bob, initial);

  pause();
  harness.apply(alice, [
    { op: 'insertText', paragraphId: paragraph(alice, 'SHORT-2').id, offset: 7, text: 'a' },
  ]);
  harness.apply(bob, [
    { op: 'insertText', paragraphId: paragraph(bob, 'LONG').id, offset: 4, text: 'b' },
  ]);
  resume();
  harness.expectConverged(alice, bob);
  const edited = ['SHORT-1', 'SHORT-2a', 'SHORT-3', 'LONGb'];
  expectCarried(alice, edited);
  expectCarried(bob, edited);

  expect(alice.room.session.undo()).toBe(true);
  harness.expectConverged(alice, bob);
  expectCarried(bob, ['SHORT-1', 'SHORT-2', 'SHORT-3', 'LONGb']);
  expect(alice.room.session.redo()).toBe(true);
  harness.expectConverged(alice, bob);
  expectCarried(bob, edited);

  // Alice deletes a merged paragraph while Bob types into the next one.
  pause();
  harness.apply(alice, [{ op: 'deleteBlock', blockId: paragraph(alice, 'SHORT-1').id }]);
  harness.apply(bob, [
    { op: 'insertText', paragraphId: paragraph(bob, 'SHORT-3').id, offset: 7, text: 'c' },
  ]);
  resume();
  harness.expectConverged(alice, bob);
  const settled = ['SHORT-2a', 'SHORT-3c', 'LONGb'];
  expectCarried(alice, settled);
  expectCarried(bob, settled);

  const cold = await harness.remount(bob);
  harness.expectConverged(alice, cold);
  expectCarried(cold, settled);
});

/**
 * For each merged cell on the second page, the gap between its last line and its bottom.
 * `w:vAlign` (`CT_VerticalJc`, 17.4.83) aligns the text there, where its first line is placed.
 */
function bottomGaps(peer: Peer): number[] {
  const part = peer.store.bodyStore().part;
  const layout = layoutSemanticDocument(part, peer.store.bodyStore().revision, {
    geometry,
    measurer,
  });
  return layout.pages[1]!.fragments.flatMap((fragment) =>
    fragment.kind === 'table'
      ? fragment.rows.flatMap((row) =>
          row.cells
            .filter((cell) =>
              cell.blocks.some(
                (block) =>
                  block.kind === 'paragraph' &&
                  block.lines.some((line) =>
                    /^(SHORT|LONG)/.test(line.spans.map((span) => span.text).join(''))
                  )
              )
            )
            .map(
              (cell) =>
                cell.box.y +
                cell.box.height -
                Math.max(...cell.blocks.map((block) => block.box.y + block.box.height))
            )
        )
      : []
  );
}

test('live replicas keep the alignment of merged text that moves to the next page', async () => {
  const aligned = body.replaceAll('</w:tcPr>', '<w:vAlign w:val="bottom"/></w:tcPr>');
  const { alice, bob, pause, resume } = await harness.pair(zipDocument(aligned));
  const expectBottom = (peer: Peer) => {
    const gaps = bottomGaps(peer);
    expect(gaps.length).toBe(2);
    for (const gap of gaps) expect(gap).toBeCloseTo(0, 3);
  };
  expectBottom(alice);
  expectBottom(bob);

  pause();
  harness.apply(alice, [{ op: 'deleteBlock', blockId: paragraph(alice, 'SHORT-1').id }]);
  harness.apply(bob, [
    { op: 'insertText', paragraphId: paragraph(bob, 'SHORT-2').id, offset: 7, text: 'b' },
  ]);
  resume();
  harness.expectConverged(alice, bob);
  expectCarried(alice, ['SHORT-2b', 'SHORT-3', 'LONG']);
  expectBottom(alice);
  expectBottom(bob);

  expect(alice.room.session.undo()).toBe(true);
  harness.expectConverged(alice, bob);
  expectBottom(bob);
  expect(alice.room.session.redo()).toBe(true);
  harness.expectConverged(alice, bob);
  expectBottom(bob);
});

test('live replicas carry a line break and a merge that starts in a covered row', async () => {
  // SHORT-1 starts after a line break (`w:br`, 17.3.3.1), a nested table (`w:tbl`, 17.4.37)
  // follows SHORT-2, and the column 1 merge starts in row 1, which the column 0 merge covers.
  // All of them carry their text to the next page.
  const staircase = body
    .replace('<w:r><w:t>SHORT-1</w:t></w:r>', '<w:r><w:br/><w:t>SHORT-1</w:t></w:r>')
    .replace(
      p('SHORT-2'),
      p('SHORT-2') +
        '<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
        `<w:tr>${tc(p('NESTED'))}</w:tr></w:tbl>`
    )
    .replace(tc(p('M1')), tc(p('STAIR'), RESTART))
    .replace(tc(p('M2')), tc('<w:p/>', CONTINUE));
  const { alice, bob, pause, resume } = await harness.pair(zipDocument(staircase));
  const initial = ['SHORT-1', 'SHORT-2', 'NESTED', 'SHORT-3', 'LONG', 'STAIR'];
  expectCarried(alice, initial);
  expectCarried(bob, initial);

  pause();
  harness.apply(alice, [
    { op: 'insertText', paragraphId: paragraph(alice, 'STAIR').id, offset: 5, text: 'a' },
  ]);
  harness.apply(bob, [{ op: 'deleteBlock', blockId: paragraph(bob, 'SHORT-2').id }]);
  resume();
  harness.expectConverged(alice, bob);
  const edited = ['SHORT-1', 'NESTED', 'SHORT-3', 'LONG', 'STAIRa'];
  expectCarried(alice, edited);
  expectCarried(bob, edited);

  expect(alice.room.session.undo()).toBe(true);
  harness.expectConverged(alice, bob);
  expectCarried(bob, ['SHORT-1', 'NESTED', 'SHORT-3', 'LONG', 'STAIR']);
  expect(alice.room.session.redo()).toBe(true);
  harness.expectConverged(alice, bob);
  expectCarried(bob, edited);

  const cold = await harness.remount(bob);
  harness.expectConverged(alice, cold);
  expectCarried(cold, edited);
});
