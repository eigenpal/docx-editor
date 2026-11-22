/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, REL, R, zipDocument, type Peer } from './document-peer-support.ts';

const NS =
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';
const shape =
  '<v:shape id="_x0000_i1025" type="#_x0000_t75" style="width:20pt;height:10pt" o:ole="" filled="f" stroked="f">' +
  '<v:imagedata r:id="rPreview"/><v:stroke on="f" joinstyle="miter"/></v:shape>' +
  '<o:OLEObject Type="Embed" ProgID="Equation.3" ShapeID="_x0000_i1025" r:id="rOle"><o:LockedField>false</o:LockedField></o:OLEObject>';
// The same locked preview in object form and in picture form.
const previews = {
  object: `<w:object ${NS} w:dxaOrig="400" w:dyaOrig="200">${shape}</w:object>`,
  picture: `<w:pict ${NS}>${shape}</w:pict>`,
};
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (byte) => byte.charCodeAt(0)
);
const ole = Uint8Array.of(1, 2, 3, 4);
const documentBytes = (preview: string) =>
  zipSync({
    ...unzipSync(
      zipDocument('<w:p><w:r><w:t>A</w:t>' + preview + '<w:t>Z</w:t></w:r></w:p>', {
        overrides:
          '<Default Extension="png" ContentType="image/png"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>',
        documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rPreview" Type="${R}/image" Target="media/preview.png"/><Relationship Id="rOle" Type="${R}/oleObject" Target="embeddings/oleObject1.bin"/></Relationships>`,
      })
    ),
    'word/media/preview.png': png,
    'word/embeddings/oleObject1.bin': ole,
  });

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Collaborative editors did not converge');
}

function drawingSize(editor: DocxEditorInstance) {
  const block = editor.surface!.layout().pages[0]?.fragments[0];
  const preview = block?.kind === 'paragraph' ? block.lines[0]?.drawings?.[0] : undefined;
  return [preview?.width, preview?.height];
}

for (const [form, preview] of Object.entries(previews))
  test(`two editors keep a locked ${form} preview and its paragraph offsets through concurrent edits and save`, async () => {
    const harness = createPeerHarness(`locked-equation-${form}-preview`);
    const views: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
    const mount = (peer?: Peer, saved?: Uint8Array) => {
      peer?.detach();
      const container = document.createElement('div');
      document.body.append(container);
      const editor = createDocxEditor({
        container,
        document: peer?.room.document ?? saved!,
        ...(peer ? { modules: [collaborationModule({ session: peer.room.session })] } : {}),
      });
      views.push({ editor, container });
      return editor;
    };
    try {
      const pair = await harness.pair(documentBytes(preview));
      const left = mount(pair.alice);
      const right = mount(pair.bob);
      await until(() => !!left.surface && !!right.surface);
      const paragraphId = harness.paragraphIdAt(pair.alice, 0);
      const insert = (editor: DocxEditorInstance, offset: number, text: string) => {
        const point = { paragraphId, offset };
        expect(
          editor.exec({ type: 'setSelection', range: { anchor: point, head: point } }).ok
        ).toBe(true);
        expect(editor.exec({ type: 'insertText', text }).ok).toBe(true);
      };
      expect(drawingSize(left)).toEqual([20, 10]);
      expect(drawingSize(right)).toEqual([20, 10]);
      pair.pause();
      insert(left, 1, 'L');
      insert(right, 2, 'R');
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
      pair.resume();
      await until(() =>
        [left, right].every((editor) => editor.surface!.session.bodyText().includes('AL\uFFFCRZ'))
      );
      const saved = new Uint8Array(await left.save());
      const leftPackage = unzipSync(saved);
      const rightPackage = unzipSync(new Uint8Array(await right.save()));
      const main = strFromU8(leftPackage['word/document.xml']!);
      expect(main).toBe(strFromU8(rightPackage['word/document.xml']!));
      expect(main).toContain('<o:LockedField>false</o:LockedField>');
      expect(leftPackage['word/embeddings/oleObject1.bin']).toEqual(ole);
      expect(leftPackage['word/media/preview.png']).toEqual(png);
      const reopened = mount(undefined, saved);
      await until(() => !!reopened.surface);
      expect(reopened.surface!.session.bodyText()).toContain('AL\uFFFCRZ');
      for (const editor of [left, right, reopened]) expect(drawingSize(editor)).toEqual([20, 10]);
      // One participant deletes the preview while the other types beside it; undo restores it.
      const bodies = () => [left, right].map((editor) => editor.surface!.session.bodyText());
      pair.pause();
      const range = { anchor: { paragraphId, offset: 2 }, head: { paragraphId, offset: 3 } };
      expect(left.exec({ type: 'setSelection', range }).ok).toBe(true);
      expect(left.exec({ type: 'deleteText' }).ok).toBe(true);
      insert(right, 3, 'B');
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
      pair.resume();
      await until(() => bodies().every((text) => text.includes('ALBRZ')));
      expect(bodies().every((text) => !text.includes('\uFFFC'))).toBe(true);
      expect(left.exec({ type: 'undo' }).ok).toBe(true);
      await until(() => bodies().every((text) => text.includes('AL\uFFFCBRZ')));
      for (const editor of [left, right]) expect(drawingSize(editor)).toEqual([20, 10]);
      expect(left.exec({ type: 'redo' }).ok).toBe(true);
      await until(() => bodies().every((text) => text.includes('ALBRZ')));
      expect(bodies().every((text) => !text.includes('\uFFFC'))).toBe(true);
    } finally {
      for (const { editor, container } of views) {
        editor.destroy();
        container.remove();
      }
      harness.cleanup();
    }
  }, 10_000);
