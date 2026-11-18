/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

const closing =
  '<w:p><w:pPr><w:spacing w:line="360" w:lineRule="exact"/></w:pPr>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
const documentBody =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> TOC </w:instrText>' +
  '<w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Cached entry</w:t></w:r></w:p>' +
  closing +
  '<w:p><w:r><w:t>ABCD</w:t></w:r></w:p>' +
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
  '<w:tr><w:tc><w:p><w:r><w:t>Following table</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('Collaborative editors did not converge');
}

function geometry(editor: DocxEditorInstance) {
  const firstPage = editor.surface!.layout().pages[0]!;
  const second = firstPage.fragments[1];
  const close =
    second?.kind === 'paragraph' &&
    second.lines.every((line) => line.spans.every((span) => !span.text))
      ? second
      : undefined;
  const table = firstPage.fragments.find((fragment) => fragment.kind === 'table');
  return { closing: close?.box.height, tableTop: table?.box.y };
}

test('two editors keep a separate TOC end mark during concurrent changes and after a cold save', async () => {
  const harness = createPeerHarness('standalone-toc-closing-paragraph');
  const views: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
  const mount = (peer?: Peer, bytes?: Uint8Array) => {
    peer?.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer?.room.document ?? bytes!,
      ...(peer ? { modules: [collaborationModule({ session: peer.room.session })] } : {}),
    });
    const view = { editor, container };
    views.push(view);
    return view;
  };
  try {
    const pair = await harness.pair(zipDocument(documentBody));
    const left = mount(pair.alice);
    const right = mount(pair.bob);
    await until(() => !!left.editor.surface && !!right.editor.surface);
    const id = harness.paragraphIdAt(pair.alice, 2);
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
      const wholeWord = new RegExp(`(?:^|[^A-Z])${expected}(?:$|[^A-Z])`);
      await until(() =>
        [left, right].every((view) => wholeWord.test(view.editor.surface!.session.bodyText()))
      );
      expect(geometry(left.editor)).toEqual(geometry(right.editor));
      expect(geometry(left.editor).closing ?? 0).toBeGreaterThan(0);
    };

    await shared('ABCD');
    pair.pause();
    select(left.editor, 0);
    select(right.editor, 4);
    expect(left.editor.exec({ type: 'insertText', text: 'L' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'R' }).ok).toBe(true);
    flush();
    pair.resume();
    await shared('LABCDR');
    expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
    await shared('ABCDR');
    expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
    await shared('LABCDR');

    select(right.editor, 3);
    applyAwarenessUpdate(
      pair.alice.awareness,
      encodeAwarenessUpdate(pair.bob.awareness, [pair.bob.awareness.clientID]),
      'test-provider'
    );
    const caret = left.container.querySelector<HTMLElement>('.docx-remote-caret');
    expect(caret).not.toBeNull();
    expect(Number.isFinite(parseFloat(caret!.style.top))).toBe(true);

    pair.pause();
    select(left.editor, 1, 3);
    select(right.editor, 2);
    expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    flush();
    pair.resume();
    await shared('LXCDR');
    const saved = new Uint8Array(await left.editor.save());
    const documentXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!);
    expect(documentXml(saved)).toBe(documentXml(new Uint8Array(await right.editor.save())));
    expect(documentXml(saved)).toContain('w:fldCharType="end"');
    const cold = mount(undefined, saved);
    await until(() => !!cold.editor.surface);
    expect(cold.editor.surface!.session.bodyText()).toContain('LXCDR');
    expect(geometry(cold.editor)).toEqual(geometry(left.editor));
  } finally {
    for (const view of views) {
      view.editor.destroy();
      view.container.remove();
    }
    harness.cleanup();
  }
}, 10000);
