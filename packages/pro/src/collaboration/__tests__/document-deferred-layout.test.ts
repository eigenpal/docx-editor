/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An edit that moves many pages may finish its later pages in the background. A remote edit
// that arrives during that pass drops it and lays out again, so both participants must still
// converge on the same package and on a cold layout after concurrent edits, undo, and redo.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('deferred-layout-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const scroller of document.querySelectorAll('.docx-editor__scroll-container'))
    scroller.remove();
  harness.cleanup();
});

function body(): string {
  const parts: string[] = [];
  for (let index = 0; index < 4000; index += 1) {
    parts.push(`<w:p><w:r><w:t>Paragraph ${index}</w:t></w:r></w:p>`);
  }
  return parts.join('') + '<w:sectPr/>';
}

function linesOf(editor: Editor): string {
  return editor
    .surface!.layout()
    .pages.flatMap((page, index) =>
      page.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph'
          ? fragment.lines.map(
              (line) => `${index}|${line.spans.map((span) => span.text).join('')}|${line.box.y}`
            )
          : []
      )
    )
    .join('\n');
}

function coldLinesOf(editor: Editor): string {
  const cold = createDocxEditor({
    container: document.createElement('div'),
    document: editor.surface!.session.save(),
  });
  try {
    return linesOf(cold);
  } finally {
    cold.destroy();
  }
}

/** A container in a scroll viewport one page tall, so the editor knows which pages show. */
function scrolledContainer(): HTMLElement {
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 1000 });
  const container = document.createElement('div');
  scroller.append(container);
  document.body.append(scroller);
  return container;
}

/** Wait for any background pass to publish the cold layout. */
async function settled(editor: Editor, cold: string): Promise<string> {
  const until = Date.now() + 10_000;
  while (Date.now() < until && linesOf(editor) !== cold) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return linesOf(editor);
}

test('a remote edit during a background pass still converges on a cold layout', async () => {
  const peers = await harness.pair(zipDocument(body()));
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: scrolledContainer(),
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
  const converged = async () => {
    sync();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
    for (const editor of [alice, bob]) {
      const cold = coldLinesOf(editor);
      expect(await settled(editor, cold)).toBe(cold);
    }
  };
  const split = (editor: Editor, index: number, offset: number) => {
    const paragraphId = editor.surface!.session.paragraphIds()[index]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
    editor.surface!.splitParagraph();
  };

  await converged();
  // Alice moves every later page; Bob's edit reaches her before her pass finishes.
  split(alice, 0, 4);
  split(bob, 1, 3);
  sync();
  split(alice, 2, 2);
  sync();
  await converged();

  // Concurrent: Bob deletes a later paragraph's text while Alice moves the pages again.
  split(alice, 0, 2);
  const later = bob.surface!.session.paragraphIds()[2000]!;
  const next = bob.surface!.session.paragraphIds()[2001]!;
  bob.surface!.setSelection({
    anchor: { paragraphId: later, offset: 0 },
    head: { paragraphId: next, offset: 0 },
  });
  bob.surface!.deleteSelection();
  await converged();

  alice.surface!.undo();
  await converged();
  alice.surface!.redo();
  await converged();
}, 60_000);
