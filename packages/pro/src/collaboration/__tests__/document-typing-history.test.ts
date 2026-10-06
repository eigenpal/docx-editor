/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Typing runs on collaborating editors: one shared undo item per run, bounded by the same
// intent rules as local history, never by the capture clock.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, R, REL, W, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('typing-history');
const offlineHarness = createPeerHarness('typing-history-offline', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
type Mounted = { readonly editor: Editor; readonly container: HTMLElement };
const mounted: Mounted[] = [];
afterEach(() => {
  for (const { editor, container } of mounted.splice(0)) {
    editor.destroy();
    container.remove();
  }
  harness.cleanup();
  offlineHarness.cleanup();
});

function mount(options: Parameters<typeof createDocxEditor>[0]): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  const peer = { editor: createDocxEditor({ ...options, container }), container };
  mounted.push(peer);
  return peer;
}

function caret(editor: Editor, paragraphIndex: number, offset: number): void {
  const paragraphId = editor.surface!.session.paragraphIds()[paragraphIndex]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

/** Type one key per task, as a person does: every key is its own flush and journal. */
async function typeSlowly(peer: Mounted, text: string): Promise<void> {
  for (const data of text) {
    peer.container.querySelector('.docx-pages')!.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const HEADER_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const WITH_HEADER = zipDocument(
  '<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>' +
    '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>',
  {
    overrides: `<Override PartName="/word/header1.xml" ContentType="${HEADER_TYPE}"/>`,
    documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/></Relationships>`,
    extraXml: {
      'word/header1.xml': `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Head</w:t></w:r></w:p></w:hdr>`,
    },
  }
);

async function pair(bytes = WITH_HEADER, peerHarness = harness) {
  const peers = await peerHarness.pair(bytes);
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  }) as [Mounted, Mounted];
  const text = (peer: Mounted) => peer.editor.surface!.session.bodyText();
  const converge = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    expect(packageFingerprint(alice.editor.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.editor.surface!.session.currentPackage())
    );
    expect(text(alice)).toBe(text(bob));
  };
  return { alice, bob, text, converge, peers };
}

test('concurrent typing runs are one shared undo item each, and survive reopen', async () => {
  const { alice, bob, text, converge } = await pair();
  caret(alice.editor, 0, 3);
  caret(bob.editor, 1, 3);
  // Interleaved: each key of one run lands between keys of the other run.
  const aliceTyping = typeSlowly(alice, ' alpha');
  const bobTyping = typeSlowly(bob, ' beta');
  await Promise.all([aliceTyping, bobTyping]);
  converge();
  expect(text(alice)).toContain('one alpha');
  expect(text(alice)).toContain('two beta');

  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(text(bob)).not.toContain('alpha');
  expect(text(bob)).toContain('two beta');
  expect(bob.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(text(alice)).not.toContain('beta');

  expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(text(bob)).toContain('one alpha');
  expect(text(bob)).not.toContain('beta');

  const reopened = mount({ document: new Uint8Array(await bob.editor.save()) });
  expect(saveReopenDigest(reopened.editor.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(bob.editor.surface!.session.currentPackage())
  );
});

test('a caret move splits the shared undo item inside the capture window', async () => {
  const { alice, bob, text, converge } = await pair();
  caret(alice.editor, 0, 3);
  await typeSlowly(alice, 'AB');
  caret(alice.editor, 0, 0);
  await typeSlowly(alice, 'CD');
  converge();
  expect(text(bob).startsWith('CDoneAB')).toBe(true);
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(text(bob).startsWith('oneAB')).toBe(true);
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(text(bob)).toBe('one\ntwo');
});

test("a collaborator's edit in the run's paragraph ends the run", async () => {
  const { alice, bob, text, converge } = await pair();
  caret(alice.editor, 0, 3);
  await typeSlowly(alice, 'AB');
  converge();
  caret(bob.editor, 0, 0);
  await typeSlowly(bob, 'x');
  converge();
  const beforeSecondRun = text(alice);
  await typeSlowly(alice, 'CD');
  converge();
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  // Only the keys typed after the collaborator's edit are undone.
  expect(text(bob)).toBe(beforeSecondRun);
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(text(bob)).toBe('xone\ntwo');
});

test("a collaborator's split of the run's paragraph ends the run", async () => {
  const { alice, bob, text, converge } = await pair();
  caret(alice.editor, 0, 3);
  await typeSlowly(alice, 'AB');
  converge();
  caret(bob.editor, 0, 2);
  bob.editor.surface!.splitParagraph();
  converge();
  const beforeSecondRun = text(alice);
  await typeSlowly(alice, 'CD');
  converge();
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(text(bob)).toBe(beforeSecondRun);
});

test("a collaborator's edit in another paragraph keeps the run open", async () => {
  const { alice, bob, text, converge } = await pair();
  caret(alice.editor, 0, 3);
  caret(bob.editor, 1, 3);
  await typeSlowly(alice, 'A');
  await typeSlowly(bob, 'x');
  converge();
  await typeSlowly(alice, 'B');
  converge();
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(text(bob)).toBe('one\ntwox');
});

test('a collaborator typing in a header keeps the body run open', async () => {
  const { alice, bob, text, converge } = await pair();
  const header = bob.editor.findMatches('Head')[0]!;
  expect(bob.editor.surface!.setActiveScope(header.scope!)).toBe(true);
  bob.editor.selectMatch(header);
  caret(alice.editor, 0, 3);
  for (const key of 'ABCD') {
    await typeSlowly(alice, key);
    expect(bob.editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    converge();
  }
  expect(text(bob)).toContain('oneABCD');
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(text(bob)).toBe('one\ntwo');
});

test('a run typed while disconnected is one step after reconnect', async () => {
  const { alice, bob, text, converge, peers } = await pair(WITH_HEADER, offlineHarness);
  peers.pause();
  peers.alice.room.session.setTransportStatus(
    'disconnected',
    'transport-disconnected',
    'test-drop'
  );
  expect(peers.alice.room.session.statusSnapshot().status).toBe('disconnected');
  caret(alice.editor, 0, 3);
  await typeSlowly(alice, ' offline');
  caret(bob.editor, 1, 3);
  await typeSlowly(bob, '!');
  peers.alice.room.session.setTransportStatus('ready');
  peers.resume();
  converge();
  expect(text(bob)).toBe('one offline\ntwo!');
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(text(bob)).toBe('one\ntwo!');
  expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(text(bob)).toBe('one offline\ntwo!');
});
