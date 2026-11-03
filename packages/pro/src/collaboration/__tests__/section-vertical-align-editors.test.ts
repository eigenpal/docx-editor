/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A vertically centered section stays centered on two replicas through concurrent edits,
// deletion under a remote edit, undo and redo, remote carets, and a cold reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { caretAt } from '@docx-editor.dev/core/layout';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('section-vertical-align');
const views: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    view.editor.destroy();
    view.container.remove();
  }
  harness.cleanup();
});

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const BODY = `${p('Title')}${p('Subtitle')}<w:sectPr><w:vAlign w:val="center"/></w:sectPr>`;

async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('The replicas did not converge');
}

/** Each line's text and top, and the free height above and below the body. */
function view(editor: DocxEditorInstance) {
  const page = editor.surface!.layout().pages[0]!;
  const lines = page.fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph'
      ? fragment.lines.map((line) => ({
          text: line.spans.map((span) => span.text).join(''),
          top: Math.round(line.box.y * 1000) / 1000,
        }))
      : []
  );
  const first = page.fragments[0]!;
  const last = page.fragments.at(-1)!;
  return {
    lines,
    above: first.box.y,
    below: page.contentBox.height - (last.box.y + last.box.height),
  };
}

test('a centered section stays centered on both replicas', async () => {
  const pair = await harness.pair(zipDocument(BODY));
  const mount = (peer: Peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    views.push({ editor, container });
    return { editor, container };
  };
  const left = mount(pair.alice);
  const right = mount(pair.bob);
  await until(() => views.every((entry) => !!entry.editor.surface));
  const flush = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  const select = (editor: DocxEditorInstance, index: number, start: number, end = start) => {
    const paragraphId = editor.surface!.session.paragraphIds()[index]!;
    return editor.exec({
      type: 'setSelection',
      range: { anchor: { paragraphId, offset: start }, head: { paragraphId, offset: end } },
    });
  };
  const shared = async (expected: string[]) => {
    flush();
    await until(() =>
      views.every(
        (entry) =>
          JSON.stringify(view(entry.editor).lines.map((line) => line.text)) ===
          JSON.stringify(expected)
      )
    );
    const mine = view(left.editor);
    expect(view(right.editor)).toEqual(mine);
    // Centered: the free height splits evenly above and below the body.
    expect(mine.above).toBeGreaterThan(100);
    expect(mine.above).toBeCloseTo(mine.below, 6);
    // A cold reopen of either replica lays the page out the same way.
    for (const entry of [left, right]) {
      const cold = createDocxEditor({
        container: document.createElement('div'),
        document: new Uint8Array(await entry.editor.save()),
      });
      try {
        expect(view(cold)).toEqual(mine);
      } finally {
        cold.destroy();
      }
    }
    return mine;
  };

  const opened = await shared(['Title', 'Subtitle']);

  // Concurrent: Alice adds a paragraph while Bob types into the subtitle.
  pair.pause();
  select(left.editor, 0, 5);
  left.editor.surface!.splitParagraph();
  expect(left.editor.exec({ type: 'insertText', text: 'Author' }).ok).toBe(true);
  select(right.editor, 1, 8);
  expect(right.editor.exec({ type: 'insertText', text: ' draft' }).ok).toBe(true);
  flush();
  pair.resume();
  const grown = await shared(['Title', 'Author', 'Subtitle draft']);
  // One more line moves the body up by half a line.
  const lineHeight = grown.lines[1]!.top - grown.lines[0]!.top;
  expect(grown.above).toBeCloseTo(opened.above - lineHeight / 2, 2);

  // Deletion under a remote edit: Alice empties the subtitle while Bob types into it.
  pair.pause();
  select(left.editor, 2, 0, 14);
  expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
  select(right.editor, 2, 3);
  expect(right.editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
  flush();
  pair.resume();
  await shared(['Title', 'Author', 'X']);

  expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
  await shared(['Title', 'Author', 'SubXtitle draft']);
  expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
  await shared(['Title', 'Author', 'X']);

  // Bob's caret paints on Alice's page at its centered position.
  const remoteTop = (index: number) => {
    select(right.editor, index, 0);
    applyAwarenessUpdate(
      pair.alice.awareness,
      encodeAwarenessUpdate(pair.bob.awareness, [pair.bob.awareness.clientID]),
      'test-provider'
    );
    const caret = left.container.querySelector<HTMLElement>('.docx-remote-caret');
    expect(caret).not.toBeNull();
    const layout = left.editor.surface!.layout();
    const paragraphId = left.editor.surface!.session.paragraphIds()[index]!;
    const geometry = caretAt(layout, { paragraphId, offset: 0 })!;
    return { painted: parseFloat(caret!.style.top), y: layout.pages[0]!.contentBox.y + geometry.y };
  };
  const first = remoteTop(0);
  const third = remoteTop(2);
  const scale = (third.painted - first.painted) / (third.y - first.y);
  expect(scale).toBeGreaterThan(0);
  for (const caret of [first, third]) expect(caret.painted).toBeCloseTo(caret.y * scale, 3);
  expect(first.y).toBeGreaterThan(300);
});
