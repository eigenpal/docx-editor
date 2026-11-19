/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Copy and paste of a selected text box between collaborating editors: the copy replicates,
// converges, and undoes; concurrent pastes keep distinct drawing ids; a paste survives the
// source's deletion by the other participant, offline editing, and a late join.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('drawing-clipboard-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

function mounted(peer: Awaited<ReturnType<typeof harness.pair>>['alice']): Editor {
  peer.detach();
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: peer.room.document,
    modules: [collaborationModule({ session: peer.room.session })],
  });
  editors.push(editor);
  return editor;
}

async function pair(first = '<w:r><w:t>First</w:t></w:r>') {
  const peers = await harness.pair(
    zipDocument(`<w:p>${first}</w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>`)
  );
  const alice = mounted(peers.alice);
  const bob = mounted(peers.bob);
  function sync() {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  }
  function converged() {
    sync();
    alice.surface!.layout();
    bob.surface!.layout();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  }
  async function join() {
    return mounted(await harness.join(peers.alice, 'late-peer'));
  }
  return { alice, bob, sync, converged, join, pause: peers.pause, resume: peers.resume };
}

/** Insert a text box holding `text`, and leave it selected as a drawing. */
function insertBox(editor: Editor, text: string): void {
  expect(editor.exec({ type: 'insertTextBox' }).ok).toBe(true);
  expect(editor.exec({ type: 'insertText', text }).ok).toBe(true);
  selectBox(editor, text);
}

/** Select the text box that holds `text`, as a press on its frame does. */
function selectBox(editor: Editor, text: string, index = 0): string {
  const scope = editor.findMatches(text)[index]!.scope!;
  if (scope.kind !== 'frame') throw new Error('no text box holds the text');
  expect(editor.surface!.selectDrawing(scope.drawingNodeId, scope.hostParagraphId)).toBe(true);
  return scope.drawingNodeId;
}

/** Copy the selected drawing, put the caret at the end of body paragraph `paragraph`, paste. */
function copyAndPaste(editor: Editor, paragraph: number) {
  const flavours = editor.surface!.copyFlavours();
  expect(flavours.drawingNodeId).toBeString();
  pasteAt(editor, paragraph, flavours);
  return flavours;
}

function pasteAt(
  editor: Editor,
  paragraph: number,
  flavours: { text: string; html: string | null }
) {
  const surface = editor.surface!;
  surface.setActiveScope({ kind: 'body' });
  const paragraphId = surface.session.paragraphIds()[paragraph]!;
  surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 0 } });
  expect(editor.exec({ type: 'paste', text: flavours.text, html: flavours.html! })).toMatchObject({
    ok: true,
  });
}

async function docPrIds(editor: Editor): Promise<string[]> {
  const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  return [...xml.matchAll(/<wp:docPr id="(\d+)"/g)].map((match) => match[1]!);
}

