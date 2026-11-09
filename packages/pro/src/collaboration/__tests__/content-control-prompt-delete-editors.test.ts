/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Delete and Backspace treat a control's prompt as one unit on both replicas: the first press
// selects it, the second removes the control, and a range takes only the text around a prompt it
// takes part of. Covered here under concurrent typing in the same control and paragraph, undo
// and redo, suggesting mode, and a save and reopen.

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

const prompts = (editor: Editor) =>
  (editor.surface!.layout().contentControls ?? []).map((control) => control.placeholder);

async function savedXml(editor: Editor): Promise<string> {
  const part = unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!;
  return new TextDecoder().decode(part);
}

async function pairOfEditors() {
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
  /** Both replicas hold the same package, this text, and these controls' prompt states. */
  const converge = (text: string, shown: readonly boolean[]) => {
    flush();
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.surface!.session.currentPackage())
    );
    for (const editor of [alice, bob]) {
      expect(editor.surface!.session.bodyText()).toBe(text);
      expect(prompts(editor)).toEqual(shown);
    }
  };
  /** Runs both peers' edits offline, then lets them meet. */
  const concurrently = (edits: () => void) => {
    pair.pause();
    edits();
    flush();
    pair.resume();
  };
  return { alice, bob, converge, concurrently };
}

test('a peer removes the control while the other types into its prompt', async () => {
  const { alice, bob, converge, concurrently } = await pairOfEditors();
  concurrently(() => {
    select(alice, 27);
    alice.surface!.deleteBackward();
    alice.surface!.deleteBackward();
    select(bob, 12);
    bob.surface!.type('Z');
  });
  // What the other peer typed survives the removal, in the control it typed into.
  converge('A Z B', [false]);
  expect(bob.exec({ type: 'undo' }).ok).toBe(true);
  converge('A  B', []);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge(`A ${PROMPT} B`, [true]);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge('A  B', []);
});

test('a peer removes the control while the other types after it', async () => {
  const { alice, bob, converge, concurrently } = await pairOfEditors();
  concurrently(() => {
    select(alice, 2);
    alice.surface!.deleteForward();
    alice.surface!.deleteForward();
    select(bob, 29);
    bob.surface!.type('!');
  });
  converge('A  B!', []);
  expect(bob.exec({ type: 'undo' }).ok).toBe(true);
  converge('A  B', []);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge(`A ${PROMPT} B`, [true]);
});

test('ranges keep a prompt they take part of and remove a control they cover', async () => {
  const { alice, bob, converge, concurrently } = await pairOfEditors();
  concurrently(() => {
    select(alice, 0, 10);
    alice.surface!.deleteForward();
    select(bob, 29);
    bob.surface!.type('?');
  });
  converge(`${PROMPT} B?`, [true]);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge(`A ${PROMPT} B?`, [true]);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge(`${PROMPT} B?`, [true]);

  select(bob, 0, 26);
  bob.surface!.deleteForward();
  converge('B?', []);
  for (const editor of [alice, bob]) {
    const cold = mount({ document: new Uint8Array(await editor.save()) });
    expect(cold.surface!.session.bodyText()).toBe('B?');
  }
});

test('in suggesting mode one press proposes the control on both peers', async () => {
  const { alice, bob, converge, concurrently } = await pairOfEditors();
  bob.surface!.setEditingMode('suggest');
  concurrently(() => {
    select(bob, 27);
    bob.surface!.deleteBackward();
    select(alice, 0);
    alice.surface!.type('>');
  });
  converge(`>A ${PROMPT} B`, [true]);
  for (const editor of [alice, bob]) {
    const xml = await savedXml(editor);
    expect(xml).toMatch(/<w:del [^>]*w:author="Bob"[^>]*><w:sdt>/);
    expect(xml.match(/<w:delText[^>]*>[^<]*<\/w:delText>/g)).toEqual([
      `<w:delText>${PROMPT}</w:delText>`,
    ]);
    const cold = mount({ document: new Uint8Array(await editor.save()) });
    expect(cold.surface!.session.bodyText()).toBe(`>A ${PROMPT} B`);
  }
  expect(bob.exec({ type: 'undo' }).ok).toBe(true);
  converge(`>A ${PROMPT} B`, [true]);
  expect(await savedXml(alice)).not.toContain('<w:del ');
});
