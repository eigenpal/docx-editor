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
import { writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('cell-diagonal-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const paragraph = (text: string) =>
  `<w:p><w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

function checkCaret(editor: Editor, paragraphId: string, offset = 0) {
  const layout = editor.surface!.layout();
  const caret = caretAt(layout, { paragraphId, offset })!;
  expect(caret).not.toBeNull();
  const table = layout.pages[caret.pageIndex]!.fragments.find((f) => f.kind === 'table')!;
  if (table.kind !== 'table') throw new Error('Missing table');
  const cell = table.rows[0]!.cells[0]!;
  expect(caret.height).toBeGreaterThan(0);
  expect(caret.y).toBeGreaterThanOrEqual(cell.box.y);
  expect(caret.y + caret.height).toBeLessThanOrEqual(cell.box.y + cell.box.height + 0.001);
  return { x: caret.x, y: caret.y, height: caret.height, pageIndex: caret.pageIndex };
}

function diagonals(editor: Editor) {
  const result = editor.surface!.layout().pages.flatMap((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'table'
        ? fragment.rows.flatMap((row) =>
            row.cells.flatMap((cell) =>
              (cell.borders?.diagonals ?? []).map((line) => {
                expect(line.clipWidth).toBe(cell.box.width);
                expect(line.clipHeight).toBe(cell.box.height);
                expect(line.x2).toBe(cell.box.width);
                expect(Math.abs(line.y2 - line.y1)).toBeCloseTo(cell.box.height, 9);
                return { box: cell.box, line };
              })
            )
          )
        : []
    )
  );
  expect(result).toHaveLength(2);
  expect(result.map((item) => item.line.direction)).toEqual(['tl2br', 'tr2bl']);
  return result;
}

test('cell diagonals converge after cell edits, history, concurrent deletion, reconnect, and cold reopen', async () => {
  const peers = await harness.pair(
    zipDocument(
      '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="1200"/></w:tblGrid>' +
        '<w:tr><w:tc><w:tcPr><w:vAlign w:val="center"/><w:hideMark/><w:tcBorders><w:tl2br w:val="single" w:sz="4"/></w:tcBorders></w:tcPr>' +
        paragraph('Example') +
        '</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcBorders><w:tr2bl w:val="single" w:sz="4"/></w:tcBorders></w:tcPr>' +
        paragraph('Next row') +
        '</w:tc></w:tr></w:tbl><w:sectPr/>'
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
    expect(diagonals(bob)).toEqual(diagonals(alice));
  }
  converged();
  function select(editor: Editor, paragraphId: string, offset: number) {
    editor.surface!.setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
  }
  select(alice, alice.surface!.session.paragraphIds()[0]!, 7);
  for (let index = 0; index < 3; index += 1) {
    alice.surface!.splitParagraph();
    converged();
    const head = alice.surface!.state().selection.head;
    expect(checkCaret(bob, bob.surface!.session.paragraphIds()[index + 1]!)).toEqual(
      checkCaret(alice, head.paragraphId)
    );
  }
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
  const cold = createDocxEditor({
    container: document.createElement('div'),
    document: writeOoxmlPackage(alice.surface!.session.currentPackage()),
  });
  editors.push(cold);
  expect(diagonals(cold)).toEqual(diagonals(alice));
});
