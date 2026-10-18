/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A peer that reads the document on a worker joins the same shared document as one that reads
// it on the page: edits from both converge, undo and redo travel, a deletion beside a remote
// insertion resolves, and the saved file reopens.
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

const WORKER_URL = new URL('../../../../core/src/parse/worker.ts', import.meta.url);

async function until(check: () => boolean) {
  for (let i = 0; i < 1000; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('The real shared editor state did not converge');
}

// Past the open's yield threshold (512 KiB of content), so the open is prepared and the
// worker reads it. The first paragraph is the one the peers edit.
const FILLER = Array.from(
  { length: 5000 },
  (_, index) =>
    `<w:p><w:r><w:t>Filler paragraph ${index} keeps this document large.</w:t></w:r></w:p>`
).join('');

test('a peer that reads on a worker edits, undoes, and saves with a peer that reads on the page', async () => {
  const harness = createPeerHarness('parse-in-worker');
  const views: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
  let workers = 0;
  const mount = (peer: Peer, onWorker: boolean) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
      ...(onWorker
        ? {
            parseInWorker: () => {
              workers += 1;
              return new Worker(WORKER_URL);
            },
          }
        : {}),
    });
    const view = { editor, container };
    views.push(view);
    return view;
  };
  const xml = async (editor: DocxEditorInstance) =>
    strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  const firstParagraph = (editor: DocxEditorInstance) =>
    editor.surface!.session.bodyText().split('\n')[0];
  try {
    const pair = await harness.pair(zipDocument(`<w:p><w:r><w:t>AB</w:t></w:r></w:p>${FILLER}`));
    const left = mount(pair.alice, true),
      right = mount(pair.bob, false);
    await until(() =>
      views.every((view) => !!view.editor.surface && !view.editor.snapshot().isOpening)
    );
    expect(workers).toBe(1);
    const id = harness.paragraphIdAt(pair.alice, 0);
    const select = (editor: DocxEditorInstance, start: number, end = start) =>
      editor.exec({
        type: 'setSelection',
        range: {
          anchor: { paragraphId: id, offset: start },
          head: { paragraphId: id, offset: end },
        },
      });
    const flush = () => {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
    };
    const shared = async (expected: string) => {
      flush();
      await until(() => views.every((view) => firstParagraph(view.editor) === expected));
      expect(await xml(left.editor)).toBe(await xml(right.editor));
    };
    pair.pause();
    select(left.editor, 0);
    select(right.editor, 2);
    expect(left.editor.exec({ type: 'insertText', text: 'L' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'R' }).ok).toBe(true);
    flush();
    pair.resume();
    await shared('LABR');
    expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
    await shared('ABR');
    expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
    await shared('LABR');
    pair.pause();
    select(left.editor, 1, 3);
    select(right.editor, 2);
    expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    flush();
    pair.resume();
    await shared('LXR');
    const cold = document.createElement('div');
    document.body.append(cold);
    const reopened = createDocxEditor({
      container: cold,
      document: new Uint8Array(await left.editor.save()),
    });
    try {
      await until(() => !!reopened.surface && !reopened.snapshot().isOpening);
      expect(firstParagraph(reopened)).toBe('LXR');
    } finally {
      reopened.destroy();
      cold.remove();
    }
  } finally {
    for (const view of views) {
      view.editor.destroy();
      view.container.remove();
    }
    harness.cleanup();
  }
}, 60_000);
