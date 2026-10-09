/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Changing who a tracked change belongs to replicates like any other review write: the peer
// shows the new author on the same pending decisions, through undo, reconnect, and reopen.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support';
import { packageFingerprint, saveReopenDigest } from './document-support';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('revision-author', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

const AI = 'w:author="AI" w:date="2026-01-01T00:00:00Z"';
const BODY =
  `<w:p><w:r><w:t xml:space="preserve">Pay within </w:t></w:r>` +
  `<w:del w:id="1" ${AI}><w:r><w:delText>7</w:delText></w:r></w:del>` +
  `<w:ins w:id="2" ${AI}><w:r><w:t>30</w:t></w:r></w:ins>` +
  `<w:r><w:t xml:space="preserve"> days.</w:t></w:r></w:p>` +
  `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:trPr><w:ins w:id="3" ${AI}/></w:trPr>` +
  `<w:tc><w:p><w:r><w:t>Row</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;

function mount(document: Uint8Array, peer?: Peer) {
  peer?.detach();
  const container = window.document.createElement('div');
  window.document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({
    container,
    document,
    author: 'Reviewer',
    modules: [
      reviewModule(),
      ...(peer ? [collaborationModule({ session: peer.room.session })] : []),
    ],
  });
  editors.push(editor);
  return editor;
}

const authors = (editor: Editor) =>
  editor
    .surface!.session.reviewItems()
    .flatMap((item) => (item.kind === 'revision' ? [item.author] : []));

async function peers() {
  const pair = await harness.pair(zipDocument(BODY));
  const alice = mount(pair.alice.room.document, pair.alice);
  const bob = mount(pair.bob.room.document, pair.bob);
  const converge = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.surface!.session.currentPackage())
    );
  };
  return { pair, alice, bob, converge };
}

test('an author change converges, undoes, redoes, reconnects, and reopens', async () => {
  const { pair, alice, bob, converge } = await peers();
  expect(authors(bob)).toEqual(['AI', 'AI', 'AI']);
  const result = alice.exec({
    type: 'setReviewChangesAuthor',
    author: 'Ada',
    date: '2026-10-08T09:30:00Z',
    scope: 'document',
  });
  expect(result).toMatchObject({ ok: true, changed: true });
  converge();
  expect(authors(bob)).toEqual(['Ada', 'Ada', 'Ada']);
  expect(bob.surface!.session.bodyText()).toContain('Pay within 730 days.');

  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(authors(bob)).toEqual(['AI', 'AI', 'AI']);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(authors(bob)).toEqual(['Ada', 'Ada', 'Ada']);

  // The peer can decide the reattributed change.
  const insertion = bob
    .getReviewItems()
    .find((item) => item.kind === 'revision' && item.revisionKind === 'insert')!;
  expect(bob.acceptReviewItem(insertion.key).ok).toBe(true);
  converge();
  expect(authors(alice)).toEqual(['Ada', 'Ada']);

  const rejoined = await harness.join(pair.alice, 'returning');
  const returning = mount(rejoined.room.document, rejoined);
  expect(authors(returning)).toEqual(['Ada', 'Ada']);
  const reopened = mount(new Uint8Array(await bob.save()));
  expect(saveReopenDigest(reopened.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(bob.surface!.session.currentPackage())
  );
  expect(authors(reopened)).toEqual(['Ada', 'Ada']);
});

test('an author change racing a decision and typing on the same change converges', async () => {
  const { pair, alice, bob, converge } = await peers();
  const insertion = () =>
    bob
      .getReviewItems()
      .find((item) => item.kind === 'revision' && item.revisionKind === 'insert')!;
  pair.pause();
  expect(alice.exec({ type: 'setReviewChangesAuthor', author: 'Ada', scope: 'document' }).ok).toBe(
    true
  );
  expect(bob.rejectReviewItem(insertion().key).ok).toBe(true);
  const paragraphId = bob.surface!.session.paragraphIds()[0]!;
  bob.surface!.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 0 },
  });
  bob.surface!.type('Please ');
  pair.alice.room.session.flushPendingJournals();
  pair.bob.room.session.flushPendingJournals();
  pair.resume();
  converge();
  expect(alice.surface!.session.bodyText()).toContain('Please Pay within 7 days.');
  expect(authors(alice)).toEqual(authors(bob));
  expect(authors(alice)).not.toContain('AI');
});

test('a browser runtime author change replicates to the peer', async () => {
  const { alice, bob, converge } = await peers();
  const runtime = DocxEditor.createBrowser(alice, { author: 'Reviewer' });
  await runtime.run(async (context) => {
    const revisions = context.document.revisions;
    revisions.load('items');
    await context.sync();
    // A complete tracked row is published as an insertion, so it is selected too.
    const selected = revisions.items.slice(1);
    const result = revisions.setAuthor('Ada', selected);
    await context.sync();
    expect(result.value.updated).toHaveLength(2);
  });
  converge();
  expect(authors(bob)).toEqual(['AI', 'Ada', 'Ada']);
});

test('a browser runtime without the review module refuses an author change', async () => {
  const container = window.document.createElement('div');
  window.document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({ container, document: zipDocument(BODY) });
  editors.push(editor);
  const runtime = DocxEditor.createBrowser(editor, { author: 'Reviewer' });
  const refused = runtime.run(async (context) => {
    context.document.revisions.setAuthor('Ada');
    await context.sync();
  });
  await expect(refused).rejects.toMatchObject({ code: 'NotSupported' });
  // Without the module the editor lists no review items, so read the saved markup.
  const saved = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  expect(saved.match(/w:author="AI"/g)).toHaveLength(3);
});
