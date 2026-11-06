/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Delete and Backspace leave a control's prompt whole on both replicas: under concurrent typing,
// a deletion while the other peer types in the same paragraph, undo and redo, suggesting mode,
// and a save and reopen.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { unzipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { packageFingerprint } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('prompt-delete', { offlineEditing: true });
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

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const PROMPT = 'Click here to enter text.';
/** "A " + prompt (offsets 2–27) + " B". */
const DOCUMENT =
  '<w:p>' +
  run('A ') +
  '<w:sdt><w:sdtPr><w:tag w:val="value"/><w:showingPlcHdr/><w:text/></w:sdtPr>' +
  `<w:sdtContent>${run(PROMPT)}</w:sdtContent></w:sdt>` +
  run(' B') +
  '</w:p>';

function select(editor: Editor, start: number, end = start) {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

const showsPrompt = (editor: Editor) => editor.surface!.layout().contentControls![0]!.placeholder;

async function savedXml(editor: Editor): Promise<string> {
  const part = unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!;
  return new TextDecoder().decode(part);
}

test('Delete and Backspace leave a prompt whole on both peers', async () => {
  const pair = await harness.pair(zipDocument(DOCUMENT));
  const open = (peer: Peer, author: string) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      author,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  };
  const alice = open(pair.alice, 'Alice');
  const bob = open(pair.bob, 'Bob');
  const flush = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  const converge = (text: string) => {
    flush();
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.surface!.session.currentPackage())
    );
    for (const editor of [alice, bob]) {
      expect(editor.surface!.session.bodyText()).toBe(text);
      expect(showsPrompt(editor)).toBe(true);
    }
  };

  // Concurrent: Alice presses Backspace and Delete in the prompt while Bob types after it.
  pair.pause();
  select(alice, 27);
  alice.surface!.deleteBackward();
  alice.surface!.deleteForward();
  select(bob, 29);
  bob.surface!.type('!');
  flush();
  pair.resume();
  converge(`A ${PROMPT} B!`);
  const { anchor, head } = alice.surface!.state().selection;
  expect([anchor.offset, head.offset].sort((a, b) => a - b)).toEqual([2, 27]);

  // Alice deletes from before the prompt into it while Bob types in the same paragraph.
  pair.pause();
  select(alice, 0, 10);
  alice.surface!.deleteForward();
  select(bob, 30);
  bob.surface!.type('?');
  flush();
  pair.resume();
  converge(`${PROMPT} B!?`);

  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge(`A ${PROMPT} B!?`);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge(`${PROMPT} B!?`);

  // Suggesting: Bob's range from inside the prompt past it strikes only the text after it.
  bob.surface!.setEditingMode('suggest');
  select(bob, 20, 27);
  bob.surface!.deleteBackward();
  converge(`${PROMPT} B!?`);
  for (const editor of [alice, bob]) {
    const xml = await savedXml(editor);
    expect(xml.match(/<w:delText[^>]*>[^<]*<\/w:delText>/g)).toEqual([
      '<w:delText xml:space="preserve"> B</w:delText>',
    ]);
    expect(xml).toContain(`<w:t>${PROMPT}</w:t>`);
  }

  // Both peers save a document that reopens with the prompt whole.
  for (const editor of [alice, bob]) {
    const cold = mount({ document: new Uint8Array(await editor.save()) });
    expect(cold.surface!.session.bodyText()).toBe(`${PROMPT} B!?`);
    expect(showsPrompt(cold)).toBe(true);
  }
});
