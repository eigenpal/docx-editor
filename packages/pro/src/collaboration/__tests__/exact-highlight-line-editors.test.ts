/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});

const source = zipDocument(
  '<w:p><w:pPr><w:spacing w:line="580" w:lineRule="exact"/></w:pPr>' +
    '<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>Alpha</w:t></w:r>' +
    '<w:r><w:t xml:space="preserve"> beta</w:t></w:r></w:p>'
);

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Collaborative editors did not converge');
}

function verifyHighlight(container: HTMLElement) {
  const line = container.querySelector<HTMLElement>('.docx-line');
  const layer = line?.querySelector('.docx-character-fill-band');
  const bands = layer?.querySelectorAll<HTMLElement>('[data-highlight="yellow"]');
  expect(bands).toHaveLength(1);
  expect(bands![0]!.style.height).toBe(line!.style.height);
  expect(bands![0]!.style.top).toBe('0px');
  expect(layer?.getAttribute('aria-hidden')).toBe('true');
}

test('two editors retain full-height highlights through concurrent edits and reopen', async () => {
  const harness = createPeerHarness('exact-line-highlight');
  const opened: { container: HTMLElement; editor: DocxEditorInstance }[] = [];
  const open = (peer?: Peer, saved?: Uint8Array) => {
    peer?.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer?.room.document ?? saved!,
      ...(peer ? { modules: [collaborationModule({ session: peer.room.session })] } : {}),
    });
    const view = { container, editor };
    opened.push(view);
    return view;
  };
  try {
    const pair = await harness.pair(source);
    const left = open(pair.alice);
    const right = open(pair.bob);
    await until(() => !!left.editor.surface && !!right.editor.surface);
    for (const view of [left, right]) verifyHighlight(view.container);
    const paragraphId = harness.paragraphIdAt(pair.alice, 0);
    pair.pause();
    for (const [view, offset, text] of [
      [left, 2, 'L'],
      [right, 8, 'R'],
    ] as const) {
      const point = { paragraphId, offset };
      expect(
        view.editor.exec({ type: 'setSelection', range: { anchor: point, head: point } }).ok
      ).toBe(true);
      expect(view.editor.exec({ type: 'insertText', text }).ok).toBe(true);
    }
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
    pair.resume();
    await until(() =>
      [left, right].every(({ editor }) =>
        editor.surface!.session.bodyText().includes('AlLpha beRta')
      )
    );
    const bytes = new Uint8Array(await left.editor.save());
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']!);
    const rightXml = strFromU8(
      unzipSync(new Uint8Array(await right.editor.save()))['word/document.xml']!
    );
    expect(xml).toBe(rightXml);
    expect(xml).toContain('<w:highlight w:val="yellow"');
    expect(xml).toContain('w:lineRule="exact"');
    const reopened = open(undefined, bytes);
    await until(() => !!reopened.editor.surface);
    for (const view of [left, right, reopened]) verifyHighlight(view.container);
  } finally {
    for (const { editor, container } of opened) {
      editor.destroy();
      container.remove();
    }
    harness.cleanup();
  }
}, 10_000);
