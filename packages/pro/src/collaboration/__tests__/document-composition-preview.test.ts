/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A REMOTE EDIT THAT ARRIVES WHILE A SYLLABLE IS BEING COMPOSED.
//
// The composing text lives only in the painted DOM until `compositionend`, and it is kept
// visible by releasing the clip on the run it is composed into. A collaborator's edit
// repaints the pages in the middle of that composition. The composed text must still be
// committed, the remote text must be kept, and both peers must converge, undo and reopen.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('composition-preview', { offlineEditing: true });
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

type Mounted = ReturnType<typeof mount>;

function caret(editor: Editor, index: number, offset: number) {
  const position = { paragraphId: editor.surface!.session.paragraphIds()[index]!, offset };
  editor.surface!.setSelection({ anchor: position, head: position });
}

function compositionEvent(type: string, data = ''): CompositionEvent {
  const event = new CompositionEvent(type, { bubbles: true });
  Object.defineProperty(event, 'data', { value: data, configurable: true });
  return event;
}

/** The run the browser's caret is in, which is where an input method writes. */
function caretRun(): HTMLElement | null {
  const node = document.getSelection()?.focusNode ?? null;
  const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  return element?.closest<HTMLElement>('[data-start]') ?? null;
}

const clipped = (run: HTMLElement) =>
  (run.style.clipPath !== '' && run.style.clipPath !== 'none') || run.style.overflow === 'hidden';

/** Let the layout and paint a remote edit schedules run, as they would mid-composition. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/**
 * Bob's edit, as it happens in his own window.
 *
 * Both editors share one test document, so his caret would move the selection Alice's input
 * method is composing in. In two windows it cannot; put hers back the way the browser keeps it.
 */
function remoteEdit(bob: Mounted, index: number, offset: number, text: string | null): void {
  const selection = document.getSelection()!;
  const node = selection.focusNode!;
  const at = selection.focusOffset;
  caret(bob.editor, index, offset);
  if (text === null) bob.editor.surface!.splitParagraph();
  else expect(bob.editor.exec({ type: 'insertText', text }).ok).toBe(true);
  selection.setBaseAndExtent(node, at, node, at);
}

/**
 * One composing step the way a browser performs it: the composing string replaces the
 * previous one in the text node the caret is in, then `input` fires.
 */
function composeStep(peer: Mounted, head: string, step: string): HTMLElement {
  const pages = peer.container.querySelector<HTMLElement>('.docx-pages')!;
  const node = document.getSelection()!.focusNode as Text;
  pages.dispatchEvent(compositionEvent('compositionupdate', step));
  node.data = head + step;
  document.getSelection()!.setBaseAndExtent(node, node.data.length, node, node.data.length);
  pages.dispatchEvent(new InputEvent('input', { bubbles: true, data: step }));
  return node.parentElement!.closest<HTMLElement>('[data-start]')!;
}

test('a remote edit during a composition keeps the composed and the remote text', async () => {
  const bytes = zipDocument(
    '<w:p><w:r><w:t xml:space="preserve">우리나라 </w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">second</w:t></w:r></w:p>'
  );
  const peers = await harness.pair(bytes);
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  }) as [Mounted, Mounted];
  const converge = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    expect(packageFingerprint(alice.editor.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.editor.surface!.session.currentPackage())
    );
  };

  caret(alice.editor, 0, 5);
  const pages = alice.container.querySelector<HTMLElement>('.docx-pages')!;
  pages.focus();
  caret(alice.editor, 0, 5);
  const space = caretRun()!;
  expect(space.textContent).toBe(' ');
  expect(clipped(space)).toBe(true);
  pages.dispatchEvent(compositionEvent('compositionstart'));
  expect(clipped(composeStep(alice, ' ', 'ㅇ'))).toBe(false);

  // Bob edits the other paragraph, and his edit reaches Alice mid-composition.
  remoteEdit(bob, 1, 6, '!');
  converge();
  expect(alice.editor.surface!.session.bodyText()).toBe('우리나라 \nsecond!');
  await settle();
  expect(document.getSelection()!.focusNode!.isConnected).toBe(true);

  // The composition goes on in whatever run the caret is in now, and stays visible.
  const run = composeStep(alice, ' ', '아');
  expect(clipped(run)).toBe(false);
  pages.dispatchEvent(compositionEvent('compositionend', '아'));
  converge();
  expect(alice.editor.surface!.session.bodyText()).toBe('우리나라 아\nsecond!');
  expect(bob.editor.surface!.session.bodyText()).toBe('우리나라 아\nsecond!');

  // The composition is one undo step, and only Alice's own.
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(bob.editor.surface!.session.bodyText()).toBe('우리나라 \nsecond!');
  expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  const reopened = mount({ document: new Uint8Array(await bob.editor.save()) });
  expect(reopened.editor.surface!.session.bodyText()).toBe('우리나라 아\nsecond!');
  expect(saveReopenDigest(reopened.editor.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(bob.editor.surface!.session.currentPackage())
  );
});

