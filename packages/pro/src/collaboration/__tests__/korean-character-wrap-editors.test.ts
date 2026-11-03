/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// With `w:wordWrap` off, a Korean paragraph keeps Latin words whole on two replicas through
// concurrent typing, deletion under a remote edit, undo and redo, and a cold reopen. A
// paragraph that is not Korean divides them.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('korean-character-wrap');
const views: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    view.editor.destroy();
    view.container.remove();
  }
  harness.cleanup();
});

const KO = '<w:lang w:eastAsia="ko-KR"/>';
const WORDS = 'Extraordinarily comprehensive internationalization considerations notwithstanding';
const paragraph = (mark: string) =>
  `<w:p><w:pPr><w:wordWrap w:val="0"/><w:rPr>${mark}</w:rPr></w:pPr>` +
  `<w:r><w:rPr>${KO}</w:rPr><w:t xml:space="preserve">${WORDS}</w:t></w:r></w:p>`;
// The first paragraph has a Korean mark; the second does not.
const BODY = `${paragraph(KO)}${paragraph('')}<w:sectPr/>`;

async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('The replicas did not converge');
}

/** Each paragraph's lines, as text. */
function view(editor: DocxEditorInstance): string[][] {
  return editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments)
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? [fragment.lines.map((line) => line.spans.map((span) => span.text).join(''))]
        : []
    );
}

/** Whether a line break falls between two Latin letters. */
const dividesWord = (lines: readonly string[]) =>
  lines.slice(1).some((line, index) => /[A-Za-z]$/.test(lines[index]!) && /^[A-Za-z]/.test(line));

test('a Korean paragraph keeps Latin words whole on both replicas', async () => {
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
    return editor;
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
  const shared = async (first: string) => {
    flush();
    await until(() => views.every((entry) => view(entry.editor)[0]!.join('') === first));
    const mine = view(left);
    expect(view(right)).toEqual(mine);
    expect(dividesWord(mine[0]!)).toBe(false);
    for (const editor of [left, right]) {
      const cold = createDocxEditor({
        container: document.createElement('div'),
        document: new Uint8Array(await editor.save()),
      });
      try {
        expect(view(cold)).toEqual(mine);
      } finally {
        cold.destroy();
      }
    }
    return mine;
  };

  const opened = await shared(WORDS);
  expect(opened[0]!.length).toBeGreaterThan(1);
  // The paragraph without a Korean mark divides its words.
  expect(dividesWord(opened[1]!)).toBe(true);

  // Concurrent: Alice appends words while Bob types at the start.
  pair.pause();
  select(left, 0, WORDS.length);
  expect(left.exec({ type: 'insertText', text: ' uncharacteristically' }).ok).toBe(true);
  select(right, 0, 0);
  expect(right.exec({ type: 'insertText', text: 'Remarkably ' }).ok).toBe(true);
  flush();
  pair.resume();
  const typed = `Remarkably ${WORDS} uncharacteristically`;
  await shared(typed);

  // Deletion under a remote edit: Alice removes the first word while Bob types inside it.
  pair.pause();
  select(left, 0, 0, 11);
  expect(left.exec({ type: 'deleteText' }).ok).toBe(true);
  select(right, 0, 4);
  expect(right.exec({ type: 'insertText', text: 'Q' }).ok).toBe(true);
  flush();
  pair.resume();
  const merged = `Q${WORDS} uncharacteristically`;
  await shared(merged);

  expect(left.exec({ type: 'undo' }).ok).toBe(true);
  await shared(`RemaQrkably ${WORDS} uncharacteristically`);
  expect(left.exec({ type: 'redo' }).ok).toBe(true);
  await shared(merged);
});
