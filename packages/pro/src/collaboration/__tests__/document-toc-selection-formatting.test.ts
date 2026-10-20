/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two collaborating editors format a selection that covers a generated table of contents.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { detectBodyTocs, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('toc-selection-formatting-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const run = (s: string) => `<w:r><w:t>${s}</w:t></w:r>`;
const DOCUMENT =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TOC \\o "1-1" \\h</w:instrText>' +
  `<w:fldChar w:fldCharType="separate"/></w:r>${run('Entry 1')}</w:p>` +
  `<w:p>${run('Entry 2')}</w:p><w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>` +
  `<w:p>${run('Body text one')}</w:p><w:p>${run('Body text two')}</w:p>`;

const paragraphs = (editor: Editor): string[] =>
  serializeOoxmlPart(editor.surface!.session.part()).match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];

test('a highlight over a table of contents converges, undoes, and survives reopen', async () => {
  const peers = await harness.pair(zipDocument(DOCUMENT));
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  const sync = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const converged = () => {
    sync();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  };
  const before = paragraphs(alice);

  // Alice highlights everything while Bob types into the body: both converge, the generated
  // rows stay as they were, and the body carries the highlight on both peers.
  alice.surface!.selectAll();
  expect(
    alice.exec({ type: 'setMarkAttr', mark: 'highlight', attr: 'val', value: 'yellow' })
  ).toMatchObject({ ok: true });
  const bodyId = bob.surface!.session.paragraphIds()[4]!;
  bob.surface!.setSelection({
    anchor: { paragraphId: bodyId, offset: 0 },
    head: { paragraphId: bodyId, offset: 0 },
  });
  expect(bob.exec({ type: 'insertText', text: 'New ' }).ok).toBe(true);
  converged();
  for (const editor of [alice, bob]) {
    const after = paragraphs(editor);
    expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
    expect(after[3]).toContain('w:highlight');
    expect(detectBodyTocs(editor.surface!.session.part())).toHaveLength(1);
  }

  // Alice's undo removes only her highlight; Bob's text stays.
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(paragraphs(bob)[3]).not.toContain('w:highlight');
  expect(bob.surface!.session.bodyText()).toContain('New Body text two');

  // Redo and a save/reopen keep the highlight outside the table.
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  const reopened = createDocxEditor({
    container: document.createElement('div'),
    document: await alice.save(),
  });
  editors.push(reopened);
  expect(paragraphs(reopened)[3]).toContain('w:highlight');
  expect(paragraphs(reopened).slice(0, 3)).toEqual(before.slice(0, 3));
});
