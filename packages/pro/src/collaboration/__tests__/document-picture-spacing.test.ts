/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt } from '@docx-editor.dev/core/layout';
import { documentWithPicture } from '../../../../core/src/editor/__tests__/leading-picture-spacing-fixture.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

test('paragraph picture spacing converges through edits, history, deletion, and reconnect', async () => {
  const harness = createPeerHarness('picture-spacing', { offlineEditing: true });
  const peers = await harness.pair(documentWithPicture('paragraph', 240));
  const editors = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  });
  const [alice, bob] = editors;
  const sync = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const surface = (editor: (typeof editors)[number]) => editor.surface!;
  const geometry = (editor: (typeof editors)[number]) =>
    JSON.parse(
      JSON.stringify(
        surface(editor)
          .layout()
          .pages.map((p) => p.fragments),
        (key, value) => (key === 'id' || key.endsWith('Id') ? undefined : value)
      )
    );
  const converge = async () => {
    sync();
    expect(packageFingerprint(surface(alice!).session.currentPackage())).toBe(
      packageFingerprint(surface(bob!).session.currentPackage())
    );
    expect(saveReopenDigest(surface(alice!).session.currentPackage())).toEqual(
      saveReopenDigest(surface(bob!).session.currentPackage())
    );
    expect(geometry(alice!)).toEqual(geometry(bob!));
    for (const page of surface(alice!).layout().pages) {
      for (const drawing of page.anchoredDrawings ?? []) {
        for (const fragment of page.fragments) {
          if (fragment.kind !== 'paragraph') continue;
          for (const line of fragment.lines) {
            if (
              line.box.y >= drawing.y + drawing.height ||
              line.box.y + line.box.height <= drawing.y
            )
              continue;
            for (const span of line.spans) {
              expect(
                span.box.x >= drawing.x + drawing.width || span.box.x + span.box.width <= drawing.x
              ).toBe(true);
            }
          }
        }
      }
    }
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: new Uint8Array(await alice!.save()),
    });
    try {
      expect(geometry(reopened)).toEqual(geometry(alice!));
    } finally {
      reopened.destroy();
    }
  };
  try {
    await converge();
    const paragraphId = surface(alice!).session.paragraphIds()[1]!;
    const select = (editor: (typeof editors)[number], offset: number, end = offset) =>
      surface(editor).setSelection({
        anchor: { paragraphId, offset },
        head: { paragraphId, offset: end },
      });
    select(alice!, 6);
    expect(alice!.exec({ type: 'insertText', text: ' added' }).ok).toBe(true);
    await converge();
    applyAwarenessUpdate(
      peers.bob.awareness,
      encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
      'test'
    );
    const remote = peers.bob.room.session.remoteSelections()[0]!;
    expect(
      caretAt(surface(bob!).layout(), {
        paragraphId: remote.head.nodeId,
        offset: remote.head.offset,
      })
    ).toEqual(caretAt(surface(alice!).layout(), surface(alice!).state().selection.head));
    expect(alice!.exec({ type: 'undo' }).ok).toBe(true);
    await converge();
    expect(alice!.exec({ type: 'redo' }).ok).toBe(true);
    await converge();
    peers.pause();
    select(alice!, 0, 1);
    select(bob!, 8);
    surface(alice!).deleteBackward();
    surface(bob!).type(' concurrent');
    sync();
    peers.resume();
    await converge();
    expect(bob!.findMatches('concurrent')).toHaveLength(1);
    expect(
      surface(bob!)
        .layout()
        .pages.flatMap((p) => p.anchoredDrawings ?? [])
    ).toHaveLength(0);
  } finally {
    editors.forEach((editor) => editor.destroy());
    harness.cleanup();
  }
});
