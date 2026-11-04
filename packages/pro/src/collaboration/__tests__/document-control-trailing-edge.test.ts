/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Text pasted at the trailing edge of an inline text control stays in the control on every peer.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { mainPart, packageFingerprint } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('control-trailing-edge', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

function mount(options: Parameters<typeof createDocxEditor>[0]) {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({ ...options, container });
  editors.push(editor);
  return editor;
}

function caret(editor: Editor, offset: number) {
  const position = { paragraphId: editor.surface!.session.paragraphIds()[0]!, offset };
  editor.surface!.setSelection({ anchor: position, head: position });
}

/** The text inside the control's content. */
function controlText(editor: Editor): string {
  const xml = serializeOoxmlPart(mainPart(editor.surface!.session.currentPackage()));
  const content = /<w:sdtContent>(.*?)<\/w:sdtContent>/s.exec(xml)?.[1] ?? '';
  return [...content.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('');
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const DOCUMENT =
  '<w:p>' +
  run('A ') +
  '<w:sdt><w:sdtPr><w:tag w:val="value"/><w:text/></w:sdtPr><w:sdtContent>' +
  run('value') +
  '</w:sdtContent></w:sdt>' +
  run(' B') +
  '</w:p>';

test('a paste at the trailing edge lands in the control and converges, undoes, and redoes', async () => {
  const pair = await harness.pair(zipDocument(DOCUMENT));
  const [alice, bob] = [pair.alice, pair.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  }) as [Editor, Editor];
  const flush = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  const converge = () => {
    flush();
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.surface!.session.currentPackage())
    );
  };

  pair.pause();
  caret(alice, 7);
  expect(alice.exec({ type: 'pasteWithoutFormatting', text: 'X' })).toEqual({
    ok: true,
    changed: true,
  });
  caret(bob, 4);
  bob.surface!.type('Y');
  flush();
  pair.resume();
  converge();
  expect(bob.surface!.session.bodyText()).toBe('A vaYlueX B');
  expect(controlText(bob)).toBe('vaYlueX');

  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(controlText(bob)).toBe('vaYlue');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(controlText(bob)).toBe('vaYlueX');
});
