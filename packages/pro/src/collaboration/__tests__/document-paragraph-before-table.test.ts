/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt } from '@docx-editor.dev/core/layout';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';
import { shiftedRowsTestRecorder } from '../../../../core/src/layout/table-row-geometry-reuse.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('paragraph-before-table-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
let rowRecorder: ReturnType<typeof shiftedRowsTestRecorder> | undefined;
afterEach(() => {
  rowRecorder?.dispose();
  rowRecorder = undefined;
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const paragraph = (text: string) =>
  `<w:p><w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

function checkCaret(editor: Editor, paragraphId: string, offset = 0) {
  const layout = editor.surface!.layout();
  const caret = caretAt(layout, { paragraphId, offset })!;
  expect(caret).not.toBeNull();
  expect(caret.height).toBeGreaterThan(0);
  expect(caret.pageIndex).toBe(0);
  expect(caret.y).toBeGreaterThanOrEqual(0);
  return { x: caret.x, y: caret.y, height: caret.height, pageIndex: caret.pageIndex };
}

test.each([false, true])(
  'paragraph splits before a table converge through history, concurrent deletion, and reconnect (numbered=%s)',
  async (numbered) => {
    const peers = await harness.pair(
      zipDocument(
        (numbered
          ? paragraph('Example').replace(
              '<w:pPr>',
              '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
            )
          : paragraph('Example')) +
          '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
          Array.from(
            { length: 24 },
            (_, index) => '<w:tr><w:tc>' + paragraph(`Row ${index}`) + '</w:tc></w:tr>'
          ).join('') +
          '</w:tbl><w:sectPr><w:pgSz w:w="7000" w:h="4200"/><w:pgMar w:top="400" w:bottom="400" w:left="400" w:right="400"/></w:sectPr>',
        {
          extraXml: {
            'word/numbering.xml':
              '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
          },
        }
      )
    );
    const mounted = [peers.alice, peers.bob].map((peer) => {
      peer.detach();
      const editor = createDocxEditor({
        container: document.createElement('div'),
        document: peer.room.document,
        modules: [collaborationModule({ session: peer.room.session })],
      });
      editors.push(editor);
      return editor;
    });
    const [alice, bob] = mounted as [Editor, Editor];
    function sync() {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
    }
    function converged() {
      sync();
      const left = alice.surface!.session.currentPackage();
      const right = bob.surface!.session.currentPackage();
      expect(packageFingerprint(right)).toBe(packageFingerprint(left));
      expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
      // Peers can use different local aliases for newly created paragraph identities.
      // Compare all geometry; package fingerprints separately verify canonical content.
      const geometry = (editor: Editor) =>
        JSON.stringify(editor.surface!.layout().pages, (key, value) =>
          key === 'id' || key.endsWith('Id') ? undefined : value
        );
      expect(geometry(bob)).toBe(geometry(alice));
    }
    function select(editor: Editor, paragraphId: string, offset: number) {
      editor.surface!.setSelection({
        anchor: { paragraphId, offset },
        head: { paragraphId, offset },
      });
    }
    select(alice, alice.surface!.session.paragraphIds()[0]!, numbered ? 3 : 7);
    rowRecorder = shiftedRowsTestRecorder();
    for (let index = 0; index < 3; index += 1) {
      alice.surface!.splitParagraph();
      converged();
      const head = alice.surface!.state().selection.head;
      expect(checkCaret(bob, bob.surface!.session.paragraphIds()[index + 1]!)).toEqual(
        checkCaret(alice, head.paragraphId)
      );
    }
    expect(rowRecorder.moved).toBeGreaterThan(0);
    const empty = alice.surface!.state().selection.head;
    applyAwarenessUpdate(
      peers.bob.awareness,
      encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
      'test'
    );
    const remote = peers.bob.room.session.remoteSelections()[0]!;
    expect(remote.head.nodeId).toBe(bob.surface!.session.paragraphIds()[3]!);
    expect(checkCaret(bob, remote.head.nodeId)).toEqual(checkCaret(alice, empty.paragraphId));
    select(bob, bob.surface!.session.paragraphIds()[3]!, 0);
    peers.pause();
    alice.surface!.type('Alice');
    bob.surface!.type('Bob');
    sync();
    peers.resume();
    converged();
    expect(alice.findMatches('Alice')).toHaveLength(1);
    expect(alice.findMatches('Bob')).toHaveLength(1);
    expect(alice.exec({ type: 'undo' }).ok).toBe(true);
    converged();
    expect(alice.exec({ type: 'redo' }).ok).toBe(true);
    converged();
    const target = alice.surface!.session.paragraphIds()[3]!;
    select(alice, target, 0);
    select(bob, bob.surface!.session.paragraphIds()[3]!, 0);
    peers.pause();
    alice.surface!.deleteBackward();
    bob.surface!.type('Concurrent');
    sync();
    peers.resume();
    converged();
    expect(alice.findMatches('Concurrent')).toHaveLength(1);
    const late = await harness.join(peers.alice, 'late-peer');
    expect(saveReopenDigest(late.store.currentPackage())).toEqual(
      saveReopenDigest(alice.surface!.session.currentPackage())
    );
  }
);
