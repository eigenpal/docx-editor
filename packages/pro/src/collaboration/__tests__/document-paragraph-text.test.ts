/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../../review/review-module.ts';
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
  expect(after[0]?.acceptedText).toContain('First');
  expect(after[0]?.acceptedText).toContain('A');
  expect(after[0]?.acceptedText).toContain('B');
  expect(after[0]).not.toBe(before[0]);
  expect(after[1]).toBe(before[1]);
  expect(bob.getParagraphText(after[0]!.blockId)).toBe(after[0]);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(bob.getParagraphs()[0]?.acceptedText).toBe('BFirst');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  const reopened = mount({ document: await bob.save() });
  expect(reopened.getParagraphs().map(({ acceptedText }) => acceptedText)).toEqual(
    bob.getParagraphs().map(({ acceptedText }) => acceptedText)
  );
});

test('a remote tracked replacement leaves deleted text out of accepted text', async () => {
  const pair = await harness.pair(
    zipDocument('<w:p><w:r><w:t xml:space="preserve">I recieve mail</w:t></w:r></w:p>')
  );
  const [alice, bob] = [pair.alice, pair.bob].map((peer, index) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      author: index === 0 ? 'Alice' : 'Bob',
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
  }) as [ReturnType<typeof mount>, ReturnType<typeof mount>];
  expect(alice.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
  const match = alice.findMatches('recieve')[0]!;
  expect(alice.exec({ type: 'replaceMatch', match, text: 'receive' }).ok).toBe(true);
  pair.alice.room.session.flushPendingJournals();
  pair.bob.room.session.flushPendingJournals();
  const [paragraph] = bob.getParagraphs();
  expect(paragraph?.acceptedText).toBe('I receive mail');
  expect(paragraph?.text.length).toBeGreaterThan(paragraph!.acceptedText.length);
  expect(alice.getParagraphs()).toEqual(bob.getParagraphs());
  const ranges = paragraph!.acceptedSpans.map(({ start, length }) => ({
    blockId: paragraph!.blockId,
    start,
    length,
    expectedText: paragraph!.text.slice(start, start + length),
  }));
  expect(bob.setHighlights('kept', ranges)).toEqual({ applied: ranges.length, unavailable: 0 });
  // Undo on one side restores the old text on both.
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  pair.alice.room.session.flushPendingJournals();
  pair.bob.room.session.flushPendingJournals();
  expect(bob.getParagraphs()[0]?.acceptedText).toBe('I recieve mail');
  expect(bob.getParagraphs()[0]?.acceptedSpans).toHaveLength(1);
});
