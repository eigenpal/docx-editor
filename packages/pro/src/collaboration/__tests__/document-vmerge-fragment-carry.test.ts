/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument } from '../../../../core/src/layout/semantic-layout.ts';
import { caretAt } from '../../../../core/src/layout/semantic-interaction.ts';
import { tableAnchorAt } from '../../../../core/src/layout/semantic-cell-selection.ts';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('vmerge-fragment-carry', { offlineEditing: true });
afterEach(() => harness.cleanup());
const p = (text: string) =>
  '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="exact" w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>' +
  text +
  '</w:t></w:r></w:p>';
const body =
  '<w:p><w:pPr><w:spacing w:line="4400" w:lineRule="exact"/></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/><w:gridCol w:w="5000"/></w:tblGrid>' +
  Array.from(
    { length: 30 },
    (_, row) =>
      '<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="370" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:vMerge' +
      (row === 0 ? ' w:val="restart"' : '') +
      '/></w:tcPr>' +
      (row === 0
        ? Array.from({ length: 50 }, (_, index) => p(`MERGED-${index + 1}`)).join('')
        : '<w:p/>') +
      '</w:tc><w:tc>' +
      p(`ROW-${row + 1}`) +
      '</w:tc></w:tr>'
  ).join('') +
  '</w:tbl><w:p/>';
const geometry = { width: 612, height: 720, margin: { top: 40, bottom: 40, left: 40, right: 40 } };
const measurer = {
  measure: (text: string) => [...text].length * 5,
  lineMetrics: () => ({ height: 12, baseline: 10 }),
};

function paragraph(peer: Peer, label: string): OoxmlNode {
  let result: OoxmlNode | undefined;
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph' && nodeText(node).startsWith(label)) result = node;
  });
  if (!result) throw new Error('Missing synthetic merged paragraph');
  return result;
}

function check(peer: Peer, expectedText: string): void {
  const part = peer.store.bodyStore().part;
  const before = serializeOoxmlPart(part);
  const revision = peer.store.bodyStore().revision;
  const layout = layoutSemanticDocument(part, revision, { geometry, measurer });
  const blocks = layout.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'table'
        ? fragment.rows.flatMap((row) =>
            row.cells.flatMap((cell) => cell.blocks.filter((block) => block.kind === 'paragraph'))
          )
        : []
    )
  );
  const merged = blocks.filter(
    (block) =>
      block.kind === 'paragraph' &&
      block.lines.some((line) =>
        line.spans
          .map((span) => span.text)
          .join('')
          .startsWith('MERGED-')
      )
  );
  expect(new Set(merged.map((block) => block.kind === 'paragraph' && block.paragraphId)).size).toBe(
    50
  );
  const target = paragraph(peer, 'MERGED-50');
  const actual = blocks
    .filter((block) => block.kind === 'paragraph' && block.paragraphId === target.id)
    .flatMap((block) =>
      block.kind === 'paragraph'
        ? block.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    )
    .join('');
  expect(actual).toBe(expectedText);
  expect(caretAt(layout, { paragraphId: target.id, offset: 0 })!.pageIndex).toBeGreaterThan(0);
  expect(tableAnchorAt(layout, target.id)?.cellId).toBe(
    tableAnchorAt(layout, paragraph(peer, 'MERGED-1').id)?.cellId
  );
  expect(serializeOoxmlPart(part)).toBe(before);
  const reopened = readOoxmlPart(before, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!reopened.ok) throw new Error(reopened.reason);
  expect(layoutSemanticDocument(reopened.part, revision, { geometry, measurer })).toEqual(layout);
}

test('live replicas lay out carried text after concurrent edits, undo, redo, and cold join', async () => {
  const { alice, bob, pause, resume } = await harness.pair(zipDocument(body));
  check(alice, 'MERGED-50');
  check(bob, 'MERGED-50');
  pause();
  harness.apply(alice, [
    { op: 'insertText', paragraphId: paragraph(alice, 'MERGED-50').id, offset: 9, text: ' A' },
  ]);
  harness.apply(bob, [
    { op: 'insertText', paragraphId: paragraph(bob, 'MERGED-1').id, offset: 8, text: ' B' },
  ]);
  resume();
  harness.expectConverged(alice, bob);
  check(alice, 'MERGED-50 A');
  check(bob, 'MERGED-50 A');
  expect(alice.room.session.undo()).toBe(true);
  harness.expectConverged(alice, bob);
  check(bob, 'MERGED-50');
  expect(alice.room.session.redo()).toBe(true);
  harness.expectConverged(alice, bob);
  check(bob, 'MERGED-50 A');
  pause();
  harness.apply(alice, [
    { op: 'deleteText', paragraphId: paragraph(alice, 'MERGED-50').id, start: 9, end: 11 },
  ]);
  harness.apply(bob, [
    { op: 'insertText', paragraphId: paragraph(bob, 'MERGED-50').id, offset: 11, text: ' B' },
  ]);
  resume();
  harness.expectConverged(alice, bob);
  check(alice, 'MERGED-50 B');
  check(bob, 'MERGED-50 B');
  const cold = await harness.remount(bob);
  harness.expectConverged(alice, cold);
  check(cold, 'MERGED-50 B');
});
