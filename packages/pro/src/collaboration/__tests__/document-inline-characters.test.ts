/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A deletion across a symbol or hyphen removes it on every replica (issue #1071). A symbol is
// one model character, like a hyphen.
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
  harness.apply(alice, [{ op: 'deleteText', paragraphId, start: 5, end: 19 }]);
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

test.each([8, 9, 12])(
  'a concurrent insertion at offset %i inside the deleted range converges',
  async (offset) => {
    const { alice, bob, pause, resume } = await harness.pair(bytes);
    pause();
    harness.apply(alice, [
      { op: 'deleteText', paragraphId: harness.paragraphIdAt(alice, 0), start: 5, end: 19 },
    ]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 0), offset, text: 'Z' },
    ]);
    resume();
    harness.expectConverged(alice, bob);
    expect(body(alice)).not.toContain('noBreakHyphen');
    expect(body(alice)).toContain('Z');
  }
);

test('a concurrent edit in another part of the paragraph keeps both changes', async () => {
  const { alice, bob, pause, resume } = await harness.pair(bytes);
  pause();
  harness.apply(alice, [
    { op: 'deleteText', paragraphId: harness.paragraphIdAt(alice, 0), start: 5, end: 19 },
  ]);
  harness.apply(bob, [
    { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 0), offset: 0, text: 'At ' },
  ]);
  resume();
  harness.expectConverged(alice, bob);
  expect(body(alice)).not.toContain('noBreakHyphen');
  expect(body(alice)).toContain('At ');
});

test('inserting hyphen characters converges and survives undo, redo, and reconnect', async () => {
  const { alice, bob, pause, resume } = await harness.pair(bytes);
  const before = body(alice);
  pause();
  harness.apply(alice, [
    {
      op: 'insertText',
      paragraphId: harness.paragraphIdAt(alice, 0),
      offset: 0,
      text: 'co\u001esigned re\u001fsign ',
    },
  ]);
  harness.apply(bob, [
    { op: 'deleteText', paragraphId: harness.paragraphIdAt(bob, 0), start: 0, end: 4 },
  ]);
  resume();
  harness.expectConverged(alice, bob);
  expect(body(bob).match(/<w:noBreakHyphen\/>/g)).toHaveLength(2);
  expect(body(bob).match(/<w:softHyphen\/>/g)).toHaveLength(2);

  expect(alice.room.session.undo()).toBe(true);
  harness.expectConverged(alice, bob);
  expect(body(bob).match(/<w:noBreakHyphen\/>/g)).toHaveLength(1);
  expect(alice.room.session.redo()).toBe(true);
  harness.expectConverged(alice, bob);
  expect(body(bob)).not.toBe(before);

  const rejoined = await harness.remount(bob);
  harness.expectConverged(alice, rejoined);
});

const symbolBytes = zipDocument(
  '<w:p><w:r><w:t>ab</w:t><w:sym w:font="Wingdings" w:char="F0FC"/><w:t>cd</w:t></w:r></w:p>'
);

test('typing on both sides of a symbol at once converges with the symbol kept', async () => {
  const { alice, bob, pause, resume } = await harness.pair(symbolBytes);
  pause();
  harness.apply(alice, [
    { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 2, text: 'X' },
  ]);
  harness.apply(bob, [
    { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 0), offset: 3, text: 'Y' },
  ]);
  resume();
  harness.expectConverged(alice, bob);
  expect(body(bob).match(/<w:sym /g)).toHaveLength(1);
  expect(body(bob)).toMatch(/X.*<w:sym [^>]*\/>.*Y/s);
});

test('a deletion across a symbol converges and undo restores it', async () => {
  const { alice, bob, pause, resume } = await harness.pair(symbolBytes);
  const before = body(alice);
  pause();
  harness.apply(alice, [
    { op: 'deleteText', paragraphId: harness.paragraphIdAt(alice, 0), start: 1, end: 4 },
  ]);
  harness.apply(bob, [
    { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 0), offset: 5, text: '!' },
  ]);
  resume();
  harness.expectConverged(alice, bob);
  expect(body(bob)).not.toContain('w:sym');
  expect(body(bob)).toContain('!');
  expect(alice.room.session.undo()).toBe(true);
  harness.expectConverged(alice, bob);
  expect(body(bob)).toContain('w:sym');
  expect(body(bob)).not.toBe(before);
  const rejoined = await harness.remount(bob);
  harness.expectConverged(alice, rejoined);
});
