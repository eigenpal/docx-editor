/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { caretStops, linesOf } from '@docx-editor.dev/core/layout';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';

const WORDS = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp';
const BODY =
  '<w:p><w:r><w:t>first paragraph</w:t></w:r></w:p>' +
  `<w:p><w:r><w:t xml:space="preserve">${WORDS}</w:t></w:r></w:p>` +
  '<w:sectPr><w:pgSz w:w="4000" w:h="8000"/>' +
  '<w:pgMar w:top="0" w:bottom="0" w:left="0" w:right="0" w:header="0" w:footer="0"/></w:sectPr>';

/** The wrapped line nearest the painted caret's top. */
function paintedLine(editor: DocxEditorInstance, container: HTMLElement, paragraphId: string) {
  const caret = container.querySelector<HTMLElement>('[data-docx-caret]')!;
  const top = Number.parseFloat(caret.style.top);
  const layout = editor.surface!.layout();
  const ids = linesOf(layout)
    .filter((line) => line.range.paragraphId === paragraphId)
    .map((line) => line.id);
  let best = -1;
  let distance = Infinity;
  for (const stop of caretStops(layout)) {
    const index = ids.indexOf(stop.lineId);
    if (index >= 0 && Math.abs(stop.y - top) < distance) {
      distance = Math.abs(stop.y - top);
      best = index;
    }
  }
  return best;
}

test('a caret at the end of a wrapped line keeps its line through remote edits', async () => {
  const harness = createPeerHarness('caret-line-boundary', { offlineEditing: true });
  const views: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
  try {
    const { alice, bob } = await harness.pair(zipDocument(BODY));
    for (const peer of [alice, bob]) {
      peer.detach();
      const container = document.createElement('div');
      document.body.append(container);
      const editor = createDocxEditor({
        container,
        document: peer.room.document,
        modules: [collaborationModule({ session: peer.room.session })],
      });
      views.push({ editor, container });
    }
    const left = views[0]!;
    const right = views[1]!;
    const surface = left.editor.surface!;
    surface.focus();
    const lines = linesOf(surface.layout());
    const paragraphId = lines.at(-1)!.range.paragraphId;
    const wrapped = lines.filter((line) => line.range.paragraphId === paragraphId);
    expect(wrapped.length).toBeGreaterThan(1);
    const b = wrapped[1]!.range.start;

    // End on the first wrapped line: the shared offset, shown at the line's end.
    surface.setSelection({
      anchor: { paragraphId, offset: 2 },
      head: { paragraphId, offset: 2 },
    });
    surface.navigate('lineEnd');
    expect(surface.state().selection.head).toEqual({ paragraphId, offset: b });
    expect(paintedLine(left.editor, left.container, paragraphId)).toBe(0);

    // The other editor types in another paragraph and after the caret in this one.
    const firstId = lines[0]!.range.paragraphId;
    for (const [id, offset] of [
      [firstId, 5],
      [paragraphId, WORDS.length],
    ] as const) {
      right.editor.exec({
        type: 'setSelection',
        range: { anchor: { paragraphId: id, offset }, head: { paragraphId: id, offset } },
      });
      expect(right.editor.exec({ type: 'insertText', text: 'Z' }).ok).toBe(true);
      await Promise.resolve();
      expect(surface.state().selection.head).toEqual({ paragraphId, offset: b });
      expect(paintedLine(left.editor, left.container, paragraphId)).toBe(0);
    }

    // Local typing at the shared offset lands where the layout puts it, on the next line.
    surface.type('#');
    const after = linesOf(surface.layout()).filter(
      (line) => line.range.paragraphId === paragraphId
    );
    expect(after.findIndex((line) => line.spans.some((span) => span.text.includes('#')))).toBe(1);
  } finally {
    for (const view of views) {
      view.editor.destroy();
      view.container.remove();
    }
    harness.cleanup();
  }
});

test('a remote edit before the caret in its paragraph leaves a valid caret', async () => {
  const harness = createPeerHarness('caret-line-boundary-before', { offlineEditing: true });
  const views: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
  try {
    const { alice, bob } = await harness.pair(zipDocument(BODY));
    for (const peer of [alice, bob]) {
      peer.detach();
      const container = document.createElement('div');
      document.body.append(container);
      const editor = createDocxEditor({
        container,
        document: peer.room.document,
        modules: [collaborationModule({ session: peer.room.session })],
      });
      views.push({ editor, container });
    }
    const left = views[0]!;
    const right = views[1]!;
    const surface = left.editor.surface!;
    surface.focus();
    const lines = linesOf(surface.layout());
    const paragraphId = lines.at(-1)!.range.paragraphId;
    const b = lines.filter((line) => line.range.paragraphId === paragraphId)[1]!.range.start;
    surface.setSelection({
      anchor: { paragraphId, offset: 2 },
      head: { paragraphId, offset: 2 },
    });
    surface.navigate('lineEnd');
    expect(surface.state().selection.head.offset).toBe(b);

    right.editor.exec({
      type: 'setSelection',
      range: { anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 0 } },
    });
    expect(right.editor.exec({ type: 'insertText', text: 'Q' }).ok).toBe(true);
    await Promise.resolve();

    // Whether the local offset follows the remote insertion belongs to the collaboration
    // session; either way the caret stays on a painted line and keeps editing.
    const head = surface.state().selection.head;
    expect(head.paragraphId).toBe(paragraphId);
    expect([b, b + 1]).toContain(head.offset);
    expect(paintedLine(left.editor, left.container, paragraphId)).toBeGreaterThanOrEqual(0);
    surface.navigate('lineStart');
    surface.type('#');
    await Promise.resolve();
    const text = (editor: DocxEditorInstance) =>
      linesOf(editor.surface!.layout())
        .filter((line) => line.range.paragraphId === paragraphId)
        .flatMap((line) => line.spans.map((span) => span.text))
        .join('');
    expect(text(left.editor)).toContain('#');
    expect(text(right.editor)).toBe(text(left.editor));
  } finally {
    for (const view of views) {
      view.editor.destroy();
      view.container.remove();
    }
    harness.cleanup();
  }
});
