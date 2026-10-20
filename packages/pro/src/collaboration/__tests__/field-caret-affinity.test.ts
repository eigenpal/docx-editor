/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { linesOf } from '@docx-editor.dev/core/layout';
import { FIELD_ATOM_CHAR, paragraphTextOf } from '@docx-editor.dev/core/store';
import {
  FIELD_AFFINITY_RESULTS,
  fieldAffinityDocument,
} from '../../../../core/src/editor/__tests__/fixtures/field-affinity-document.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness } from './document-peer-support.ts';

const xml = async (editor: DocxEditorInstance) =>
  strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);

for (const [label, result] of FIELD_AFFINITY_RESULTS) {
  test(`clicked field line stays local on two collaborating editors: ${label}`, async () => {
    const harness = createPeerHarness('field-line-' + label, { offlineEditing: true });
    const views: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
    try {
      const { alice, bob, pause, resume } = await harness.pair(fieldAffinityDocument(result));
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
      const lines = linesOf(surface.layout());
      const middle = lines[1]!;
      const span = middle.spans.find((span) => span.projected)!;
      const position = { paragraphId: span.range.paragraphId, offset: span.range.end };
      right.editor.exec({ type: 'setSelection', range: { anchor: position, head: position } });
      const otherSelection = right.editor.surface!.state().selection;
      const before = await xml(left.editor);
      expect(await xml(right.editor)).toBe(before);
      const pages = left.container.querySelector<HTMLElement>('.docx-pages')!;
      Object.defineProperty(pages, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 0, top: 0, width: 1000, height: 2000, right: 1000, bottom: 2000 }),
      });
      const page = surface.layout().pages[0]!;
      const scale = left.editor.getRenderScale();
      const init = {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: (page.contentBox.x + span.box.x + span.box.width * 0.2) * scale,
        clientY: (page.contentBox.y + middle.box.y + middle.box.height / 2) * scale,
      };
      pages.dispatchEvent(new PointerEvent('pointerdown', init));
      document.dispatchEvent(new PointerEvent('pointerup', init));
      const native = document.getSelection()!;
      const node = native.focusNode!;
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement!;
      expect((element.closest('[data-line-id]') as HTMLElement)?.dataset.lineId).toBe(middle.id);
      expect(right.editor.surface!.state().selection).toEqual(otherSelection);
      expect(await xml(left.editor)).toBe(before);
      expect(await xml(right.editor)).toBe(before);
      expect(JSON.stringify(alice.awareness.getLocalState()).includes('preferredLineId')).toBe(
        false
      );

      left.editor.exec({ type: 'insertText', text: 'Z' });
      await Promise.resolve();
      expect(await xml(right.editor)).toBe(await xml(left.editor));
      expect((await xml(right.editor)).includes('Z')).toBe(true);
      expect(paragraphTextOf(surface.session.part(), span.range.paragraphId)).toBe(
        'Z' + FIELD_ATOM_CHAR
      );
      left.editor.exec({ type: 'undo' });
      expect(await xml(right.editor)).toBe(before);
      left.editor.exec({ type: 'redo' });
      expect(await xml(right.editor)).toBe(await xml(left.editor));
      left.editor.exec({ type: 'undo' });
      expect(await xml(left.editor)).toBe(before);
      const paragraphId = span.range.paragraphId;
      const select = (editor: DocxEditorInstance, start: number, end = start) =>
        editor.exec({
          type: 'setSelection',
          range: {
            anchor: { paragraphId, offset: start },
            head: { paragraphId, offset: end },
          },
        });
      pause();
      select(left.editor, 0);
      select(right.editor, 1);
      expect(left.editor.exec({ type: 'insertText', text: 'A' }).ok).toBe(true);
      expect(right.editor.exec({ type: 'insertText', text: 'B' }).ok).toBe(true);
      resume();
      expect(await xml(right.editor)).toBe(await xml(left.editor));
      expect(paragraphTextOf(surface.session.part(), paragraphId)).toBe(
        'A' + FIELD_ATOM_CHAR + 'B'
      );
      pause();
      select(left.editor, 0, 1);
      select(right.editor, 3);
      expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
      expect(right.editor.exec({ type: 'insertText', text: 'C' }).ok).toBe(true);
      resume();
      expect(await xml(right.editor)).toBe(await xml(left.editor));
      expect(paragraphTextOf(surface.session.part(), paragraphId)).toBe(FIELD_ATOM_CHAR + 'BC');
      const reopenContainer = document.createElement('div');
      document.body.append(reopenContainer);
      const reopened = createDocxEditor({
        container: reopenContainer,
        document: new Uint8Array(await left.editor.save()),
      });
      try {
        expect(await xml(reopened)).toBe(await xml(left.editor));
      } finally {
        reopened.destroy();
        reopenContainer.remove();
      }
    } finally {
      for (const view of views) {
        view.editor.destroy();
        view.container.remove();
      }
      harness.cleanup();
    }
  });
}
