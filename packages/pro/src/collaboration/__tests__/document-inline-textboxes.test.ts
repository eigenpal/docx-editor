/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('inline-textbox-editor-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** An inline text box in an `mc:AlternateContent` run, as Word writes one. */
function inlineTextboxRun(text: string): string {
  return (
    `<w:r><mc:AlternateContent xmlns:mc="${MC}" xmlns:wps="${WPS}"><mc:Choice Requires="wps">` +
    `<w:drawing xmlns:wp="${WP}" xmlns:a="${A}">` +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="1828800" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:docPr id="7" name="Inline text box 7"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvSpPr txBox="1"/>` +
    '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="457200"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent>` +
    '</wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>' +
    '</mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r>'
  );
}

async function pair() {
  const peers = await harness.pair(
    zipDocument(
      '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
        `<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>${inlineTextboxRun('Shared')}` +
        '<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Tail</w:t></w:r></w:p><w:sectPr/>'
    )
  );
  const mounted = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  });
  const [alice, bob] = mounted as [Editor, Editor];
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
  return { alice, bob, sync, converged, pause: peers.pause, resume: peers.resume };
}

/** Enter the inline box and put the caret at the end of its story. */
function enterBox(editor: Editor, text: string): void {
  const match = editor.findMatches(text)[0]!;
  expect(match.scope?.kind).toBe('frame');
  expect(editor.surface!.setActiveScope(match.scope!)).toBe(true);
  const end = { paragraphId: match.blockId, offset: match.start + match.length };
  editor.surface!.setSelection({ anchor: end, head: end });
}

test('typing in an inline box replicates, converges, and survives save and reopen', async () => {
  const { alice, bob, converged } = await pair();
  enterBox(alice, 'Shared');
  expect(alice.exec({ type: 'insertText', text: ' story' }).ok).toBe(true);
  converged();
  const match = bob.findMatches('Shared story')[0];
  expect(match?.scope?.kind).toBe('frame');
  expect(bob.findMatches('before')).toHaveLength(1);
  const reopened = createDocxEditor({
    container: document.createElement('div'),
    document: new Uint8Array(await bob.save()),
  });
  editors.push(reopened);
  expect(reopened.findMatches('Shared story')[0]?.scope?.kind).toBe('frame');
});

test('concurrent typing in one inline box keeps both edits', async () => {
  const { alice, bob, sync, converged, pause, resume } = await pair();
  enterBox(alice, 'Shared');
  enterBox(bob, 'Shared');
  pause();
  expect(alice.exec({ type: 'insertText', text: ' Alice' }).ok).toBe(true);
  expect(bob.exec({ type: 'insertText', text: ' Bob' }).ok).toBe(true);
  sync();
  resume();
  converged();
  for (const editor of [alice, bob]) {
    expect(editor.findMatches('Alice')[0]?.scope?.kind).toBe('frame');
    expect(editor.findMatches('Bob')[0]?.scope?.kind).toBe('frame');
  }
});

test('undo and redo of inline box typing replicate', async () => {
  const { alice, bob, converged } = await pair();
  enterBox(alice, 'Shared');
  expect(alice.exec({ type: 'insertText', text: ' undone' }).ok).toBe(true);
  converged();
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(bob.findMatches('undone')).toHaveLength(0);
  expect(bob.findMatches('Shared')).toHaveLength(1);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  expect(bob.findMatches('Shared undone')[0]?.scope?.kind).toBe('frame');
});

test('deleting the host paragraph while a peer types in the box converges', async () => {
  const { alice, bob, sync, converged, pause, resume } = await pair();
  enterBox(bob, 'Shared');
  const host = alice.findMatches('before')[0]!.blockId;
  const tail = alice.findMatches('Tail')[0]!.blockId;
  pause();
  expect(bob.exec({ type: 'insertText', text: ' typed' }).ok).toBe(true);
  alice.surface!.setSelection({
    anchor: { paragraphId: host, offset: 0 },
    head: { paragraphId: tail, offset: 0 },
  });
  alice.surface!.deleteBackward();
  expect(alice.findMatches('Shared')).toHaveLength(0);
  sync();
  resume();
  converged();
  for (const editor of [alice, bob]) {
    expect(editor.findMatches('before')).toHaveLength(0);
    expect(editor.findMatches('Tail')).toHaveLength(1);
  }
  // The deletion removes the box with its story, so the typing inside it goes too, and the
  // peer that was typing leaves the story that no longer exists.
  for (const editor of [alice, bob]) {
    expect(editor.findMatches('Shared')).toHaveLength(0);
    expect(editor.findMatches('typed')).toHaveLength(0);
  }
  expect(bob.surface!.activeScope().kind).toBe('body');
  expect(bob.exec({ type: 'insertText', text: 'Still editable' }).ok).toBe(true);
  converged();
  expect(alice.findMatches('Still editable')).toHaveLength(1);
});
