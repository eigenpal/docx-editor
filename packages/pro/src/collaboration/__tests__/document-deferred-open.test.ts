/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A large document opens in two tasks: one opens the bytes, the next mounts them. Both
// collaborating editors must still converge, undo, and survive save and reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('deferred-open-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

/** About `length` characters of ordinary text: past the open-yield threshold, not a zip bomb. */
function filler(length: number): string {
  const lines: string[] = [];
  for (let line = 1, total = 0; total < length; line += 1) {
    const text = `<l>filler line ${line} carrying a little ordinary sentence text.</l>`;
    lines.push(text);
    total += text.length;
  }
  return `<filler>${lines.join('')}</filler>`;
}

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

async function until(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('editors opened in two tasks converge through edits, concurrent deletion, undo, and reopen', async () => {
  const peers = await harness.pair(
    zipDocument(paragraph('Alpha') + paragraph('Bravo') + '<w:sectPr/>', {
      overrides: '<Override PartName="/customXml/item1.xml" ContentType="application/xml"/>',
      extraXml: { 'customXml/item1.xml': filler(700 * 1024) },
    })
  );
  const mounted: Editor[] = [];
  for (const peer of [peers.alice, peers.bob]) {
    peer.detach();
    const editor = createDocxEditor({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    editor.attach(document.createElement('div'));
    // The deferred path, not the synchronous one.
    expect(editor.snapshot().isOpening).toBe(true);
    expect(editor.surface).toBeNull();
    await until(() => editor.surface !== null);
    mounted.push(editor);
  }
  const [alice, bob] = mounted as [Editor, Editor];
  const sync = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const converged = () => {
    sync();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  };
  const texts = (editor: Editor) =>
    editor.surface!.session.storyText({ kind: 'body' })!.split('\n');
  const caretAt = (editor: Editor, index: number, offset: number) => {
    const paragraphId = editor.surface!.session.paragraphIds()[index]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
  };

  converged();
  caretAt(alice, 0, 5);
  alice.surface!.type(' one');
  converged();
  expect(texts(bob)).toContain('Alpha one');

  // Concurrent: Alice types in the first paragraph while Bob deletes the second.
  caretAt(alice, 0, 9);
  alice.surface!.type(' two');
  bob.surface!.setSelection({
    anchor: { paragraphId: bob.surface!.session.paragraphIds()[1]!, offset: 0 },
    head: { paragraphId: bob.surface!.session.paragraphIds()[1]!, offset: 5 },
  });
  bob.surface!.deleteSelection();
  converged();
  expect(texts(alice)).toEqual(['Alpha one two', '']);

  alice.surface!.undo();
  converged();
  expect(texts(bob)[0]).toBe('Alpha one');
});
