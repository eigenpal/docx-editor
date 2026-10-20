/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { linesOf } from '@docx-editor.dev/core/layout';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { styleForFontSlot } from '../../../../core/src/layout/script-itemization.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

const xml = async (editor: DocxEditorInstance) =>
  strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);

test('hAnsi faces remain local through two-editor edits and reconnect', async () => {
  const bytes = zipDocument(
    '<w:p><w:r><w:rPr>' +
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Arial" w:eastAsia="SimSun"/>' +
      '<w:b/><w:i/><w:sz w:val="28"/></w:rPr><w:t>Aé文B</w:t></w:r></w:p>'
  );
  const harness = createPeerHarness('hansi-font-slots', { offlineEditing: true });
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
        range: {
          anchor: { paragraphId, offset: start },
          head: { paragraphId, offset: end },
        },
      });
    const text = () => paragraphTextOf(left.editor.surface!.session.part(), paragraphId);
    const faces = (editor: DocxEditorInstance) =>
      linesOf(editor.surface!.layout())
        .flatMap((line) => line.spans)
        .map((span) => ({
          text: span.text,
          family: styleForFontSlot(span.style, span.fontSlot).fontFamily,
          range: span.range,
          box: span.box,
        }));
    const before = await xml(left.editor);
    expect(await xml(right.editor)).toBe(before);
    expect(faces(left.editor)).toEqual(faces(right.editor));
    expect(faces(left.editor).find((span) => span.text === 'é')!.family).toBe('Arial');
    expect(faces(left.editor).find((span) => span.text === '文')!.family).toBe('SimSun');
    select(right.editor, 2);
    const remoteSelection = right.editor.surface!.state().selection;
    const localGeometry = faces(left.editor);
    select(left.editor, 1);
    expect(faces(left.editor)).toEqual(localGeometry);
    expect(right.editor.surface!.state().selection).toEqual(remoteSelection);
    expect(await xml(left.editor)).toBe(before);
    expect(JSON.stringify(alice.awareness.getLocalState()).includes('hAnsi')).toBe(false);

    pause();
    select(left.editor, 1);
    select(right.editor, 4);
    expect(left.editor.exec({ type: 'insertText', text: 'ü' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'C' }).ok).toBe(true);
    resume();
    expect(text()).toBe('Aüé文BC');
    expect(await xml(right.editor)).toBe(await xml(left.editor));
    expect(faces(left.editor)).toEqual(faces(right.editor));
    expect(
      faces(left.editor)
        .filter((span) => /[üé]/.test(span.text))
        .every((span) => span.family === 'Arial')
    ).toBe(true);
    expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(text()).toBe('Aé文BC');
    expect(await xml(right.editor)).toBe(await xml(left.editor));
    expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(text()).toBe('Aüé文BC');
    expect(await xml(right.editor)).toBe(await xml(left.editor));

    pause();
    select(left.editor, 1, 2);
    select(right.editor, 6);
    expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'D' }).ok).toBe(true);
    resume();
    expect(text()).toBe('Aé文BCD');
    expect(await xml(right.editor)).toBe(await xml(left.editor));
    right.editor.destroy();
    right.container.remove();
    views.splice(views.indexOf(right), 1);
    harness.leave(bob);
    select(left.editor, 6);
    expect(left.editor.exec({ type: 'insertText', text: 'ñ' }).ok).toBe(true);
    const reconnected = mount(await harness.join(alice, 'bob-reconnected'));
    expect(await xml(reconnected.editor)).toBe(await xml(left.editor));
    expect(faces(reconnected.editor)).toEqual(faces(left.editor));
    select(reconnected.editor, 7);
    expect(reconnected.editor.exec({ type: 'insertText', text: 'ö' }).ok).toBe(true);
    expect(await xml(reconnected.editor)).toBe(await xml(left.editor));
    expect(text()).toBe('Aé文BCDñö');

    const container = document.createElement('div');
    document.body.append(container);
    const reopened = createDocxEditor({
      container,
      document: new Uint8Array(await left.editor.save()),
    });
    views.push({ editor: reopened, container });
    expect(await xml(reopened)).toBe(await xml(left.editor));
    expect(faces(reopened).map(({ text, family }) => ({ text, family }))).toEqual(
      faces(left.editor).map(({ text, family }) => ({ text, family }))
    );
    expect((await xml(reopened)).includes('w:hAnsi="Arial"')).toBe(true);
    expect((await xml(reopened)).includes('w:ascii="Times New Roman"')).toBe(true);
  } finally {
    for (const view of views) {
      view.editor.destroy();
      view.container.remove();
    }
    harness.cleanup();
  }
});

test('hinted letters and full-width forms keep the same faces on both editors', async () => {
  const bytes = zipDocument(
    '<w:p><w:r><w:rPr>' +
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Arial" w:eastAsia="SimSun" w:hint="eastAsia"/>' +
      '<w:lang w:eastAsia="ja-JP"/></w:rPr><w:t>AéąＡ</w:t></w:r></w:p>'
  );
  const harness = createPeerHarness('font-slot-defaults', { offlineEditing: true });
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
    views.push({ editor, container });
    return editor;
  };
  const faces = (editor: DocxEditorInstance) =>
    linesOf(editor.surface!.layout())
      .flatMap((line) => line.spans)
      .map((span) => [span.text, styleForFontSlot(span.style, span.fontSlot).fontFamily]);
  try {
    const { alice, bob, pause, resume } = await harness.pair(bytes);
    const left = mount(alice),
      right = mount(bob);
    // Japanese language: é takes hAnsi; the Chinese face still claims ą; Ａ is East Asian.
    expect(faces(left)).toEqual([
      ['A', 'Times New Roman'],
      ['é', 'Arial'],
      ['ąＡ', 'SimSun'],
    ]);
    expect(faces(right)).toEqual(faces(left));
    const paragraphId = linesOf(left.surface!.layout())[0]!.spans[0]!.range.paragraphId;
    const at = (editor: DocxEditorInstance, offset: number) =>
      editor.exec({
        type: 'setSelection',
        range: { anchor: { paragraphId, offset }, head: { paragraphId, offset } },
      });
    pause();
    at(left, 1);
    at(right, 4);
    expect(left.exec({ type: 'insertText', text: 'Ｂ' }).ok).toBe(true);
    expect(right.exec({ type: 'insertText', text: 'ü' }).ok).toBe(true);
    resume();
    expect(faces(right)).toEqual(faces(left));
    expect(faces(left).find(([text]) => text?.includes('Ｂ'))?.[1]).toBe('SimSun');
  } finally {
    for (const view of views) {
      view.editor.destroy();
      view.container.remove();
    }
    harness.cleanup();
  }
});
