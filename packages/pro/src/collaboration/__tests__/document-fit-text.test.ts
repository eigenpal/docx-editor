/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A `w:fitText` group keeps its stated width when text is typed into it, on two replicas
// editing at once, after undo and redo, and after a cold reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { reviewModule } from '../../review/review-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('fit-text-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const run = (text: string, props = '') =>
  `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const FIT = '<w:fitText w:val="2880" w:id="1"/>';

/** Each paragraph's painted text, and the width its fitted group (offsets 1..end-1) takes. */
function view(editor: Editor): { texts: string[]; fitWidth: number | null } {
  const texts: string[] = [];
  let fitWidth: number | null = null;
  for (const page of editor.surface!.layout().pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      const spans = fragment.lines.flatMap((line) => line.spans);
      const text = spans.map((span) => span.text).join('');
      texts.push(text);
      if (!text.startsWith('[')) continue;
      const open = spans.find((span) => span.text === '[');
      const close = spans.find((span) => span.text.startsWith(']'));
      if (open && close) fitWidth = close.box.x - (open.box.x + open.box.width);
    }
  }
  return { texts, fitWidth };
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
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
      author: peer === peers.alice ? 'Alice' : 'Bob',
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

test('typing into a fitted group keeps its width on both replicas', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors(
    `<w:p>${run('[')}${run('ABCDE', FIT)}${run(']')}</w:p><w:p>${run('other')}</w:p>`
  );
  expect(converged().fitWidth).toBeCloseTo(144, 3);

  // Concurrent: Alice types inside the group while Bob deletes one of its characters.
  pause();
  caret(alice, 0, 3);
  alice.surface!.type('xy');
  caret(bob, 0, 5);
  bob.surface!.deleteBackward();
  resume();
  const edited = converged();
  expect(edited.texts[0]).toBe('[ABxyCE]');
  expect(edited.fitWidth).toBeCloseTo(144, 3);

  alice.surface!.undo();
  expect(converged().texts[0]).toBe('[ABCE]');
  alice.surface!.redo();
  const redone = converged();
  expect(redone.texts[0]).toBe('[ABxyCE]');
  expect(redone.fitWidth).toBeCloseTo(144, 3);
});

test('text typed right after a fitted group stays out of it on both replicas', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors(
    `<w:p>${run('[')}${run('ABCDE', FIT)}${run(']')}</w:p><w:p>${run('other')}</w:p>`
  );
  // Concurrent: Alice types after the group's last character while Bob types inside it.
  pause();
  caret(alice, 0, 6);
  alice.surface!.type('Z');
  caret(bob, 0, 2);
  bob.surface!.type('q');
  resume();
  const edited = converged();
  expect(edited.texts[0]).toBe('[AqBCDEZ]');
  // The group holds A to E only: Z after it keeps its own width, so "]" moves past 144 pt.
  expect(edited.fitWidth).toBeGreaterThan(144);
  alice.surface!.undo();
  expect(converged().fitWidth).toBeCloseTo(144, 3);
});

test('a suggestion typed right after a fitted group stays out of it on both replicas', async () => {
  const { alice, converged } = await pairedEditors(
    `<w:p>${run('[')}${run('ABCDE', FIT)}${run(']')}</w:p><w:p>${run('other')}</w:p>`
  );
  expect(alice.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
  caret(alice, 0, 6);
  alice.surface!.type('Z');
  const edited = converged();
  expect(edited.texts[0]).toBe('[ABCDEZ]');
  expect(edited.fitWidth).toBeGreaterThan(144);
  alice.surface!.undo();
  expect(converged().fitWidth).toBeCloseTo(144, 3);
});
