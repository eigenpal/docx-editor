/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The engine asks for the font faces that the laid-out text uses. A participant's edit
// that makes text bold, or puts it in another family, must make the OTHER editor ask
// for that face too. Otherwise the remote text paints in a face that never loads.
import { expect, test } from 'bun:test';
import {
  createDocxEditor,
  defineFontResolver,
  type DocxEditorInstance,
  type FontResolutionRequest,
} from '@docx-editor.dev/core/editor';
import { linesOf } from '@docx-editor.dev/core/layout';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

const settle = async (until: () => boolean) => {
  for (let i = 0; i < 200 && !until(); i++) await new Promise((r) => setTimeout(r, 10));
};

test('a remote bold edit and a remote family change ask the other editor for those faces', async () => {
  const bytes = zipDocument(
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr><w:t>shared text</w:t></w:r></w:p>'
  );
  const harness = createPeerHarness('remote-font-faces');
  const asked: Record<'alice' | 'bob', FontResolutionRequest[]> = { alice: [], bob: [] };
  const editors: DocxEditorInstance[] = [];
  const containers: HTMLElement[] = [];
  const mount = (peer: Peer, name: 'alice' | 'bob') => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
      fonts: defineFontResolver(async (request) => {
        asked[name].push(request);
        return undefined;
      }),
    });
    editors.push(editor);
    return editor;
  };
  const facesAsked = (name: 'alice' | 'bob') =>
    asked[name]
      .flatMap((request) => request.faces ?? [])
      .map((f) => `${f.family}/${f.weight}/${f.style}`);
  try {
    const { alice, bob } = await harness.pair(bytes);
    const left = mount(alice, 'alice');
    mount(bob, 'bob');
    await settle(() => asked.bob.length > 0 && asked.alice.length > 0);
    expect(facesAsked('bob')).toContain('Georgia/400/normal');
    expect(facesAsked('bob')).not.toContain('Georgia/700/normal');

    const target = linesOf(left.surface!.layout())[0]!.spans[0]!.range.paragraphId;
    const select = () =>
      expect(
        left.exec({
          type: 'setSelection',
          range: {
            anchor: { paragraphId: target!, offset: 0 },
            head: { paragraphId: target!, offset: 6 },
          },
        }).ok
      ).toBe(true);
    select();
    expect(left.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
    await settle(() => facesAsked('bob').includes('Georgia/700/normal'));
    expect(facesAsked('bob')).toContain('Georgia/700/normal');

    select();
    expect(
      left.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: 'Roboto' }).ok
    ).toBe(true);
    await settle(() => facesAsked('bob').some((face) => face.startsWith('Roboto/700')));
    expect(facesAsked('bob')).toContain('Roboto/700/normal');
  } finally {
    for (const editor of editors) editor.destroy();
    for (const container of containers) container.remove();
  }
});