test('a copied text box replicates, converges, undoes and redoes', async () => {
  const { alice, bob, converged } = await pair();
  insertBox(alice, 'Shared box');
  converged();
  copyAndPaste(alice, 1);
  converged();
  for (const editor of [alice, bob]) expect(editor.findMatches('Shared box')).toHaveLength(2);
  const ids = await docPrIds(bob);
  expect(new Set(ids).size).toBe(2);
  // Typing in the copy changes the copy alone, everywhere.
  selectBox(bob, 'Shared box', 1);
  expect(bob.surface!.setActiveScope(bob.findMatches('Shared box')[1]!.scope!)).toBe(true);
  expect(bob.exec({ type: 'insertText', text: 'Copy: ' }).ok).toBe(true);
  converged();
  expect(alice.findMatches('Copy: ')).toHaveLength(1);
  expect(alice.findMatches('Shared box')).toHaveLength(2);

  expect(bob.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(bob.findMatches('Shared box')).toHaveLength(1);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  expect(bob.findMatches('Shared box')).toHaveLength(2);
});

test('concurrent pastes and a deletion of the source converge with distinct drawing ids', async () => {
  const { alice, bob, sync, converged, pause, resume } = await pair();
  insertBox(alice, 'Source box');
  converged();
  const copy = alice.surface!.copyFlavours();
  selectBox(bob, 'Source box');
  const bobCopy = bob.surface!.copyFlavours();
  pause();
  // Alice pastes her copy twice while Bob, offline, pastes his and then deletes the source.
  pasteAt(alice, 0, copy);
  pasteAt(alice, 1, copy);
  pasteAt(bob, 1, bobCopy);
  selectBox(bob, 'Source box', 0);
  expect(bob.exec({ type: 'deleteImage' }).ok).toBe(true);
  sync();
  resume();
  converged();
  for (const editor of [alice, bob]) expect(editor.findMatches('Source box')).toHaveLength(3);
  const ids = await docPrIds(alice);
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(3);
});

test('a late participant receives the pasted copy and can copy it again', async () => {
  const { alice, converged, join } = await pair();
  insertBox(alice, 'Joined box');
  copyAndPaste(alice, 1);
  converged();
  const late = await join();
  expect(late.findMatches('Joined box')).toHaveLength(2);
  selectBox(late, 'Joined box', 1);
  copyAndPaste(late, 0);
  late.surface!.collaborationSession()!.flushPendingJournals();
  converged();
  expect(alice.findMatches('Joined box')).toHaveLength(3);
  expect(saveReopenDigest(late.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(alice.surface!.session.currentPackage())
  );
});

test('a cut while the other participant types in the box converges and undoes', async () => {
  const { alice, bob, sync, converged, pause, resume } = await pair();
  insertBox(alice, 'Cut box');
  converged();
  expect(bob.surface!.setActiveScope(bob.findMatches('Cut box')[0]!.scope!)).toBe(true);
  pause();
  selectBox(alice, 'Cut box');
  const cut = alice.surface!.copyFlavours();
  expect(alice.exec({ type: 'cut' })).toMatchObject({ ok: true });
  expect(bob.exec({ type: 'insertText', text: 'Typed ' }).ok).toBe(true);
  sync();
  resume();
  converged();
  for (const editor of [alice, bob]) expect(editor.findMatches('Cut box')).toHaveLength(0);
  // The cut copy pastes back. Collaboration undo groups edits inside its capture window, so one
  // undo reverts the paste and the cut, and the original returns with Bob's typing in it.
  pasteAt(alice, 1, cut);
  converged();
  expect(bob.findMatches('Cut box')).toHaveLength(1);
  expect(bob.findMatches('Typed Cut box')).toHaveLength(0);
  expect(alice.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
  converged();
  for (const editor of [alice, bob]) expect(editor.findMatches('Typed Cut box')).toHaveLength(1);
  expect(bob.findMatches('Cut box')).toHaveLength(1);
});

test('concurrent pastes of a legacy VML shape keep distinct shape numbers', async () => {
  const vml =
    '<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" ' +
    'xmlns:o="urn:schemas-microsoft-com:office:office" id="Legacy" o:spid="_x0000_s1026" ' +
    'style="position:absolute;margin-left:10pt;margin-top:10pt;width:100pt;height:40pt;z-index:1">' +
    '<v:textbox><w:txbxContent><w:p><w:r><w:t>VML box</w:t></w:r></w:p></w:txbxContent>' +
    '</v:textbox></v:shape></w:pict></w:r><w:r><w:t>First</w:t></w:r>';
  const { alice, bob, sync, converged, pause, resume } = await pair(vml);
  const copies = [alice, bob].map((editor) => {
    const shape = editor.surface!.layout().pages[0]!.anchoredDrawings![0]!;
    expect(editor.surface!.selectDrawing(shape.drawingNodeId, shape.anchorParagraphId)).toBe(true);
    return editor.surface!.copyFlavours();
  });
  pause();
  pasteAt(alice, 1, copies[0]!);
  pasteAt(bob, 1, copies[1]!);
  sync();
  resume();
  converged();
  for (const editor of [alice, bob]) expect(editor.findMatches('VML box')).toHaveLength(3);
  const xml = strFromU8(unzipSync(new Uint8Array(await alice.save()))['word/document.xml']!);
  const spids = [...xml.matchAll(/o:spid="(_x0000_s\d+)"/g)].map((match) => match[1]);
  expect(spids).toHaveLength(3);
  expect(new Set(spids).size).toBe(3);
});
