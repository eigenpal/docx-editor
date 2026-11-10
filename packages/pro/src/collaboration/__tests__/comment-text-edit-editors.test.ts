/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collectReviewItems, revisionItemsOf, findNode } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { packageFingerprint } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('comment-edit', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

function mount(document: Uint8Array, peer?: Peer) {
  const container = globalThis.document.createElement('div');
  globalThis.document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({
    document,
    container,
    author: 'Reviewer',
    modules: [
      {
        id: 'review',
        review: {
          displayModes: ['all-markup', 'proposed', 'original'],
          collectReviewItems,
          revisionItemsOfParagraph: (part, paragraphId) => {
            const paragraph = findNode(part, paragraphId);
            return paragraph?.kind === 'paragraph'
              ? revisionItemsOf({ ...part, root: paragraph })
              : [];
          },
        },
      },
      ...(peer ? [collaborationModule({ session: peer.room.session })] : []),
    ],
  });
  editors.push(editor);
  return editor;
}

async function pairOfEditors() {
  const pair = await harness.pair(zipDocument('<w:p><w:r><w:t>Alpha Bravo</w:t></w:r></w:p>'));
  pair.alice.detach();
  pair.bob.detach();
  const alice = mount(pair.alice.room.document, pair.alice);
  const bob = mount(pair.bob.room.document, pair.bob);
  const flush = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  const converge = () => {
    flush();
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.surface!.session.currentPackage())
    );
  };
  const paragraphId = alice.surface!.session.paragraphIds()[0]!;
  alice.surface!.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 5 },
  });
  expect(alice.addComment('Original').ok).toBe(true);
  converge();
  const key = alice.getReviewItems().find((entry) => entry.kind === 'comment')!.key;
  const text = (editor: Editor) => editor.getReviewItems().find((entry) => entry.key === key)?.text;
  return { ...pair, peers: pair, alice, bob, flush, converge, key, text };
}

test('comment and reply edits synchronize, preserve history, and survive save/reopen', async () => {
  const { alice, bob, key, converge, text } = await pairOfEditors();
  expect(alice.setCommentText(key, 'Edited', { expectedText: 'Original' }).ok).toBe(true);
  converge();
  expect(text(bob)).toBe('Edited');
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(text(bob)).toBe('Original');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(text(bob)).toBe('Edited');
  expect(bob.replyToReviewItem(key, 'Reply').ok).toBe(true);
  converge();
  const reply = bob
    .getReviewItems()
    .filter((entry) => entry.kind === 'comment')
    .find((entry) => entry.parentId !== undefined)!;
  expect(bob.setCommentText(reply.key, 'Edited reply').ok).toBe(true);
  expect(alice.setCommentResolved(key, true).ok).toBe(true);
  converge();
  for (const editor of [alice, bob]) {
    const cold = mount(new Uint8Array(await editor.save()));
    expect(
      cold
        .getReviewItems()
        .filter((item) => item.kind === 'comment')
        .map((item) => [item.text, item.resolved])
    ).toEqual([
      ['Edited', true],
      ['Edited reply', true],
    ]);
  }
});

test('concurrent full replacements converge without combining both drafts', async () => {
  const { alice, bob, key, pause, resume, flush, converge, text } = await pairOfEditors();
  pause();
  expect(alice.setCommentText(key, 'Alice replacement').ok).toBe(true);
  expect(bob.setCommentText(key, 'Bob replacement').ok).toBe(true);
  flush();
  resume();
  converge();
  expect(['Alice replacement', 'Bob replacement']).toContain(text(alice) ?? '');
  expect(text(alice)).toBe(text(bob));
});

test('deletion concurrent with editing does not restore a removed thread', async () => {
  const { alice, bob, key, pause, resume, flush, converge, text } = await pairOfEditors();
  pause();
  expect(alice.deleteReviewItem(key).ok).toBe(true);
  expect(bob.setCommentText(key, 'Concurrent edit').ok).toBe(true);
  flush();
  resume();
  converge();
  expect(text(alice)).toBeUndefined();
  expect(bob.setCommentText(key, 'Late edit')).toMatchObject({ ok: false, code: 'notFound' });
  for (const editor of [alice, bob]) {
    const cold = mount(new Uint8Array(await editor.save()));
    expect(cold.getReviewItems().filter((entry) => entry.kind === 'comment')).toHaveLength(0);
  }
});

