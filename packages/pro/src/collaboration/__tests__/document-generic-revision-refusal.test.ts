/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { commitSessionTreeOpsAtomic } from '../../../../core/src/binding/tree-session-apply.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';

const peers = createPeerHarness('generic-revision-refusal');
afterEach(() => peers.cleanup());
for (const action of ['accept', 'reject'] as const) {
  test(`${action}: malformed wrappers refuse without publishing or losing content`, async () => {
    const bytes = zipDocument(
      '<w:p><w:r><w:t>Stable</w:t></w:r></w:p>' +
        '<w:ins w:id="1" w:author="QA"><w:p><w:r><w:t>Preserved</w:t></w:r></w:p></w:ins>'
    );
    const { alice, bob, pause, resume } = await peers.pair(bytes);
    const before = serializeOoxmlPart(alice.store.bodyStore().part);
    const result = commitSessionTreeOpsAtomic(alice.store, [
      {
        scope: { kind: 'body' },
        ops: [{ op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions' }],
      },
    ]);
    expect(result.committed).toBe(false);
    expect(result.rejected).toBe(true);
    alice.port.flushPendingJournals();
    peers.expectConverged(alice, bob);
    expect(serializeOoxmlPart(bob.store.bodyStore().part)).toBe(before);
    expect(alice.room.session.undo()).toBe(false);
    expect(alice.room.session.redo()).toBe(false);
    pause();
    peers.apply(alice, [
      { op: 'insertText', paragraphId: peers.paragraphIdAt(alice, 0), offset: 0, text: 'A' },
    ]);
    peers.apply(bob, [
      { op: 'insertText', paragraphId: peers.paragraphIdAt(bob, 0), offset: 6, text: 'B' },
    ]);
    resume();
    peers.expectConverged(alice, bob);
    expect(serializeOoxmlPart(bob.store.bodyStore().part)).toContain('AStableB');
    expect(alice.room.session.undo()).toBe(true);
    peers.expectConverged(alice, bob);
    expect(alice.room.session.redo()).toBe(true);
    peers.expectConverged(alice, bob);
    pause();
    peers.apply(alice, [
      { op: 'deleteText', paragraphId: peers.paragraphIdAt(alice, 0), start: 1, end: 7 },
    ]);
    peers.apply(bob, [
      { op: 'insertText', paragraphId: peers.paragraphIdAt(bob, 0), offset: 3, text: 'Concurrent' },
    ]);
    resume();
    peers.expectConverged(alice, bob);
    expect(serializeOoxmlPart(alice.store.bodyStore().part)).toContain('Preserved');
    const afterEdits = serializeOoxmlPart(alice.store.bodyStore().part);
    const reconnected = await peers.remount(bob);
    peers.expectConverged(alice, reconnected);
    expect(serializeOoxmlPart(reconnected.store.bodyStore().part)).toBe(afterEdits);
  });
}
