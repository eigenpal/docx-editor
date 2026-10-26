/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { linesOf, styleForFontSlot } from '@docx-editor.dev/core/layout';
import { paragraphTextOf } from '@docx-editor.dev/core/store';

import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

const xml = async (editor: DocxEditorInstance) =>
  strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);

test('a font pick on Chinese text converges, undoes, and survives reconnect and reopen', async () => {
  const bytes = zipDocument(
    '<w:p><w:r><w:rPr>' +
      '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="SimSun"/>' +
      '<w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr><w:t>中文DOCX</w:t></w:r></w:p>'
  );
  const harness = createPeerHarness('font-pick-east-asian-slot', { offlineEditing: true });
  const views: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
  const mount = (peer: Peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    const view = { editor, container };
    views.push(view);
    return view;
  };
  try {
    const { alice, bob, pause, resume } = await harness.pair(bytes);
    const left = mount(alice),
      right = mount(bob);
    const paragraphId = linesOf(left.editor.surface!.layout())[0]!.spans[0]!.range.paragraphId;
    const select = (editor: DocxEditorInstance, start: number, end = start) =>
      editor.exec({
        type: 'setSelection',
        range: { anchor: { paragraphId, offset: start }, head: { paragraphId, offset: end } },
      });
    const text = () => paragraphTextOf(left.editor.surface!.session.part(), paragraphId);
    const faceOf = (editor: DocxEditorInstance, character: string) =>
      linesOf(editor.surface!.layout())
        .flatMap((line) => line.spans)
        .filter((span) => span.text.includes(character))
        .map((span) => styleForFontSlot(span.style, span.fontSlot).fontFamily)[0];
    const box = (editor: DocxEditorInstance) => editor.snapshot().formatting?.fontFamily;

    // The pick on the Chinese characters, while the other peer types Latin text at the end.
    pause();
    select(left.editor, 0, 2);
    expect(box(left.editor)).toBe('SimSun');
    expect(
      left.editor.exec({
        type: 'setMarkAttr',
        mark: 'fontFamily',
        attr: 'family',
        value: 'Microsoft YaHei',
      }).ok
    ).toBe(true);
    select(right.editor, 6);
    expect(right.editor.exec({ type: 'insertText', text: '!' }).ok).toBe(true);
    resume();
    expect(text()).toBe('中文DOCX!');
    expect(await xml(right.editor)).toBe(await xml(left.editor));
    expect(faceOf(left.editor, '中')).toBe('Microsoft YaHei');
    expect(faceOf(right.editor, '中')).toBe('Microsoft YaHei');
    expect(faceOf(right.editor, 'D')).toBe('Calibri');
    select(right.editor, 0, 2);
    expect(box(right.editor)).toBe('Microsoft YaHei');

    expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(await xml(right.editor)).toBe(await xml(left.editor));
    expect(faceOf(right.editor, '中')).toBe('SimSun');
    expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(await xml(right.editor)).toBe(await xml(left.editor));
    expect(faceOf(right.editor, '中')).toBe('Microsoft YaHei');

    // Deleting the picked text while the other peer edits the Latin part.
    pause();
    select(left.editor, 0, 1);
    select(right.editor, 2);
    expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    resume();
    expect(text()).toBe('文xDOCX!');
    expect(await xml(right.editor)).toBe(await xml(left.editor));

    right.editor.destroy();
    right.container.remove();
    views.splice(views.indexOf(right), 1);
    harness.leave(bob);
    const reconnected = mount(await harness.join(alice, 'bob-reconnected'));
    expect(await xml(reconnected.editor)).toBe(await xml(left.editor));
    expect(faceOf(reconnected.editor, '文')).toBe('Microsoft YaHei');

    const container = document.createElement('div');
    document.body.append(container);
    const reopened = createDocxEditor({
      container,
      document: new Uint8Array(await left.editor.save()),
    });
    views.push({ editor: reopened, container });
    expect(await xml(reopened)).toBe(await xml(left.editor));
    expect(faceOf(reopened, '文')).toBe('Microsoft YaHei');
    expect((await xml(reopened)).includes('w:eastAsia="Microsoft YaHei"')).toBe(true);
  } finally {
    for (const view of views) {
      view.editor.destroy();
      view.container.remove();
    }
    harness.cleanup();
  }
});