test('a remote edit in the composing paragraph keeps both texts', async () => {
  const bytes = zipDocument('<w:p><w:r><w:t xml:space="preserve">우리나라 </w:t></w:r></w:p>');
  const peers = await harness.pair(bytes);
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  }) as [Mounted, Mounted];
  const converge = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    expect(packageFingerprint(alice.editor.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.editor.surface!.session.currentPackage())
    );
  };
  const pages = alice.container.querySelector<HTMLElement>('.docx-pages')!;
  pages.focus();
  caret(alice.editor, 0, 5);
  pages.dispatchEvent(compositionEvent('compositionstart'));
  composeStep(alice, ' ', '아');
  const composing = document.getSelection()!.focusNode as Text;
  const shown = () =>
    [...pages.querySelectorAll('[data-start]')].map((run) => run.textContent).join('');

  // Bob types at the start of the same paragraph while Alice composes at its end.
  remoteEdit(bob, 0, 0, 'A');
  converge();
  await settle();
  // The page is held for the input method: the same text node, and no remote text on it yet.
  expect(document.getSelection()!.focusNode === composing).toBe(true);
  expect(composing.isConnected).toBe(true);
  expect(shown()).toBe('우리나라 아');

  const run = composeStep(alice, ' ', '알');
  expect(clipped(run)).toBe(false);
  pages.dispatchEvent(compositionEvent('compositionend', '알'));
  converge();
  expect(alice.editor.surface!.session.bodyText()).toBe('A우리나라 알');
  expect(bob.editor.surface!.session.bodyText()).toBe('A우리나라 알');
  // The held paint lands at the end, and shows both edits.
  expect(shown()).toBe('A우리나라 알');
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(bob.editor.surface!.session.bodyText()).toBe('A우리나라 ');
});

test('a remote split of the composing paragraph puts the syllable after the caret', async () => {
  const bytes = zipDocument('<w:p><w:r><w:t xml:space="preserve">우리나라 </w:t></w:r></w:p>');
  const peers = await harness.pair(bytes);
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  }) as [Mounted, Mounted];
  const flush = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const pages = alice.container.querySelector<HTMLElement>('.docx-pages')!;
  pages.focus();
  caret(alice.editor, 0, 5);
  pages.dispatchEvent(compositionEvent('compositionstart'));
  composeStep(alice, ' ', '아');
  // Bob presses Enter inside the word Alice is typing after.
  remoteEdit(bob, 0, 2, null);
  flush();
  await settle();
  pages.dispatchEvent(compositionEvent('compositionend', '아'));
  flush();
  expect(alice.editor.surface!.session.bodyText()).toBe('우리\n나라 아');
  expect(bob.editor.surface!.session.bodyText()).toBe('우리\n나라 아');
  expect(packageFingerprint(alice.editor.surface!.session.currentPackage())).toBe(
    packageFingerprint(bob.editor.surface!.session.currentPackage())
  );
});

const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const textBox = (text: string) =>
  `<w:p><w:r><w:drawing xmlns:wps="${WPS}" xmlns:wp="${WP}" xmlns:a="${A}">` +
  '<wp:anchor simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" ' +
  'allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="2000000" cy="800000"/><wp:wrapNone/><wp:docPr id="1" name="Box"/>' +
  `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/>` +
  '<a:ext cx="2000000" cy="800000"/></a:xfrm><a:prstGeom prst="rect"/></wps:spPr>' +
  `<wps:txbx><w:txbxContent><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>` +
  '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor>' +
  '</w:drawing></w:r><w:r><w:t>Host</w:t></w:r></w:p>';

test('a remote edit while composing in a text box keeps both texts once', async () => {
  const peers = await harness.pair(zipDocument(textBox('우리나라 ')));
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  }) as [Mounted, Mounted];
  const flush = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const [match] = alice.editor.findMatches('우리나라');
  expect(match?.scope?.kind).toBe('frame');
  const pages = alice.container.querySelector<HTMLElement>('.docx-pages')!;
  pages.focus();
  expect(alice.editor.surface!.setActiveScope(match!.scope!)).toBe(true);
  const at = { paragraphId: match!.blockId, offset: 5 };
  alice.editor.surface!.setSelection({ anchor: at, head: at });
  pages.dispatchEvent(compositionEvent('compositionstart'));
  expect(clipped(composeStep(alice, ' ', '하'))).toBe(false);
  // Bob types in the host paragraph while Alice composes in the box.
  remoteEdit(bob, 0, 2, '!');
  flush();
  await settle();
  composeStep(alice, ' ', '한');
  pages.dispatchEvent(compositionEvent('compositionend', '한'));
  flush();
  for (const peer of [alice, bob]) {
    expect(peer.editor.findMatches('우리나라 한').length).toBe(1);
    expect(peer.editor.findMatches('우리나라').length).toBe(1);
    expect(peer.editor.findMatches('!').length).toBe(1);
  }
  expect(packageFingerprint(alice.editor.surface!.session.currentPackage())).toBe(
    packageFingerprint(bob.editor.surface!.session.currentPackage())
  );
});
