/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `getSelectionRange()` with two editors in one room: a remote edit before the local caret
// moves the offset the host reads, and the snapshot tells the host it moved.
import { afterEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('selection-range-read-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

async function pair() {
  const peers = await harness.pair(
    zipDocument(
      '<w:p><w:r><w:t xml:space="preserve">Shared text</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Tail</w:t></w:r></w:p><w:sectPr/>'
    )
  );
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
  const deliver = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  return { alice, bob, deliver, pause: peers.pause, resume: peers.resume };
}

function paragraph(editor: Editor, index: number): string {
  return editor.surface!.session.paragraphIds()[index]!;
}

function caret(editor: Editor, blockId: string, offset: number): void {
  const at = { blockId, offset };
  expect(editor.exec({ type: 'setSelection', range: { anchor: at, head: at } }).ok).toBe(true);
}

describe('getSelectionRange in a collaboration session', () => {
  test('a remote insert and delete before the caret move its offset', async () => {
    const { alice, bob, deliver } = await pair();
    const shared = paragraph(bob, 0);
    expect(paragraph(alice, 0)).toBe(shared);
    caret(bob, shared, 6);
    const seen: number[] = [];
    bob.on('selectionChange', (snapshot) => {
      if (snapshot.selectionRange) seen.push(snapshot.selectionRange.head.offset);
    });

    caret(alice, shared, 0);
    expect(alice.exec({ type: 'insertText', text: 'Our ' }).ok).toBe(true);
    deliver();
    expect(paragraphTextOf(bob.surface!.session.part(), shared)).toBe('Our Shared text');
    expect(bob.getSelectionRange()?.head).toEqual({ blockId: shared, offset: 10 });
    expect(bob.snapshot().selectionRange?.head.offset).toBe(10);
    expect(seen).toContain(10);

    // A remote delete before the caret moves it back.
    expect(
      alice.exec({
        type: 'setSelection',
        range: {
          anchor: { blockId: shared, offset: 0 },
          head: { blockId: shared, offset: 4 },
        },
      }).ok
    ).toBe(true);
    expect(alice.surface!.deleteSelection()).toBe(true);
    deliver();
    expect(bob.getSelectionRange()?.head).toEqual({ blockId: shared, offset: 6 });

    // A remote edit after the caret leaves the read unchanged, by reference.
    const before = bob.getSelectionRange();
    caret(alice, paragraph(alice, 1), 4);
    expect(alice.exec({ type: 'insertText', text: '!' }).ok).toBe(true);
    deliver();
    expect(bob.getSelectionRange()).toBe(before);

    // The read still restores the same place after the document moved under it.
    caret(bob, paragraph(bob, 1), 0);
    expect(bob.exec({ type: 'setSelection', range: before! }).ok).toBe(true);
    expect(bob.getSelectionRange()).toEqual(before);
  });

  test('concurrent typing at the caret and before it converges on the caret after the text', async () => {
    const { alice, bob, deliver, pause, resume } = await pair();
    const shared = paragraph(bob, 0);
    caret(bob, shared, 6);
    caret(alice, shared, 0);
    pause();
    expect(alice.exec({ type: 'insertText', text: 'Our ' }).ok).toBe(true);
    expect(bob.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    deliver();
    resume();
    deliver();
    expect(paragraphTextOf(bob.surface!.session.part(), shared)).toBe('Our SharedX text');
    expect(paragraphTextOf(alice.surface!.session.part(), shared)).toBe('Our SharedX text');
    // Read at once, before the scheduler's own layout task carries the caret: the text has
    // already moved, so the read must not pair it with the old offset.
    expect(bob.getSelectionRange()?.head).toEqual({ blockId: shared, offset: 11 });
    expect(bob.snapshot().selectionRange?.head.offset).toBe(11);
    expect(alice.getSelectionRange()?.head).toEqual({ blockId: shared, offset: 4 });
  });

  test('a remote undo of an insert before the caret restores its offset', async () => {
    const { alice, bob, deliver } = await pair();
    const shared = paragraph(bob, 0);
    caret(bob, shared, 11);
    caret(alice, shared, 0);
    expect(alice.exec({ type: 'insertText', text: 'Our ' }).ok).toBe(true);
    deliver();
    expect(bob.getSelectionRange()?.head.offset).toBe(15);
    expect(alice.exec({ type: 'undo' }).ok).toBe(true);
    deliver();
    expect(paragraphTextOf(bob.surface!.session.part(), shared)).toBe('Shared text');
    expect(bob.getSelectionRange()?.head).toEqual({ blockId: shared, offset: 11 });
  });
});
