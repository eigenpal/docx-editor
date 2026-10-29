/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A combining kana sound mark that its face spaces lays out as a span of its own and stays on
// the line of its base. That is derived layout: two peers converge through edits, history,
// and save.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('sound-mark-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});
// Every 11 pt character, the mark too, is 6 pt on the 114 pt measure: 19 cells a line.
const run = (text: string) =>
  `<w:r><w:rPr><w:sz w:val="22"/><w:lang w:eastAsia="ja-JP"/></w:rPr><w:t>${text}</w:t></w:r>`;
const A = 'あ'.repeat(18);
const BODY =
  `<w:p><w:pPr><w:jc w:val="left"/></w:pPr>${run(A + 'か')}${run('゙あいう')}</w:p>` +
  '<w:sectPr><w:pgSz w:w="3480" w:h="10000"/>' +
  '<w:pgMar w:top="600" w:bottom="600" w:left="600" w:right="600"/></w:sectPr>';
function lines(editor: Editor) {
  return editor
    .surface!.layout()
    .pages.flatMap((page) =>
      page.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph'
          ? fragment.lines.map((line) => line.spans.map((span) => span.text))
          : []
      )
    );
}
function select(editor: Editor, from: number, to = from) {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: from },
    head: { paragraphId, offset: to },
  });
}

test('a spaced sound mark converges through edits, history, and save', async () => {
  const peers = await harness.pair(zipDocument(BODY));
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
  const converged = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const a = alice.surface!.session.currentPackage(),
      b = bob.surface!.session.currentPackage();
    expect(packageFingerprint(a)).toBe(packageFingerprint(b));
    expect(saveReopenDigest(a)).toEqual(saveReopenDigest(b));
    expect(lines(alice)).toEqual(lines(bob));
  };
  const joined = (editor: Editor) => lines(editor).map((line) => line.join(''));
  converged();
  // The base and its mark take two cells, so they move to the next line together.
  expect(joined(alice)).toEqual([A, 'があいう']);
  expect(lines(alice)[1]).toContain('゙');
  const before = lines(alice);
  peers.pause();
  // Alice removes one kana from the full line while Bob appends text offline.
  select(alice, 0, 1);
  expect(alice.exec({ type: 'deleteText' }).ok).toBe(true);
  select(bob, 23);
  expect(bob.exec({ type: 'insertText', text: 'え' }).ok).toBe(true);
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  converged();
  // Seventeen kana leave two cells: the base and its mark fit on the first line.
  expect(joined(alice)).toEqual([A.slice(1) + 'が', 'あいうえ']);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  expect(bob.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(lines(alice)).toEqual(before);
  const reopened = createDocxEditor({
    container: document.createElement('div'),
    document: await alice.save(),
  });
  editors.push(reopened);
  expect(lines(reopened)).toEqual(lines(alice));
});
