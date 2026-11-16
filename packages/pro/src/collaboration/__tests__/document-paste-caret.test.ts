/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The caret after a rich paste, in a real collaboration room (issue #1990).
//
// The caret lands at the end of the pasted content, so the next keystroke follows it on
// every participant. A peer that types in the same paragraph meanwhile, undo, redo, and a
// save and reopen all keep the keystroke after the paste.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor as ServerDocxEditor } from '@docx-editor.dev/editor-api';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, walk } from './document-peer-support';
import { docx } from '../../../../core/src/editor/__tests__/paginated-surface-fixtures.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
type Editor = ReturnType<typeof createDocxEditor>;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function mount(document: Uint8Array, collaboration: Parameters<typeof collaborationModule>[0]) {
  const container = globalThis.document.createElement('div');
  globalThis.document.body.append(container);
  const editor = createDocxEditor({
    container,
    document,
    author: 'Writer',
    modules: [reviewModule(), collaborationModule(collaboration)],
  });
  cleanups.push(() => {
    editor.destroy();
    container.remove();
  });
  return editor;
}

async function room() {
  const harness = createPeerHarness('rich-paste-caret', { offlineEditing: true });
  cleanups.push(() => harness.cleanup());
  const pair = await harness.pair(docx('<w:p><w:r><w:t>helloworld</w:t></w:r></w:p><w:sectPr/>'));
  pair.alice.detach();
  pair.bob.detach();
  const alice = mount(pair.alice.room.document, { session: pair.alice.room.session });
  const bob = mount(pair.bob.room.document, { session: pair.bob.room.session });
  const sync = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  return { pair, alice, bob, sync };
}

const surfaceOf = (editor: Editor) => editor.surface!;
const text = (editor: Editor) => surfaceOf(editor).session.bodyText();

function caretAt(editor: Editor, offset: number): void {
  const surface = surfaceOf(editor);
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

test('the keystroke after a rich paste follows the paste on both participants', async () => {
  const r = await room();
  r.pair.pause();
  caretAt(r.alice, 5);
  surfaceOf(r.alice).pasteRich('ext', '<p><b>ext</b></p>');
  surfaceOf(r.alice).type('X');
  caretAt(r.bob, 0);
  surfaceOf(r.bob).type('Bob ');
  r.sync();
  r.pair.resume();
  r.sync();
  expect(text(r.alice)).toBe('Bob helloextXworld');
  expect(text(r.bob)).toBe(text(r.alice));

  // Undo takes the keystroke back first, then the paste; Bob's typing stays.
  expect(r.alice.exec({ type: 'undo' }).ok).toBe(true);
  r.sync();
  expect(text(r.bob)).toBe('Bob helloextworld');
  expect(r.alice.exec({ type: 'undo' }).ok).toBe(true);
  r.sync();
  expect(text(r.bob)).toBe('Bob helloworld');
  expect(r.alice.exec({ type: 'redo' }).ok).toBe(true);
  expect(r.alice.exec({ type: 'redo' }).ok).toBe(true);
  r.sync();
  expect(text(r.alice)).toBe('Bob helloextXworld');
  expect(text(r.bob)).toBe(text(r.alice));

  // Save and reopen keeps the keystroke after the paste.
  const reopened = await ServerDocxEditor.createServer(new Uint8Array(await r.bob.save()));
  try {
    const reopenedText = await reopened.run(async (context) => {
      const body = context.document.body;
      body.load('text');
      await context.sync();
      return body.text;
    });
    expect(reopenedText.replace(/\r/g, '')).toBe('Bob helloextXworld');
  } finally {
    reopened.dispose();
  }
});

test('a multi-paragraph paste ends after its last line while the peer deletes nearby', async () => {
  const r = await room();
  r.pair.pause();
  caretAt(r.alice, 5);
  surfaceOf(r.alice).pasteRich('one\ntwo', '<p>one</p><p>two</p>');
  surfaceOf(r.alice).type('X');
  const bobSurface = surfaceOf(r.bob);
  const paragraphId = bobSurface.session.paragraphIds()[0]!;
  bobSurface.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 2 },
  });
  bobSurface.type('J');
  r.sync();
  r.pair.resume();
  r.sync();
  expect(text(r.alice)).toBe('Jlloone\ntwoXworld');
  expect(text(r.bob)).toBe(text(r.alice));
});

test('the store reports a paste end the session still holds after it re-keys', async () => {
  const harness = createPeerHarness('rich-paste-end-store');
  cleanups.push(() => harness.cleanup());
  const { alice, bob } = await harness.pair(
    docx('<w:p><w:r><w:t>helloworld</w:t></w:r></w:p><w:sectPr/>')
  );
  const paragraphId = harness.paragraphIdAt(alice, 0);
  const fragment = docx('<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>');
  const pasted = alice.store.applyFragmentPaste(
    { kind: 'body' },
    { paragraphId, offset: 5, fragmentBytes: fragment, lastMarkCovered: false }
  );
  if (!pasted.ok) throw new Error(pasted.detail ?? pasted.reason);
  const end = pasted.end!;
  expect(harness.paragraphIdAt(alice, 1)).toBe(end.paragraphId);
  expect(end.offset).toBe(3);
  harness.apply(alice, [{ op: 'insertText', ...end, text: 'X' }]);
  alice.port.flushPendingJournals();
  harness.expectConverged(alice, bob);
  const texts = (ydocPeer: typeof bob) => {
    const out: string[] = [];
    walk(ydocPeer.store.bodyStore().part.root, (node) => {
      if (node.kind === 'textValue') out.push(node.value);
    });
    return out.join('');
  };
  expect(texts(bob)).toBe('helloonetwoXworld');
});

test('a paste with a table in the middle ends after its last line on both participants', async () => {
  const r = await room();
  caretAt(r.alice, 5);
  surfaceOf(r.alice).pasteRich(
    'one\na\ntwo',
    '<p>one</p><table><tr><td>a</td><td>b</td></tr></table><p>two</p>'
  );
  surfaceOf(r.alice).type('X');
  r.sync();
  expect(text(r.alice)).toBe('helloone\na\nb\ntwoXworld');
  expect(text(r.bob)).toBe(text(r.alice));
});
