/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Right-to-left letters typed at a caret start a `w:rtl` run on every peer.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { mainPart, packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('typed-rtl-direction', { offlineEditing: true });
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

/** The body runs that carry `w:rtl`, by their text. */
function rtlRuns(editor: Editor): string[] {
  const xml = serializeOoxmlPart(mainPart(editor.surface!.session.currentPackage()));
  return [...xml.matchAll(/<w:r>(?:(?!<\/w:r>).)*?<w:rtl\/>(?:(?!<\/w:r>).)*?<\/w:r>/gs)].map(
    // The run's text is the content of its `w:t` elements.
    (match) => [...match[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('')
  );
}

const DOCUMENT =
  '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t xml:space="preserve">Hello world</w:t></w:r></w:p>';

async function peers() {
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
  return { pair, alice, bob, flush, converge };
}

test('typed right-to-left text converges, undoes, redoes, reconnects, and reopens', async () => {
  const { pair, alice, bob, flush, converge } = await peers();
  pair.pause();
  caret(alice, 6);
  alice.surface!.type('مرحبا ');
  caret(bob, 11);
  bob.surface!.type('!');
  expect(alice.surface!.state().lastRejection).toBeNull();
  flush();
  pair.resume();
  converge();
  expect(bob.surface!.session.bodyText()).toBe('Hello مرحبا world!');
  expect(rtlRuns(bob)).toEqual(['مرحبا ']);

  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(rtlRuns(bob)).toEqual([]);
  expect(bob.surface!.session.bodyText()).toBe('Hello world!');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(rtlRuns(bob)).toEqual(['مرحبا ']);

  const rejoined = await harness.join(pair.alice, 'returning');
  rejoined.detach();
  const returning = mount({
    document: rejoined.room.document,
    modules: [collaborationModule({ session: rejoined.room.session })],
  });
  expect(rtlRuns(returning)).toEqual(['مرحبا ']);
  const reopened = mount({ document: new Uint8Array(await bob.save()) });
  expect(saveReopenDigest(reopened.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(bob.surface!.session.currentPackage())
  );
  expect(rtlRuns(reopened)).toEqual(['مرحبا ']);
});

test('a peer deleting the text around the caret while right-to-left text is typed converges', async () => {
  const { pair, alice, bob, flush, converge } = await peers();
  pair.pause();
  caret(alice, 6);
  alice.surface!.type('שלום');
  const paragraphId = bob.surface!.session.paragraphIds()[0]!;
  bob.surface!.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 11 },
  });
  bob.surface!.deleteBackward();
  flush();
  pair.resume();
  converge();
  expect(alice.surface!.session.bodyText()).toBe('שלום');
  expect(rtlRuns(alice)).toEqual(['שלום']);
});
