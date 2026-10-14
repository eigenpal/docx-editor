/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Session diagnostics in a shared room: each editor counts only the edits it committed. Edits
// that arrive from the other participant, concurrent ones included, are not counted, and undo,
// redo, deletion, and saves stay with the editor that made them.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import type { EditorDiagnostic } from '@docx-editor.dev/core';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('session-diagnostics-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

test('each participant counts only its own edits, through concurrent edits, undo, and deletion', async () => {
  const peers = await harness.pair(
    zipDocument(
      '<w:p><w:r><w:t>Shared</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p><w:sectPr/>'
    )
  );
  const heard: Record<'alice' | 'bob', EditorDiagnostic[]> = { alice: [], bob: [] };
  const [alice, bob] = (['alice', 'bob'] as const).map((name) => {
    const peer = peers[name];
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [
        collaborationModule({ session: peer.room.session }),
        { id: 'observer', onDiagnostic: (event) => heard[name].push(event) },
      ],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  await settle();
  const converged = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  };
  const select = (editor: Editor, index: number, offset: number) => {
    const paragraphId = editor.surface!.session.paragraphIds()[index]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
  };

  select(alice, 0, 6);
  select(bob, 1, 6);
  peers.pause();
  alice.surface!.type(' Alice');
  bob.surface!.type(' Bob');
  peers.resume();
  converged();
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  // One participant deletes while the other types in the same paragraph.
  select(alice, 1, 3);
  select(bob, 1, 0);
  peers.pause();
  alice.surface!.deleteBackward();
  bob.surface!.type('Concurrent ');
  peers.resume();
  converged();
  await alice.save();
  await bob.save();

  for (const editor of editors.splice(0)) editor.destroy();
  const end = (name: 'alice' | 'bob') =>
    heard[name].find((event) => event.kind === 'session' && event.phase === 'end');
  expect(end('alice')).toMatchObject({ inputEdits: 2, commandEdits: 2, automationEdits: 0 });
  expect(end('bob')).toMatchObject({ inputEdits: 2, commandEdits: 0, automationEdits: 0 });
  for (const name of ['alice', 'bob'] as const) {
    expect(heard[name].filter((event) => event.kind === 'session')[0]).toMatchObject({
      phase: 'start',
    });
    expect(heard[name].filter((event) => event.kind === 'document.save')).toEqual([
      expect.objectContaining({ outcome: 'saved' }),
    ]);
  }
});
