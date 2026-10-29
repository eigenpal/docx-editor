/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// LISTNUM fields renumber when a paragraph before them changes, on two replicas editing at
// once, after undo and redo, and after a cold reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('listnum-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const run = (text: string, props = '') =>
  `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const listNum = (tag: string) =>
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> LISTNUM </w:instrText></w:r>' +
  `<w:r><w:fldChar w:fldCharType="end"/></w:r>${run(` ${tag}`)}</w:p>`;

/** Each paragraph's painted text. */
function view(editor: Editor): { texts: string[] } {
  const texts: string[] = [];
  for (const page of editor.surface!.layout().pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      texts.push(fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join(''));
    }
  }
  return { texts };
}

function coldView(editor: Editor) {
  const cold = createDocxEditor({
    container: document.createElement('div'),
    document: editor.surface!.session.save(),
  });
  try {
    return view(cold);
  } finally {
    cold.destroy();
  }
}

async function pairedEditors(body: string) {
  const peers = await harness.pair(zipDocument(body));
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
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
    expect(view(bob)).toEqual(view(alice));
    for (const editor of [alice, bob]) expect(view(editor)).toEqual(coldView(editor));
    return view(alice);
  };
  return { alice, bob, converged, pause: peers.pause, resume: peers.resume };
}

const caret = (editor: Editor, index: number, offset: number) => {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
};

test('LISTNUM fields renumber when a peer removes a paragraph before them', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors(
    listNum('one') + listNum('two') + listNum('three')
  );
  expect(converged().texts).toEqual(['1) one', '2) two', '3) three']);

  // Concurrent: Bob deletes the first paragraph while Alice types in the last one.
  pause();
  const ids = bob.surface!.session.paragraphIds();
  bob.surface!.setSelection({
    anchor: { paragraphId: ids[0]!, offset: 0 },
    head: { paragraphId: ids[1]!, offset: 0 },
  });
  bob.surface!.deleteSelection();
  caret(alice, 2, 7);
  alice.surface!.type('!');
  resume();
  expect(converged().texts).toEqual(['1) two', '2) three!']);

  bob.surface!.undo();
  expect(converged().texts).toEqual(['1) one', '2) two', '3) three!']);
  bob.surface!.redo();
  expect(converged().texts).toEqual(['1) two', '2) three!']);
});
