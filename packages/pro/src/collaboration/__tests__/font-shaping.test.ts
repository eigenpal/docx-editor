/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { linesOf } from '@docx-editor.dev/core/layout';
import { paragraphTextOf } from '@docx-editor.dev/core/store';

import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const enabled = { maxFontBytes: 20 * 1024 * 1024 };

async function settled(editor: DocxEditorInstance): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (
      editor.surface &&
      !editor.fontMeasurement().resolving &&
      editor.fontMeasurement().measurer === 'shaped'
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The editor did not complete admitted font shaping');
}

for (const rightPolicy of [enabled, undefined]) {
  test(`font shaping limits remain local with ${rightPolicy ? 'equal' : 'default'} peer limits`, async () => {
    const sourceBytes = new Uint8Array(16 * 1024 * 1024 + 1);
    sourceBytes.set(
      readFileSync(
        new URL(
          '../../../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf',
          import.meta.url
        )
      )
    );
    const sourceHash = hash(sourceBytes);
    const source = {
      id: 'public-dejavu-padded',
      bytes: sourceBytes,
      hash: 'sha256:' + sourceHash,
      faceIndex: 0,
      request: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
    };
    const fonts = { sources: [source], maxFontBytes: enabled.maxFontBytes };
    const bytes = zipDocument(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans"/><w:sz w:val="28"/></w:rPr><w:t>AB</w:t></w:r></w:p>'
    );
    const harness = createPeerHarness('font-shaping', { offlineEditing: true });
    const views: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
    const mount = (peer: Peer, policy: typeof enabled | undefined) => {
      peer.detach();
      const container = document.createElement('div');
      document.body.append(container);
      const editor = createDocxEditor({
        container,
        document: peer.room.document,
        fonts,
        fontShaping: policy,
        modules: [collaborationModule({ session: peer.room.session })],
      });
      const view = { editor, container };
      views.push(view);
      return view;
    };
    const xml = async (editor: DocxEditorInstance) =>
      strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    const geometry = (editor: DocxEditorInstance) =>
      linesOf(editor.surface!.layout()).map((line) => ({
        box: line.box,
        baseline: line.baseline,
        spans: line.spans.map((span) => ({
          text: span.text,
          range: span.range,
          box: span.box,
          family: span.style.fontFamily,
        })),
      }));
    try {
      const { alice, bob, pause, resume } = await harness.pair(bytes);
      const left = mount(alice, enabled),
        right = mount(bob, rightPolicy);
      await settled(left.editor);
      await settled(right.editor);
      const paragraphId = linesOf(left.editor.surface!.layout())[0]!.spans[0]!.range.paragraphId;
      const select = (editor: DocxEditorInstance, start: number, end = start) =>
        editor.exec({
          type: 'setSelection',
          range: { anchor: { paragraphId, offset: start }, head: { paragraphId, offset: end } },
        });
      const text = () => paragraphTextOf(left.editor.surface!.session.part(), paragraphId);
      const sameGeometry = () => {
        if (rightPolicy) expect(geometry(left.editor)).toEqual(geometry(right.editor));
      };
      sameGeometry();
      if (!rightPolicy) {
        expect(left.editor.fontMeasurement().producer).not.toBe(
          right.editor.fontMeasurement().producer
        );
        expect(geometry(left.editor)).not.toEqual(geometry(right.editor));
      }
      expect(await xml(left.editor)).toBe(await xml(right.editor));
      expect((await xml(left.editor)).includes('docx-embedded-')).toBe(false);
      expect(JSON.stringify(alice.awareness.getLocalState()).includes('maxFontBytes')).toBe(false);
      select(left.editor, 0, 1);
      applyAwarenessUpdate(
        bob.awareness,
        encodeAwarenessUpdate(alice.awareness, [alice.awareness.clientID]),
        'test'
      );
      expect(right.container.querySelector('.docx-remote-selection-rect')).not.toBeNull();
      const remote = bob.room.session.remoteSelections()[0]!;
      expect([remote.anchor.offset, remote.head.offset]).toEqual([0, 1]);
      pause();
      select(left.editor, 1);
      select(right.editor, 2);
      expect(left.editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
      expect(right.editor.exec({ type: 'insertText', text: 'Y' }).ok).toBe(true);
      resume();
      expect(text()).toBe('AXBY');
      expect(await xml(right.editor)).toBe(await xml(left.editor));
      sameGeometry();
      expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(text()).toBe('ABY');
      expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
      expect(text()).toBe('AXBY');
      pause();
      select(left.editor, 1, 2);
      select(right.editor, 4);
      expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
      expect(right.editor.exec({ type: 'insertText', text: 'Z' }).ok).toBe(true);
      resume();
      expect(text()).toBe('ABYZ');
      expect(await xml(right.editor)).toBe(await xml(left.editor));
      right.editor.destroy();
      right.container.remove();
      views.splice(views.indexOf(right), 1);
      harness.leave(bob);

      select(left.editor, 4);
      expect(left.editor.exec({ type: 'insertText', text: 'Q' }).ok).toBe(true);
      const reconnected = mount(await harness.join(alice, 'reconnected'), rightPolicy);
      await settled(reconnected.editor);
      expect(await xml(reconnected.editor)).toBe(await xml(left.editor));
      if (rightPolicy) expect(geometry(reconnected.editor)).toEqual(geometry(left.editor));
      const container = document.createElement('div');
      document.body.append(container);
      const reopened = createDocxEditor({
        container,
        document: new Uint8Array(await left.editor.save()),
        fonts,
        fontShaping: enabled,
      });
      views.push({ editor: reopened, container });
      await settled(reopened);
      expect(await xml(reopened)).toBe(await xml(left.editor));
      expect(geometry(reopened)).toEqual(geometry(left.editor));

      expect(hash(sourceBytes)).toBe(sourceHash);
      expect(source.faceIndex).toBe(0);
      expect(source.hash).toBe('sha256:' + sourceHash);
    } finally {
      for (const view of views) {
        view.editor.destroy();
        view.container.remove();
      }
      harness.cleanup();
    }
  });
}
