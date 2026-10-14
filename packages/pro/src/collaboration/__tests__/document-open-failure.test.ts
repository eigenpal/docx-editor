/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A refused open is local to the editor that tried it. The other participant keeps editing, the
// room is unchanged, and the refused editor rejoins by opening the room again. Both then
// converge through concurrent edits, deletion, undo, and save and reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { strToU8 } from 'fflate';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('open-failure-room');
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

test('a refused open stays local, and the editor rejoins and converges', async () => {
  const peers = await harness.pair(
    zipDocument(paragraph('Alpha') + paragraph('Bravo') + '<w:sectPr/>')
  );
  const open = (peer: typeof peers.alice): Editor => {
    peer.detach();
    const editor = createDocxEditor({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editor.on('error', () => {});
    editors.push(editor);
    editor.attach(document.createElement('div'));
    return editor;
  };
  const alice = open(peers.alice);
  const bob = open(peers.bob);
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
  const texts = (editor: Editor) =>
    editor.surface!.session.storyText({ kind: 'body' })!.split('\n');
  const caretAt = (editor: Editor, index: number, offset: number) => {
    const paragraphId = editor.surface!.session.paragraphIds()[index]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
  };

  expect(alice.snapshot().openFailure).toBeNull();
  expect(bob.snapshot().openFailure).toBeNull();
  converged();

  // Alice tries a broken file. Only her editor reports it; Bob and the room are untouched.
  alice.load(strToU8('not a zip'));
  expect(alice.snapshot().openFailure).toEqual({ code: 'open.zip-corrupt', reason: 'damaged' });
  expect(bob.snapshot().openFailure).toBeNull();
  expect(bob.surface).not.toBeNull();

  // Bob keeps editing while Alice has no document.
  caretAt(bob, 0, 5);
  bob.surface!.type(' one');
  sync();
  expect(texts(bob)).toContain('Alpha one');

  // Alice reopens the room. The refusal clears, and she receives Bob's edit.
  alice.destroy();
  editors.splice(editors.indexOf(alice), 1);
  const rejoined = await harness.remount(peers.alice);
  const aliceAgain = open(rejoined);
  expect(aliceAgain.snapshot().openFailure).toBeNull();
  sync();
  expect(texts(aliceAgain)).toContain('Alpha one');

  // Concurrent: Alice types in the first paragraph while Bob deletes the second.
  const left = aliceAgain;
  caretAt(left, 0, 9);
  left.surface!.type(' two');
  bob.surface!.setSelection({
    anchor: { paragraphId: bob.surface!.session.paragraphIds()[1]!, offset: 0 },
    head: { paragraphId: bob.surface!.session.paragraphIds()[1]!, offset: 5 },
  });
  bob.surface!.deleteSelection();
  sync();
  const fingerprints = () => [
    packageFingerprint(left.surface!.session.currentPackage()),
    packageFingerprint(bob.surface!.session.currentPackage()),
  ];
  expect(fingerprints()[0]).toBe(fingerprints()[1]);
  expect(texts(bob)).toEqual(['Alpha one two', '']);

  left.surface!.undo();
  sync();
  expect(texts(bob)[0]).toBe('Alpha one');
  expect(saveReopenDigest(bob.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(left.surface!.session.currentPackage())
  );
  expect(left.snapshot().openFailure).toBeNull();
  expect(bob.snapshot().openFailure).toBeNull();
});
