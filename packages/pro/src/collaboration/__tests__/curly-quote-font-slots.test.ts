/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { caretAt, linesOf, selectionRects } from '@docx-editor.dev/core/layout';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { styleForFontSlot } from '../../../../core/src/layout/script-itemization.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

const documentXml = async (editor: DocxEditorInstance) =>
  strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);

// These tests use the editor's layout lane. They do not assert installed font metrics.
for (const hinted of [false, true]) {
  test(`curly quote slots survive two-editor edits and reconnect (eastAsia hint: ${hinted})`, async () => {
    const original = 'A甲‘乙’丙“丁”戊B';
    const bytes = zipDocument(
      '<w:p><w:r><w:rPr>' +
        '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Arial" w:eastAsia="SimSun"' +
        (hinted ? ' w:hint="eastAsia"' : '') +
        '/><w:lang w:eastAsia="zh-CN"/><w:b/><w:sz w:val="28"/>' +
        '<w:spacing w:val="-4"/></w:rPr><w:t>' +
        original +
        '</w:t></w:r></w:p>'
    );
    const harness = createPeerHarness(`curly-quote-slots-${hinted}`, { offlineEditing: true });
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
    const destroyView = (view: (typeof views)[number]) => {
      view.editor.destroy();
      view.container.remove();
      views.splice(views.indexOf(view), 1);
    };
    const spans = (editor: DocxEditorInstance) =>
      linesOf(editor.surface!.layout())
        .flatMap((line) => line.spans)
        .map((span) => ({
          text: span.text,
          slot: span.fontSlot,
          family: styleForFontSlot(span.style, span.fontSlot).fontFamily,
          size: span.style.fontSizePt,
          spacing: span.style.characterSpacingPt,
          bold: span.style.bold,
          range: span.range,
          box: span.box,
        }));
    const characters = (editor: DocxEditorInstance) =>
      spans(editor).flatMap((span) =>
        Array.from(span.text, (character, index) => ({
          character,
          offset: span.range.start + index,
          paragraphId: span.range.paragraphId,
          slot: span.slot,
          family: span.family,
          size: span.size,
          spacing: span.spacing,
          bold: span.bold,
        }))
      );
    try {
      const { alice, bob, pause, resume } = await harness.pair(bytes);
      const left = mount(alice);
      const right = mount(bob);
      const paragraphId = spans(left.editor)[0]!.range.paragraphId;
      const range = (start: number, end = start) => ({
        anchor: { paragraphId, offset: start },
        head: { paragraphId, offset: end },
      });
      const select = (editor: DocxEditorInstance, start: number, end = start) =>
        expect(editor.exec({ type: 'setSelection', range: range(start, end) }).ok).toBe(true);
      const text = () => paragraphTextOf(left.editor.surface!.session.part(), paragraphId);
      const assertGeometry = (a: DocxEditorInstance, b: DocxEditorInstance, length: number) => {
        for (let offset = 0; offset <= length; offset++) {
          const position = { paragraphId, offset };
          const first = caretAt(a.surface!.layout(), position);
          const second = caretAt(b.surface!.layout(), position);
          expect(first).not.toBeNull();
          expect(second).not.toBeNull();
          expect(first!.position).toEqual(position);
          expect(second!.position).toEqual(position);
          expect([second!.x, second!.y, second!.height, second!.pageIndex]).toEqual([
            first!.x,
            first!.y,
            first!.height,
            first!.pageIndex,
          ]);
          if (offset === length) continue;
          const firstRects = selectionRects(a.surface!.layout(), range(offset, offset + 1), [
            paragraphId,
          ]);
          expect(firstRects.length).toBeGreaterThan(0);
          expect(
            selectionRects(b.surface!.layout(), range(offset, offset + 1), [paragraphId])
          ).toEqual(firstRects);
          expect(firstRects.every((rect) => rect.width > 0 && rect.height > 0)).toBe(true);
        }
      };
      const assertConverged = async (
        a: DocxEditorInstance,
        b: DocxEditorInstance,
        value: string
      ) => {
        expect(paragraphTextOf(a.surface!.session.part(), paragraphId)).toBe(value);
        expect(paragraphTextOf(b.surface!.session.part(), paragraphId)).toBe(value);
        expect(await documentXml(b)).toBe(await documentXml(a));
        expect(spans(b)).toEqual(spans(a));
        const resolved = characters(a);
        expect(resolved.map((item) => item.character).join('')).toBe(value);
        expect(resolved.map((item) => item.offset)).toEqual(
          Array.from({ length: value.length }, (_, index) => index)
        );
        for (const item of resolved) {
          const quote = /[‘’“”]/u.test(item.character);
          const ascii = /[AB]/u.test(item.character);
          expect(item.paragraphId).toBe(paragraphId);
          const family = quote
            ? hinted
              ? 'SimSun'
              : 'Arial'
            : ascii
              ? 'Times New Roman'
              : 'SimSun';
          expect(item.family).toBe(family);
          if (quote) expect(item.slot).toBe(hinted ? 'eastAsia' : 'hAnsi');
          expect(item.size).toBe(14);
          expect(item.spacing).toBe(-0.2);
          expect(item.bold).toBe(true);
        }
        assertGeometry(a, b, value.length);
      };

      await assertConverged(left.editor, right.editor, original);
      const before = await documentXml(left.editor);
      select(right.editor, 3, 5);
      const remoteSelection = right.editor.surface!.state().selection;
      select(left.editor, 2, 3);
      applyAwarenessUpdate(
        bob.awareness,
        encodeAwarenessUpdate(alice.awareness, [alice.awareness.clientID]),
        'relay'
      );
      expect(bob.room.session.remoteSelections()).toMatchObject([
        {
          actorId: 'alice',
          anchor: { nodeId: paragraphId, offset: 2 },
          head: { nodeId: paragraphId, offset: 3 },
        },
      ]);
      expect(right.editor.surface!.state().selection).toEqual(remoteSelection);
      expect(await documentXml(left.editor)).toBe(before);
      expect(JSON.stringify(alice.awareness.getLocalState()).includes('hAnsi')).toBe(false);
      await assertConverged(left.editor, right.editor, original);

      pause();
      const insertion = original.indexOf('‘');
      select(left.editor, insertion);
      select(right.editor, original.length);
      expect(left.editor.exec({ type: 'insertText', text: '“' }).ok).toBe(true);
      expect(right.editor.exec({ type: 'insertText', text: '’' }).ok).toBe(true);
      expect(text()).toBe(original.slice(0, insertion) + '“' + original.slice(insertion));
      expect(paragraphTextOf(right.editor.surface!.session.part(), paragraphId)).toBe(
        original + '’'
      );
      resume();
      let expected = original.slice(0, insertion) + '“' + original.slice(insertion) + '’';
      await assertConverged(left.editor, right.editor, expected);
      expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
      await assertConverged(left.editor, right.editor, original + '’');
      expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
      await assertConverged(left.editor, right.editor, expected);

      pause();
      const deletion = expected.indexOf('‘');
      select(left.editor, deletion, deletion + 1);
      select(right.editor, deletion + 1);
      expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
      expect(right.editor.exec({ type: 'insertText', text: '”' }).ok).toBe(true);
      resume();
      expected = expected.slice(0, deletion) + '”' + expected.slice(deletion + 1);
      await assertConverged(left.editor, right.editor, expected);

      destroyView(right);
      harness.leave(bob);
      select(left.editor, expected.length);
      expect(left.editor.exec({ type: 'insertText', text: '‘' }).ok).toBe(true);
      expected += '‘';
      const reconnected = mount(await harness.join(alice, 'bob-reconnected'));
      await assertConverged(left.editor, reconnected.editor, expected);
      select(reconnected.editor, expected.length);
      expect(reconnected.editor.exec({ type: 'insertText', text: '”' }).ok).toBe(true);
      expected += '”';
      await assertConverged(left.editor, reconnected.editor, expected);

      const container = document.createElement('div');
      document.body.append(container);
      const reopened = createDocxEditor({
        container,
        document: new Uint8Array(await left.editor.save()),
      });
      views.push({ editor: reopened, container });
      await assertConverged(left.editor, reopened, expected);
      const saved = await documentXml(reopened);
      for (const attribute of [
        'w:ascii="Times New Roman"',
        'w:hAnsi="Arial"',
        'w:eastAsia="SimSun"',
      ]) {
        expect(saved).toContain(attribute);
      }
      expect(saved).toContain('w:val="28"');
      expect(saved).toContain('w:val="-4"');
      expect(saved.includes('w:hint="eastAsia"')).toBe(hinted);
    } finally {
      for (const view of views) {
        view.editor.destroy();
        view.container.remove();
      }
      harness.cleanup();
    }
  });
}
