/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('remote-caret-stale-dom-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const host of hosts.splice(0)) host.remove();
  harness.cleanup();
});

/** Report browser input as pending, so a paint waits for a later task, as it does mid-typing. */
function withPendingInput(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(window.navigator, 'scheduling');
  Object.defineProperty(window.navigator, 'scheduling', {
    configurable: true,
    value: { isInputPending: () => true },
  });
  return () => {
    if (descriptor) Object.defineProperty(window.navigator, 'scheduling', descriptor);
    else delete (window.navigator as Navigator & { scheduling?: unknown }).scheduling;
  };
}

// Text a peer inserts before the caret moves the caret in the model at once, but the browser
// keeps showing the old caret until the deferred paint. A `selectionchange` in between must
// not take that old caret back, or the next keystroke lands inside the user's own text.
test('a remote insertion before the caret survives a selection change before the paint', async () => {
  const peers = await harness.pair(
    zipDocument('<w:p><w:r><w:t>Shared</w:t></w:r></w:p><w:sectPr/>')
  );
  // Alice has no editor here: each peer owns its own window's selection in a browser, and
  // this document has one.
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  peers.bob.detach();
  const bob = createDocxEditor({
    container: host,
    document: peers.bob.room.document,
    modules: [collaborationModule({ session: peers.bob.room.session })],
  });
  editors.push(bob);
  const id = bob.findMatches('Shared')[0]!.blockId;
  const end = { paragraphId: id, offset: 6 };
  bob.surface!.layout();
  bob.surface!.setSelection({ anchor: end, head: end });
  await Promise.resolve();

  const restore = withPendingInput();
  try {
    const shared = harness.paragraphIdAt(peers.alice, 0);
    harness.apply(peers.alice, [
      { op: 'insertText', paragraphId: shared, offset: 0, text: 'Peer ' },
    ]);
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    bob.surface!.layout();
    expect(bob.surface!.state().selection.head.offset).toBe(11);
    document.dispatchEvent(new Event('selectionchange'));
    expect(bob.surface!.state().selection.head).toEqual({ paragraphId: id, offset: 11 });
  } finally {
    restore();
  }
  expect(bob.exec({ type: 'insertText', text: '!' }).ok).toBe(true);
  peers.bob.room.session.flushPendingJournals();
  bob.surface!.layout();
  expect(bob.findMatches('Peer Shared!')).toHaveLength(1);
});
