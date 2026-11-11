/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('paragraph-text', { offlineEditing: true });
const editors: ReturnType<typeof createDocxEditor>[] = [];
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
  return editor;
}

test('paragraph reads follow concurrent edits, remote undo/redo and save/reopen', async () => {
  const pair = await harness.pair(
    zipDocument('<w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>')
  );
  const connected = [pair.alice, pair.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  });
  const alice = connected[0]!;
  const bob = connected[1]!;
  const converge = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.surface!.session.currentPackage())
    );
    expect(alice.getParagraphs()).toEqual(bob.getParagraphs());
  };
  const before = bob.getParagraphs();
  pair.pause();
  alice.surface!.type('A');
  bob.surface!.type('B');
  pair.alice.room.session.flushPendingJournals();
  pair.bob.room.session.flushPendingJournals();
  pair.resume();
  converge();
  const after = bob.getParagraphs();
  expect(after[0]?.keptText).toContain('First');
  expect(after[0]?.keptText).toContain('A');
  expect(after[0]?.keptText).toContain('B');
  expect(after[0]).not.toBe(before[0]);
  expect(after[1]).toBe(before[1]);
  expect(bob.getParagraphText(after[0]!.blockId)).toBe(after[0]);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(bob.getParagraphs()[0]?.keptText).toBe('BFirst');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  const reopened = mount({ document: await bob.save() });
  expect(reopened.getParagraphs().map(({ keptText }) => keptText)).toEqual(
    bob.getParagraphs().map(({ keptText }) => keptText)
  );
});
