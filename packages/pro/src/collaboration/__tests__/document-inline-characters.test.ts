/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A deletion across a zero-width symbol or hyphen removes it on every replica (issue #1071).
import { afterEach, expect, test } from 'bun:test';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('inline-characters', { offlineEditing: true });
afterEach(() => harness.cleanup());

const bytes = zipDocument(
  '<w:p><w:r><w:t xml:space="preserve">the then</w:t><w:noBreakHyphen/>' +
    '<w:t>applicable rate</w:t><w:softHyphen/><w:t>s</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>second</w:t></w:r></w:p>'
);

function body(peer: Peer): string {
  return serializeOoxmlPart(peer.store.bodyStore().part).match(/<w:body>.*<\/w:body>/s)![0];
}

test('a deletion across a hyphen converges and survives undo, redo, and reconnect', async () => {
  const { alice, bob } = await harness.pair(bytes);
  const before = body(alice);
  const paragraphId = harness.paragraphIdAt(alice, 0);
  harness.apply(alice, [{ op: 'deleteText', paragraphId, start: 5, end: 18 }]);
  harness.expectConverged(alice, bob);
  expect(body(bob)).not.toContain('noBreakHyphen');
  expect(body(bob)).toContain('softHyphen');

  expect(alice.room.session.undo()).toBe(true);
  harness.expectConverged(alice, bob);
  expect(body(bob)).toBe(before);
  expect(alice.room.session.redo()).toBe(true);
  harness.expectConverged(alice, bob);
  expect(body(bob)).not.toContain('noBreakHyphen');

  const rejoined = await harness.remount(bob);
  harness.expectConverged(alice, rejoined);
});

test('a concurrent edit in another part of the paragraph keeps both changes', async () => {
  const { alice, bob, pause, resume } = await harness.pair(bytes);
  pause();
  harness.apply(alice, [
    { op: 'deleteText', paragraphId: harness.paragraphIdAt(alice, 0), start: 5, end: 18 },
  ]);
  harness.apply(bob, [
    { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 0), offset: 0, text: 'At ' },
  ]);
  resume();
  harness.expectConverged(alice, bob);
  expect(body(alice)).not.toContain('noBreakHyphen');
  expect(body(alice)).toContain('At ');
});
