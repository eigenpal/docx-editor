/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Page fields with number-format switches render the same computed value on both peers through
// concurrent edits, undo, deletion, and save/reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('page-field-switches', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const before = 'Page ';
const middle = ' of ';

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

function fixture() {
  return zipDocument(
    `<w:p>${run(before)}<w:fldSimple w:instr=" PAGE \\* ROMAN \\* MERGEFORMAT "/>` +
      `${run(middle)}<w:fldSimple w:instr=" NUMPAGES \\* ArabicDash "/></w:p>`
  );
}

function mount(options: Parameters<typeof createDocxEditor>[0]) {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({ ...options, container });
  editors.push(editor);
  return { editor, container };
}

function caret(editor: Editor, offset: number) {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  const position = { paragraphId, offset };
  editor.surface!.setSelection({ anchor: position, head: position });
}

/** The painted text of the field atoms in the first paragraph. */
function fieldTexts(editor: Editor): string[] {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  return surface
    .layout()
    .pages.flatMap((page) => page.fragments)
    .filter((fragment) => fragment.kind === 'paragraph' && fragment.paragraphId === paragraphId)
    .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
    .flatMap((line) => line.spans)
    .filter((span) => span.fieldAtom?.pageField)
    .map((span) => span.text);
}

async function pair() {
  const peers = await harness.pair(fixture());
  const mounted = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  });
  const [alice, bob] = mounted as [ReturnType<typeof mount>, ReturnType<typeof mount>];
  const converge = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.editor.surface!.session.currentPackage();
    const right = bob.editor.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  };
  return { peers, alice, bob, converge };
}

test('switched page fields keep their computed values through concurrent edits and reopen', async () => {
  const { peers, alice, bob, converge } = await pair();
  expect(fieldTexts(alice.editor)).toEqual(['I', '- 1 -']);
  expect(fieldTexts(bob.editor)).toEqual(['I', '- 1 -']);

  peers.pause();
  caret(alice.editor, 0);
  expect(alice.editor.exec({ type: 'insertText', text: 'A ' }).ok).toBe(true);
  caret(bob.editor, before.length + 1 + middle.length + 1);
  expect(bob.editor.exec({ type: 'insertText', text: ' end' }).ok).toBe(true);
  peers.resume();
  converge();
  expect(fieldTexts(alice.editor)).toEqual(['I', '- 1 -']);
  expect(fieldTexts(bob.editor)).toEqual(['I', '- 1 -']);

  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(fieldTexts(bob.editor)).toEqual(['I', '- 1 -']);

  const reopened = mount({ document: new Uint8Array(await bob.editor.save()) });
  expect(fieldTexts(reopened.editor)).toEqual(['I', '- 1 -']);
  expect(saveReopenDigest(reopened.editor.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(bob.editor.surface!.session.currentPackage())
  );
});

test('deleting a switched page field during remote typing converges', async () => {
  const { peers, alice, bob, converge } = await pair();
  peers.pause();
  caret(alice.editor, before.length + 1);
  alice.editor.surface!.deleteBackward();
  caret(bob.editor, 0);
  expect(bob.editor.exec({ type: 'insertText', text: 'A ' }).ok).toBe(true);
  peers.resume();
  converge();
  expect(fieldTexts(alice.editor)).toEqual(['- 1 -']);
  expect(fieldTexts(bob.editor)).toEqual(['- 1 -']);
});
