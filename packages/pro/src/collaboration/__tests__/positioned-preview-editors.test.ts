/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, REL, R, zipDocument, type Peer } from './document-peer-support.ts';

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});

const preview =
  '<w:object xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" w:dxaOrig="400" w:dyaOrig="372">' +
  '<v:shape id="_x0000_i1025" type="#_x0000_t75" style="width:20pt;height:18.6pt" o:ole="" filled="f" stroked="f">' +
  '<v:imagedata r:id="rPreview"/><v:stroke on="f" joinstyle="miter"/></v:shape>' +
  '<o:OLEObject Type="Embed" ProgID="Equation.3" ShapeID="_x0000_i1025" r:id="rOle"></o:OLEObject>' +
  '</w:object>';
const body =
  '<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr>' +
  '<w:r><w:t>A</w:t></w:r><w:r><w:rPr><w:position w:val="-6"/></w:rPr>' +
  preview +
  '</w:r><w:r><w:t>Z</w:t></w:r></w:p><w:sectPr><w:docGrid w:type="lines" w:linePitch="312"/></w:sectPr>';
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (byte) => byte.charCodeAt(0)
);
const ole = Uint8Array.of(1, 2, 3, 4);
const documentBytes = zipSync({
  ...unzipSync(
    zipDocument(body, {
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

function verifyDrawing(editor: DocxEditorInstance) {
  const block = editor.surface!.layout().pages[0]?.fragments[0];
  if (block?.kind !== 'paragraph') throw new Error('Missing paragraph');
  const line = block.lines[0]!;
  const drawing = line.drawings?.[0];
  if (!drawing) throw new Error('Missing preview');
  expect(drawing.width).toBeCloseTo(20, 8);
  expect(drawing.height).toBeCloseTo(18.6, 8);
  expect(line.box.height).toBeCloseTo(31.2, 8);
  expect(drawing.y + drawing.height - line.box.y - line.baseline).toBeCloseTo(3, 8);
}

test('two editors keep inline preview geometry on a line grid through concurrent edits and reopen', async () => {
  const harness = createPeerHarness('positioned-equation-preview');
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
    const pair = await harness.pair(documentBytes);
    const left = mount(pair.alice);
    const right = mount(pair.bob);
    await until(() => !!left.surface && !!right.surface);
    const paragraphId = harness.paragraphIdAt(pair.alice, 0);
    const insert = (editor: DocxEditorInstance, offset: number, text: string) => {
      const point = { paragraphId, offset };
      expect(editor.exec({ type: 'setSelection', range: { anchor: point, head: point } }).ok).toBe(
        true
      );
      expect(editor.exec({ type: 'insertText', text }).ok).toBe(true);
    };
    verifyDrawing(left);
    verifyDrawing(right);
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
    expect(main).toContain('<w:position w:val="-6"');
    expect(leftPackage['word/embeddings/oleObject1.bin']).toEqual(ole);
    expect(leftPackage['word/media/preview.png']).toEqual(png);
    const reopened = mount(undefined, saved);
    await until(() => !!reopened.surface);
    expect(reopened.surface!.session.bodyText()).toContain('AL\uFFFCRZ');
    for (const editor of [left, right, reopened]) verifyDrawing(editor);
  } finally {
    for (const { editor, container } of views) {
      editor.destroy();
      container.remove();
    }
    harness.cleanup();
  }
}, 10_000);
