/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A comment on text inside a text box, between two collaborating editors: it replicates with
// its range in the box, the other peer can reply, resolve and delete it, it survives a
// concurrent edit in the same box, undo and redo converge, and it is kept on save and reopen.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import type { TextMatch } from '@docx-editor.dev/core/contracts/editor';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('textbox-comment-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const V = 'urn:schemas-microsoft-com:vml';
const BOX =
  `<w:p><w:r><w:pict xmlns:v="${V}"><v:rect style="position:absolute;margin-left:200pt;` +
  'margin-top:0;width:144pt;height:48pt;z-index:1"><v:textbox><w:txbxContent>' +
  '<w:p><w:r><w:t>Inside the box</w:t></w:r></w:p></w:txbxContent></v:textbox></v:rect></w:pict></w:r>' +
  '<w:r><w:t>Host</w:t></w:r></w:p><w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr/>';

async function pair() {
  const peers = await harness.pair(zipDocument(BOX));
  const [alice, bob] = (['alice', 'bob'] as const).map((name) => {
    const peer = peers[name];
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      author: name,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  function converged() {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    alice.surface!.layout();
    bob.surface!.layout();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  }
  return { alice, bob, converged, pause: peers.pause, resume: peers.resume };
}

/** Open the box and select `[start, end)` of its text. */
function selectInBox(editor: Editor, start: number, end: number): string {
  const [match] = editor.findMatches('the') as readonly TextMatch[];
  if (match?.scope?.kind !== 'frame') throw new Error('no text box match');
  expect(editor.surface!.setActiveScope(match.scope)).toBe(true);
  const paragraphId = match.blockId;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
  return paragraphId;
}

function comments(editor: Editor) {
  return editor.getReviewItems().filter((placement) => placement.item.kind === 'comment');
}

function rangeText(editor: Editor): string | undefined {
  const [card] = comments(editor);
  if (card?.item.kind !== 'comment' || !card.item.range) return undefined;
  const { start, end } = card.item.range;
  const [match] = editor.findMatches('Inside') as readonly TextMatch[];
  const text = `${match?.contextBefore ?? ''}${match?.text ?? ''}${match?.contextAfter ?? ''}`;
  return start.paragraphId === end.paragraphId ? text.slice(start.offset, end.offset) : undefined;
}

test('a text box comment replicates, takes replies and resolution, and deletes with undo', async () => {
  const { alice, bob, converged } = await pair();
  selectInBox(alice, 0, 6);
  expect(alice.addComment('Check this')).toEqual({ ok: true, changed: true });
  converged();

  const [card] = comments(bob);
  expect(card?.item.kind === 'comment' && card.item.comment.author).toBe('alice');
  expect(rangeText(bob)).toBe('Inside');
  expect(card?.anchorY).not.toBeNull();
  // Opening the card on the other peer opens the box it annotates.
  expect(bob.setActiveReviewItem(card!.key).ok).toBe(true);
  expect(bob.surface!.activeScope().kind).toBe('frame');

  expect(bob.replyToReviewItem(card!.key, 'Agreed').ok).toBe(true);
  converged();
  expect(comments(alice)).toHaveLength(2);
  expect(alice.setCommentResolved(comments(alice)[0]!.key, true).ok).toBe(true);
  converged();
  expect(comments(bob).every((entry) => entry.item.kind === 'comment' && entry.item.resolved)).toBe(
    true
  );

  expect(bob.deleteReviewItem(comments(bob)[0]!.key).ok).toBe(true);
  converged();
  expect(comments(alice)).toHaveLength(0);
  expect(bob.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(rangeText(alice)).toBe('Inside');
  expect(bob.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  expect(comments(alice)).toHaveLength(0);
});

test('a text box comment and concurrent typing in the same box both survive', async () => {
  const { alice, bob, converged, pause, resume } = await pair();
  pause();
  selectInBox(alice, 0, 6);
  expect(alice.addComment('Offline note')).toEqual({ ok: true, changed: true });
  selectInBox(bob, 14, 14);
  expect(bob.exec({ type: 'insertText', text: ' now' }).ok).toBe(true);
  resume();
  converged();
  for (const editor of [alice, bob]) {
    expect(editor.findMatches('Inside the box now')).toHaveLength(1);
    expect(rangeText(editor)).toBe('Inside');
  }
});

test('deleting the commented text in a box on one peer converges with the comment', async () => {
  const { alice, bob, converged, pause, resume } = await pair();
  pause();
  selectInBox(alice, 0, 6);
  expect(alice.addComment('Racing a delete')).toEqual({ ok: true, changed: true });
  selectInBox(bob, 0, 7);
  expect(bob.exec({ type: 'deleteText' }).ok).toBe(true);
  resume();
  converged();
  expect(alice.findMatches('the box')).toHaveLength(1);
  expect(comments(alice)).toHaveLength(comments(bob).length);
});
