/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('empty-line-composition', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});
function mount(options: Parameters<typeof createDocxEditor>[0]) {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({ ...options, container });
  editors.push(editor);
  return { editor, container };
}
function caret(editor: Editor, offset = 0) {
  const position = { paragraphId: editor.surface!.session.paragraphIds()[0]!, offset };
  editor.surface!.setSelection({ anchor: position, head: position });
  return position;
}
function compose(peer: ReturnType<typeof mount>, text: string) {
  caret(peer.editor);
  const pages = peer.container.querySelector<HTMLElement>('.docx-pages')!;
  pages.focus();
  let line = peer.container.querySelector('.layout-line')!;
  document.getSelection()!.setBaseAndExtent(line, 0, line, 0);
  pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  line = peer.container.querySelector('.layout-line')!;
  const run = line.querySelector('.layout-run');
  const textNode = document.createTextNode(text + (run?.textContent ?? ''));
  if (run) run.replaceChildren(textNode);
  else line.insertBefore(textNode, line.firstChild);
  document.getSelection()!.setBaseAndExtent(textNode, text.length, textNode, text.length);
  pages.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
}

test('empty paragraph composition converges, retains remote carets, and survives undo and reopen', async () => {
  const bytes = zipDocument(
    '<w:p><w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>' +
      '<w:sz w:val="24"/></w:rPr></w:pPr></w:p>'
  );
  const peers = await harness.pair(bytes);
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  }) as [ReturnType<typeof mount>, ReturnType<typeof mount>];
  const converge = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    expect(packageFingerprint(alice.editor.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.editor.surface!.session.currentPackage())
    );
  };
  for (const peer of [alice, bob]) {
    const line = peer.container.querySelector<HTMLElement>('.layout-line')!;
    expect(parseFloat(line.style.fontSize)).toBeGreaterThan(0);
  }
  caret(alice.editor);
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.awareness.clientID]),
    'test-provider'
  );
  const remote = bob.container.querySelector<HTMLElement>('.docx-remote-caret');
  expect(remote).not.toBeNull();
  expect(parseFloat(remote!.style.height)).toBeGreaterThan(0);

  peers.pause();
  compose(alice, '中文');
  caret(bob.editor);
  expect(bob.editor.exec({ type: 'insertText', text: 'peer' }).ok).toBe(true);
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  converge();
  expect(alice.editor.surface!.session.bodyText()).toContain('中文');
  expect(alice.editor.surface!.session.bodyText()).toContain('peer');
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(bob.editor.surface!.session.bodyText()).toBe('peer');
  expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  const reopened = mount({ document: new Uint8Array(await bob.editor.save()) });
  expect(saveReopenDigest(reopened.editor.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(bob.editor.surface!.session.currentPackage())
  );
  peers.pause();
  const start = caret(alice.editor);
  const end = { ...start, offset: alice.editor.surface!.session.bodyText().length };
  alice.editor.surface!.setSelection({ anchor: start, head: end });
  alice.editor.surface!.deleteBackward();
  compose(bob, '新');
  expect(bob.editor.surface!.session.bodyText()).toContain('新');
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  converge();
  // A deletion removes only the text its author saw: text composed meanwhile stays.
  expect(alice.editor.surface!.session.bodyText()).toBe('新');
  expect(bob.editor.surface!.session.bodyText()).toBe('新');
  await new Promise((resolve) => setTimeout(resolve, 30));
  // The line holds the composed text, so its size is the text run's.
  for (const peer of [alice, bob]) {
    const run = peer.container.querySelector<HTMLElement>('.layout-line .layout-run');
    expect(parseFloat(run?.style.fontSize ?? '')).toBeGreaterThan(0);
  }
});