test('a remote change rejects a stale draft without deleting it or adding history', async () => {
  const { alice, bob, key, converge, text } = await pairOfEditors();
  expect(alice.setCommentText(key, 'Remote edit').ok).toBe(true);
  converge();
  expect(bob.setCommentText(key, 'My draft', { expectedText: 'Original' })).toEqual({
    ok: false,
    code: 'invalidArgs',
    reason: 'comment-text-changed',
  });
  expect(text(bob)).toBe('Remote edit');
  bob.setAuthor('Someone else');
  expect(bob.setCommentText(key, 'Unauthorized')).toMatchObject({ ok: false, code: 'locked' });
  converge();
  expect(text(alice)).toBe('Remote edit');
});

test('concurrent edit and reply keep the reply attached through save and reopen', async () => {
  const { alice, bob, key, pause, resume, flush, converge } = await pairOfEditors();
  pause();
  expect(alice.setCommentText(key, 'Edited parent').ok).toBe(true);
  expect(bob.replyToReviewItem(key, 'Concurrent reply').ok).toBe(true);
  flush();
  resume();
  converge();
  for (const editor of [alice, bob]) {
    const cold = mount(new Uint8Array(await editor.save()));
    const comments = cold.getReviewItems().filter((entry) => entry.kind === 'comment');
    expect(comments.map((entry) => entry.text)).toEqual(['Edited parent', 'Concurrent reply']);
    expect(comments[1]!.parentId).toBe(comments[0]!.id);
  }
});

test('concurrent edit and resolution preserve both changes', async () => {
  const { alice, bob, key, pause, resume, flush, converge, text } = await pairOfEditors();
  pause();
  expect(alice.setCommentText(key, 'Edited resolved comment').ok).toBe(true);
  expect(bob.setCommentResolved(key, true).ok).toBe(true);
  flush();
  resume();
  converge();
  expect(text(alice)).toBe('Edited resolved comment');
  expect(
    alice
      .getReviewItems()
      .filter((entry) => entry.kind === 'comment')
      .find((entry) => entry.key === key)!.resolved
  ).toBe(true);
  expect(bob.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(text(alice)).toBe('Edited resolved comment');
  expect(
    alice
      .getReviewItems()
      .filter((entry) => entry.kind === 'comment')
      .find((entry) => entry.key === key)!.resolved
  ).toBe(false);
});

test('concurrent replacement history converges and late peers read the same surviving body', async () => {
  const { alice, bob, key, pause, resume, flush, converge, text, peers } = await pairOfEditors();
  pause();
  expect(alice.setCommentText(key, 'Alice draft').ok).toBe(true);
  expect(bob.setCommentText(key, 'Bob draft').ok).toBe(true);
  flush();
  resume();
  converge();
  const winner = text(alice);
  const winningEditor = winner === 'Alice draft' ? alice : bob;
  expect(winningEditor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(['Original', 'Alice draft', 'Bob draft']).toContain(text(alice) ?? '');
  expect(winningEditor.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(text(alice)).toBe(winner);
  const late = await harness.join(peers.alice, 'late');
  late.detach();
  const reader = mount(late.room.document, late);
  expect(text(reader)).toBe(winner);
  expect(reader.setCommentText(key, 'After reconnect').ok).toBe(true);
  late.room.session.flushPendingJournals();
  converge();
  expect(text(alice)).toBe('After reconnect');
  expect(new Set(reader.getReviewItems().map((entry) => entry.id)).size).toBe(
    reader.getReviewItems().length
  );
});

test('multiline comments and atomic multi-comment edits survive peers and save/reopen', async () => {
  const { alice, bob, key, converge, text } = await pairOfEditors();
  expect(alice.replyToReviewItem(key, 'Reply').ok).toBe(true);
  converge();
  const reply = alice
    .getReviewItems()
    .filter((entry) => entry.kind === 'comment')
    .find((entry) => entry.parentId !== undefined)!;
  const root = alice.getReviewItems().find((entry) => entry.key === key)!;
  alice.surface!.commitReviewOps(
    (historyToken) => ({
      committed: alice.surface!.session.setCommentTexts(
        [
          { commentId: root.id, text: 'First\r\nSecond\tcell' },
          { commentId: reply.id, text: 'Reply changed' },
        ],
        { historyToken }
      ),
    }),
    'comment-edit'
  );
  converge();
  expect(text(bob)).toBe('First\nSecond\tcell');
  for (const editor of [alice, bob]) {
    const cold = mount(new Uint8Array(await editor.save()));
    expect(text(cold)).toBe('First\nSecond\tcell');
    expect(
      cold
        .getReviewItems()
        .filter((entry) => entry.kind === 'comment')
        .find((entry) => entry.parentId !== undefined)!.text
    ).toBe('Reply changed');
  }
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(text(bob)).toBe('Original');
  expect(
    bob
      .getReviewItems()
      .filter((entry) => entry.kind === 'comment')
      .find((entry) => entry.parentId !== undefined)!.text
  ).toBe('Reply');
});
