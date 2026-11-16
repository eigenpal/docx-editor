/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { paragraphTextOf } from '../../../../core/src/store/store/tree-ops.ts';
import { tableColumnDividerResizeTargetFrom } from '../../../../core/src/layout/table-interaction-targets.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('table-skipped-columns-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const cell = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const skippedRow = (...texts: string[]) =>
  '<w:tr><w:trPr><w:gridBefore w:val="1"/><w:wBefore w:w="1500" w:type="dxa"/></w:trPr>' +
  texts.map(cell).join('') +
  '</w:tr>';

async function pair(tblPr: string, grid: readonly number[], rows: string) {
  const peers = await harness.pair(
    zipDocument(
      `<w:tbl><w:tblPr>${tblPr}</w:tblPr><w:tblGrid>` +
        grid.map((width) => `<w:gridCol w:w="${width}"/>`).join('') +
        `</w:tblGrid>${rows}</w:tbl><w:p/>`
    )
  );
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  const tableOf = (editor: Editor) => {
    const table = editor
      .surface!.layout()
      .pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
    if (table?.kind !== 'table') throw Error('Missing table');
    return table;
  };
  const converge = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const a = alice.surface!.session.currentPackage();
    const b = bob.surface!.session.currentPackage();
    expect(packageFingerprint(a)).toBe(packageFingerprint(b));
    expect(saveReopenDigest(a)).toEqual(saveReopenDigest(b));
    expect(tableOf(alice).columnEdges).toEqual(tableOf(bob).columnEdges);
  };
  const select = (editor: Editor, text: string) => {
    const paragraphId = editor
      .surface!.session.paragraphIds()
      .find((id) => paragraphTextOf(editor.surface!.session.part(), id)?.startsWith(text));
    if (!paragraphId) throw Error(`Missing paragraph ${text}`);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 1 },
      head: { paragraphId, offset: 1 },
    });
  };
  return { peers, alice, bob, tableOf, converge, select };
}

test('a table past skipped leading columns converges with concurrent edits and deletion', async () => {
  const { peers, alice, bob, tableOf, converge, select } = await pair(
    '<w:tblW w:w="0" w:type="auto"/>',
    [1500, 2000, 2000, 2000],
    skippedRow('A', 'B', 'C') + skippedRow('D', 'E', 'F')
  );
  // The skipped grid column takes no width: three columns lay out after its 75pt.
  const edges = tableOf(alice).columnEdges;
  expect(edges).toHaveLength(4);
  expect(edges[3]! - edges[0]!).toBeCloseTo(300, 4);
  // Column commands refuse the row shape instead of addressing a shifted column.
  select(alice, 'B');
  expect(alice.exec({ type: 'deleteColumn' })).toMatchObject({ ok: false, code: 'unsupported' });
  peers.pause();
  select(alice, 'B');
  select(bob, 'E');
  alice.surface!.type('Alice');
  bob.surface!.type('Bob');
  peers.resume();
  converge();
  expect(bob.findMatches('Alice')).toHaveLength(1);
  expect(alice.findMatches('Bob')).toHaveLength(1);
  expect(tableOf(bob).columnEdges).toEqual(edges);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(bob.findMatches('Alice')).toHaveLength(0);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  peers.pause();
  select(alice, 'E');
  select(bob, 'E');
  expect(alice.exec({ type: 'deleteRow' }).ok).toBe(true);
  bob.surface!.type('Deleted');
  peers.resume();
  converge();
  expect(bob.findMatches('Deleted')).toHaveLength(0);
  expect(tableOf(bob).columnEdges).toEqual(edges);
  const late = await harness.join(peers.alice, 'late');
  expect(saveReopenDigest(late.store.currentPackage())).toEqual(
    saveReopenDigest(alice.surface!.session.currentPackage())
  );
});

test('a divider drag in a table its stated width stretches converges at the dragged edge', async () => {
  const { peers, alice, bob, tableOf, converge, select } = await pair(
    '<w:tblW w:w="8000" w:type="dxa"/><w:tblLayout w:type="fixed"/>',
    [2000, 2000],
    `<w:tr>${cell('A')}${cell('B')}</w:tr><w:tr>${cell('C')}${cell('D')}</w:tr>`
  );
  // The 4000-twip grid stretches to the 400pt stated width.
  expect(tableOf(alice).columnEdges.at(-1)! - tableOf(alice).columnEdges[0]!).toBeCloseTo(400, 4);
  select(bob, 'D');
  peers.pause();
  const table = tableOf(alice);
  const row = table.rows[0]!;
  const target = tableColumnDividerResizeTargetFrom(
    alice.surface!.layout().revision,
    { table, row, rowIndex: 0 },
    row.cells[0]!.gridColumnId!,
    row.cells[1]!.gridColumnId!
  );
  expect(
    alice.exec({
      type: 'commitTableColumnDividerResize',
      target,
      leftWidthTwips: 2500,
      rightWidthTwips: 1500,
    }).ok
  ).toBe(true);
  bob.surface!.type('Concurrent');
  peers.resume();
  converge();
  const edges = tableOf(bob).columnEdges;
  expect((edges[1]! - edges[0]!) / (edges[2]! - edges[0]!)).toBeCloseTo(2500 / 4000, 4);
  expect(bob.findMatches('Concurrent')).toHaveLength(1);
  expect(bob.exec({ type: 'undo' }).ok).toBe(true);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  const restored = tableOf(alice).columnEdges;
  expect(restored[1]! - restored[0]!).toBeCloseTo(200, 4);
});
