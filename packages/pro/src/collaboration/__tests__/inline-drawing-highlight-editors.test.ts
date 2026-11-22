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

const inlinePicture =
  '<w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="254000" cy="254000"/>' +
  '<wp:docPr id="1" name="Picture"/><a:graphic>' +
  '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rPicture"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="254000" cy="254000"/></a:xfrm><a:prstGeom prst="rect"/>' +
  '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
const body =
  '<w:p><w:r><w:t>A</w:t></w:r><w:r>' + inlinePicture + '</w:r><w:r><w:t>Z</w:t></w:r></w:p>';
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (byte) => byte.charCodeAt(0)
);
const source = zipSync({
  ...unzipSync(
    zipDocument(body, {
      overrides: '<Default Extension="png" ContentType="image/png"/>',
      documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rPicture" Type="${R}/image" Target="media/picture.png"/></Relationships>`,
    })
  ),
  'word/media/picture.png': png,
});

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Collaborative editors did not converge');
}

test('two editors paint the same picture-line highlight after concurrent edits and reopen', async () => {
  const harness = createPeerHarness('inline-picture-highlight');
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
    const view = { editor, container };
    views.push(view);
    return view;
  };
  const hasHighlight = ({ container }: (typeof views)[number]) =>
    container.querySelector('.docx-character-fill-band [data-highlight="yellow"]') !== null;
  try {
    const pair = await harness.pair(source);
    const left = mount(pair.alice);
    const right = mount(pair.bob);
    await until(() => !!left.editor.surface && !!right.editor.surface);
    const paragraphId = harness.paragraphIdAt(pair.alice, 0);
    const select = (editor: DocxEditorInstance, start: number, end = start) => {
      expect(
        editor.exec({
          type: 'setSelection',
          range: { anchor: { paragraphId, offset: start }, head: { paragraphId, offset: end } },
        }).ok
      ).toBe(true);
    };
    const sync = () => {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
    };
    pair.pause();
    select(left.editor, 0, 1);
    expect(
      left.editor.exec({ type: 'setMarkAttr', mark: 'highlight', attr: 'val', value: 'yellow' }).ok
    ).toBe(true);
    select(right.editor, 2);
    expect(right.editor.exec({ type: 'insertText', text: 'R' }).ok).toBe(true);
    sync();
    pair.resume();
    await until(() =>
      [left, right].every(
        (view) => hasHighlight(view) && view.editor.surface!.session.bodyText().includes('A￼RZ')
      )
    );
    expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync();
    await until(() => [left, right].every((view) => !hasHighlight(view)));
    expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
    sync();
    await until(() => [left, right].every(hasHighlight));
    const bytes = new Uint8Array(await left.editor.save());
    const leftPackage = unzipSync(bytes);
    const rightPackage = unzipSync(new Uint8Array(await right.editor.save()));
    expect(strFromU8(leftPackage['word/document.xml']!)).toBe(
      strFromU8(rightPackage['word/document.xml']!)
    );
    expect(leftPackage['word/media/picture.png']).toEqual(png);
    const reopened = mount(undefined, bytes);
    await until(() => hasHighlight(reopened));
    expect(reopened.editor.surface!.session.bodyText()).toContain('A￼RZ');
  } finally {
    for (const { editor, container } of views) {
      editor.destroy();
      container.remove();
    }
    harness.cleanup();
  }
}, 10_000);
