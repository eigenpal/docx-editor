/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import {
  addPackageComment,
  deletePackageComments,
  writeOoxmlPackage,
} from '@docx-editor.dev/core/store';
import { createPeerHarness, zipDocument, W, R, REL } from './document-peer-support.ts';

const peers = createPeerHarness('comment-export');
afterEach(() => peers.cleanup());
const bytes = zipDocument(
  '<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>Alpha</w:t></w:r>' +
    '<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>' +
    '<w:p><w:r><w:t>Bravo</w:t></w:r></w:p>',
  {
    overrides:
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
    documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rId5" Type="${R}/comments" Target="comments.xml"/></Relationships>`,
    extraXml: {
      'word/comments.xml': `<w:comments xmlns:w="${W}"><w:comment w:id="1" w:author="Reviewer"><w:p><w:r><w:t>Original comment</w:t></w:r></w:p></w:comment></w:comments>`,
    },
  }
);

test('export cleanup preserves concurrent comments, undo, redo, and reconnect', async () => {
  const { alice, bob, pause, resume } = await peers.pair(bytes);
  pause();
  expect(deletePackageComments(alice.store, [{ commentId: '1' }])).toBe(true);
  alice.port.flushPendingJournals();
  const exported = unzipSync(writeOoxmlPackage(peers.packageOf(alice)));
  expect(exported['word/comments.xml']).toBeUndefined();
  expect(peers.packageOf(alice).parts.has('/word/comments.xml')).toBe(true);

  const added = addPackageComment(bob.store, {
    anchor: { paragraphId: peers.paragraphIdAt(bob, 1), start: 0, end: 5 },
    author: 'Bob',
    text: 'Concurrent comment',
  });
  expect(added.ok).toBe(true);
  if (!added.ok) throw new Error(added.reason);
  bob.port.flushPendingJournals();
  resume();
  peers.expectConverged(alice, bob);
  const commentText = () =>
    strFromU8(unzipSync(writeOoxmlPackage(peers.packageOf(alice)))['word/comments.xml']!);
  expect(commentText()).toContain('Concurrent comment');
  expect(commentText()).not.toContain('Original comment');
  expect(alice.room.session.undo()).toBe(true);
  peers.expectConverged(alice, bob);
  expect(commentText()).toContain('Original comment');
  expect(commentText()).toContain('Concurrent comment');
  expect(alice.room.session.redo()).toBe(true);
  peers.expectConverged(alice, bob);

  pause();
  expect(deletePackageComments(alice.store, [{ commentId: added.commentId }])).toBe(true);
  alice.port.flushPendingJournals();
  peers.apply(bob, [
    { op: 'insertText', paragraphId: peers.paragraphIdAt(bob, 1), offset: 0, text: 'Updated ' },
  ]);
  resume();
  peers.expectConverged(alice, bob);
  expect(unzipSync(writeOoxmlPackage(peers.packageOf(alice)))['word/comments.xml']).toBeUndefined();
  const reconnected = await peers.remount(bob);
  peers.expectConverged(alice, reconnected);
  expect(
    unzipSync(writeOoxmlPackage(peers.packageOf(reconnected)))['word/comments.xml']
  ).toBeUndefined();
});
