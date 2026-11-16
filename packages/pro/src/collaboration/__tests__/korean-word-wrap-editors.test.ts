/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// With `w:wordWrap` on, a Korean paragraph breaks its lines only between words on two replicas
// through concurrent typing, deletion under a remote edit, undo and redo, and a cold reopen.
// Parentheses, commas, and digits stay in their words.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('korean-word-wrap');
const views: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    view.editor.destroy();
    view.container.remove();
  }
  harness.cleanup();
});

const KO = '<w:lang w:eastAsia="ko-KR"/>';
const WORDS = Array.from({ length: 8 }, (_, index) => `가나다(라마${index}), 바사아(자차)`).join(
  ' '
);
const BODY =
  `<w:p><w:pPr><w:jc w:val="both"/><w:rPr>${KO}</w:rPr></w:pPr>` +
  `<w:r><w:rPr>${KO}</w:rPr><w:t xml:space="preserve">${WORDS}</w:t></w:r></w:p><w:sectPr/>`;

async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('The replicas did not converge');
}

/** The paragraph's lines, as text. */
function view(editor: DocxEditorInstance): string[] {
  return editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments)
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.map((line) => line.spans.map((span) => span.text).join(''))
        : []
    );
}

/** Whether a line ends inside a word: every line but the last must end with its space. */
const breaksInsideWord = (lines: readonly string[]) =>
  lines.slice(0, -1).some((line) => !line.endsWith(' '));

test('a Korean paragraph breaks only between words on both replicas', async () => {
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
  const select = (editor: DocxEditorInstance, start: number, end = start) => {
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    return editor.exec({
      type: 'setSelection',
      range: { anchor: { paragraphId, offset: start }, head: { paragraphId, offset: end } },
    });
  };
  const shared = async (text: string) => {
    flush();
    await until(() => views.every((entry) => view(entry.editor).join('') === text));
    const mine = view(left);
    expect(view(right)).toEqual(mine);
    expect(mine.length).toBeGreaterThan(1);
    expect(breaksInsideWord(mine)).toBe(false);
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
  };

  await shared(WORDS);

  // Concurrent: Alice appends a word while Bob types one at the start.
  pair.pause();
  select(left, WORDS.length);
  expect(left.exec({ type: 'insertText', text: ' 카타(파하),' }).ok).toBe(true);
  select(right, 0);
  expect(right.exec({ type: 'insertText', text: '하가(나다) ' }).ok).toBe(true);
  flush();
  pair.resume();
  await shared(`하가(나다) ${WORDS} 카타(파하),`);

  // Deletion under a remote edit: Alice removes the first word while Bob types inside it.
  pair.pause();
  select(left, 0, 7);
  expect(left.exec({ type: 'deleteText' }).ok).toBe(true);
  select(right, 3);
  expect(right.exec({ type: 'insertText', text: '9' }).ok).toBe(true);
  flush();
  pair.resume();
  const merged = `9${WORDS} 카타(파하),`;
  await shared(merged);

  expect(left.exec({ type: 'undo' }).ok).toBe(true);
  await shared(`하가(9나다) ${WORDS} 카타(파하),`);
  expect(left.exec({ type: 'redo' }).ok).toBe(true);
  await shared(merged);
});
