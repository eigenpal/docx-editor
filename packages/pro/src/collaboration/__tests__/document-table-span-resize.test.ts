/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { paragraphTextOf } from '../../../../core/src/store/store/tree-ops.ts';
import { caretAt } from '@docx-editor.dev/core/layout';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';
import { tableColumnDividerResizeTargetFrom } from '../../../../core/src/layout/table-interaction-targets.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('table-span-resize-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});
const cell = (text: string) =>
  `<w:tc>${['B', 'E'].includes(text) ? '<w:tcPr><w:tcBorders><w:left w:val="nil"/></w:tcBorders></w:tcPr>' : ''}<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

test('resizing below merged headers converges with concurrent edits, history, deletion, and reconnect', async () => {
  const peers = await harness.pair(
    zipDocument(
      '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblBorders><w:left w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>' +
        '<w:gridCol w:w="2000"/>'.repeat(3) +
        '</w:tblGrid>' +
        '<w:tr>' +
        '<w:tc><w:tcPr><w:tcBorders><w:left w:val="nil"/></w:tcBorders></w:tcPr><w:p/></w:tc>' +
        '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Heading</w:t></w:r></w:p></w:tc></w:tr>' +
        '<w:tr>' +
        cell('A') +
        cell('B') +
        cell('C') +
        '</w:tr>' +
        '<w:tr>' +
        cell('D') +
        cell('E') +
        cell('F') +
        '</w:tr></w:tbl><w:p/>',
      {
        overrides:
          '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
        documentRels:
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
        extraXml: {
          'word/settings.xml':
            '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
        },
      }
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
  const sync = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const tableOf = (editor: Editor) => {
    const table = editor
      .surface!.layout()
      .pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
    if (table?.kind !== 'table') throw Error('Missing table');
    return table;
  };
  const converge = () => {
    sync();
    const a = alice.surface!.session.currentPackage();
    const b = bob.surface!.session.currentPackage();
    expect(packageFingerprint(a)).toBe(packageFingerprint(b));
    expect(saveReopenDigest(a)).toEqual(saveReopenDigest(b));
    expect(tableOf(alice).columnEdges).toEqual(tableOf(bob).columnEdges);
    const rightRules = (editor: Editor) =>
      tableOf(editor).rows.map((row) => row.cells.map((cell) => cell.borders?.right?.widthPt));
    expect(rightRules(alice)).toEqual(rightRules(bob));
  };
  const select = (editor: Editor, text: string) => {
    const paragraphId = editor
      .surface!.session.paragraphIds()
      .find((id) => paragraphTextOf(editor.surface!.session.part(), id)?.includes(text));
    if (!paragraphId) throw Error('Missing paragraph');
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraphId, offset: 0 },
      head: { paragraphId: paragraphId, offset: 0 },
    });
    return paragraphId;
  };
  select(bob, 'B');
  const resize = () => {
    const table = tableOf(alice);
    const row = table.rows[1]!;
    const target = tableColumnDividerResizeTargetFrom(
      alice.surface!.layout().revision,
      { table, row, rowIndex: 1 },
      row.cells[0]!.gridColumnId!,
      row.cells[1]!.gridColumnId!
    );
    expect(
      alice.exec({
        type: 'commitTableColumnDividerResize',
        target,
        leftWidthTwips: 2400,
        rightWidthTwips: 1600,
      }).ok
    ).toBe(true);
  };
  peers.pause();
  resize();
  bob.surface!.type('Concurrent');
  sync();
  peers.resume();
  converge();
  expect(alice.findMatches('Concurrent')).toHaveLength(1);
  expect(tableOf(alice).columnEdges[1]).toBeCloseTo(120, 4);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(tableOf(alice).columnEdges[1]).toBeCloseTo(100, 4);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  select(alice, 'Concurrent');
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
    'test'
  );
  const remote = peers.bob.room.session.remoteSelections()[0]!;
  const remoteCaret = caretAt(bob.surface!.layout(), {
    paragraphId: remote.head.nodeId,
    offset: remote.head.offset,
  });
  const localCaret = caretAt(alice.surface!.layout(), alice.surface!.state().selection.head);
  expect(remoteCaret).toEqual(localCaret);
  peers.pause();
  select(alice, 'Concurrent');
  select(bob, 'Concurrent');
  expect(alice.exec({ type: 'deleteRow' }).ok).toBe(true);
  bob.surface!.type('Deleted');
  sync();
  peers.resume();
  converge();
  expect(bob.findMatches('Deleted')).toHaveLength(0);
  const late = await harness.join(peers.alice, 'late');
  expect(saveReopenDigest(late.store.currentPackage())).toEqual(
    saveReopenDigest(alice.surface!.session.currentPackage())
  );
});
