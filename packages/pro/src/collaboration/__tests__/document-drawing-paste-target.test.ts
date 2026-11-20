/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A paste while a drawing is selected, between collaborating editors. Text pasted while a text
// box is selected replaces its text, as a tracked replacement in suggesting mode; text and a
// copied drawing pasted while a line is selected go in before its anchor run. Each replicates,
// converges, undoes, redoes, survives save and reopen, and converges when the other participant
// deletes the drawing or its paragraph, or types in the box, meanwhile.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('drawing-paste-target-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const EMU = 12_700;
/** A floating line anchored in the first paragraph, drawn lower on the page. */
const LINE =
  '<w:r><w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
  '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="2" ' +
  'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
  `<wp:positionV relativeFrom="margin"><wp:posOffset>${200 * EMU}</wp:posOffset></wp:positionV>` +
  `<wp:extent cx="${200 * EMU}" cy="0"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
  '<wp:docPr id="2" name="Rule"/><wp:cNvGraphicFramePr/><a:graphic>' +
  '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
  `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${200 * EMU}" cy="0"/>` +
  '</a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom></wps:spPr><wps:bodyPr/></wps:wsp>' +
  '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';

function mounted(peer: Awaited<ReturnType<typeof harness.pair>>['alice'], author: string): Editor {
  peer.detach();
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: peer.room.document,
    author,
    imageDecodePort: {
      decode: async () => ({ pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 }),
    },
    modules: [collaborationModule({ session: peer.room.session })],
  });
  editors.push(editor);
  return editor;
}

async function pair(first = '<w:r><w:t>First</w:t></w:r>') {
  const peers = await harness.pair(
    zipDocument(`<w:p>${first}</w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>`)
  );
  const alice = mounted(peers.alice, 'Alice');
  const bob = mounted(peers.bob, 'Bob');
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

/** Insert a text box holding `text` in the first paragraph. */
function insertBox(editor: Editor, text: string): void {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 0 } });
  expect(editor.exec({ type: 'insertTextBox' }).ok).toBe(true);
  expect(editor.exec({ type: 'insertText', text }).ok).toBe(true);
  surface.setActiveScope({ kind: 'body' });
}

/** Select the text box that holds `text`, as a press on its frame does. */
function selectBox(editor: Editor, text: string): void {
  const scope = editor.findMatches(text)[0]!.scope!;
  if (scope.kind !== 'frame') throw new Error('no text box holds the text');
  expect(editor.surface!.selectDrawing(scope.drawingNodeId, scope.hostParagraphId)).toBe(true);
}

/** Select the line anchored in the first paragraph. */
function selectLine(editor: Editor): void {
  const line = editor.surface!.layout().pages[0]!.anchoredDrawings![0]!;
  expect(editor.surface!.selectDrawing(line.drawingNodeId, line.anchorParagraphId)).toBe(true);
}

/** The saved main document part. */
async function documentXml(editor: Editor): Promise<string> {
  return strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
}

/** How many times `text` occurs after a save and a reopen. */
async function reopened(editor: Editor, text: string): Promise<number> {
  const copy = createDocxEditor({
    container: document.createElement('div'),
    document: new Uint8Array(await editor.save()),
  });
  editors.push(copy);
  return copy.findMatches(text).length;
}

test('text pasted into a selected text box replicates, undoes, redoes and reopens', async () => {
  const { alice, bob, converged } = await pair();
  insertBox(alice, 'Old box text');
  converged();
  selectBox(alice, 'Old box text');
  expect(alice.exec({ type: 'paste', text: 'Pasted box text' })).toMatchObject({ ok: true });
  converged();
  for (const editor of [alice, bob]) {
    expect(editor.findMatches('Pasted box text')[0]?.scope?.kind).toBe('frame');
    expect(editor.findMatches('Old box text')).toHaveLength(0);
  }
  expect(await reopened(bob, 'Pasted box text')).toBe(1);

  expect(alice.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
  converged();
  expect(bob.findMatches('Old box text')).toHaveLength(1);
  expect(bob.findMatches('Pasted box text')).toHaveLength(0);
  expect(alice.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
  converged();
  expect(bob.findMatches('Pasted box text')).toHaveLength(1);
});

test('text pasted while a line is selected lands before its anchor run everywhere', async () => {
  const { alice, bob, converged } = await pair(
    `<w:r><w:t xml:space="preserve">Head </w:t></w:r>${LINE}<w:r><w:t>Tail</w:t></w:r>`
  );
  converged();
  selectLine(alice);
  expect(alice.exec({ type: 'paste', text: 'ZULU' })).toMatchObject({ ok: true });
  converged();
  for (const editor of [alice, bob]) {
    const id = editor.surface!.session.paragraphIds()[0]!;
    expect(editor.findMatches('Head ZULU')).toHaveLength(1);
    expect(editor.surface!.layout().pages[0]!.anchoredDrawings![0]!.anchorParagraphId).toBe(id);
  }
  expect(await reopened(alice, 'Head ZULU')).toBe(1);
  expect(alice.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
  converged();
  expect(bob.findMatches('ZULU')).toHaveLength(0);
});

test('a paste into a text box that the other participant deletes converges', async () => {
  const { alice, bob, sync, converged, pause, resume } = await pair();
  insertBox(alice, 'Doomed box');
  converged();
  pause();
  selectBox(alice, 'Doomed box');
  expect(alice.exec({ type: 'paste', text: 'Late paste' })).toMatchObject({ ok: true });
  selectBox(bob, 'Doomed box');
  expect(bob.exec({ type: 'deleteImage' }).ok).toBe(true);
  sync();
  resume();
  converged();
  // The paste went into the deleted box's story, so it goes with the box: it never moves to the
  // body text, and the anchor paragraph keeps its text.
  for (const editor of [alice, bob]) {
    expect(editor.findMatches('Doomed box')).toHaveLength(0);
    expect(editor.findMatches('Late paste')).toHaveLength(0);
    expect(editor.findMatches('First')).toHaveLength(1);
    expect(await documentXml(editor)).not.toContain('<w:drawing');
  }
  expect(await reopened(alice, 'Late paste')).toBe(0);
});

test('a paste into a text box while the other participant types in it converges', async () => {
  const { alice, bob, sync, converged, pause, resume } = await pair();
  insertBox(alice, 'Shared box');
  converged();
  expect(bob.surface!.setActiveScope(bob.findMatches('Shared box')[0]!.scope!)).toBe(true);
  pause();
  selectBox(alice, 'Shared box');
  expect(alice.exec({ type: 'paste', text: 'Replaced' })).toMatchObject({ ok: true });
  expect(bob.exec({ type: 'insertText', text: 'Typed ' }).ok).toBe(true);
  sync();
  resume();
  converged();
  // Bob's typing survives in the same box as Alice's replacement; the old text is gone.
  for (const editor of [alice, bob]) {
    const [replaced] = editor.findMatches('Replaced');
    const typed = editor.findMatches('Typed ');
    expect(replaced?.scope?.kind).toBe('frame');
    expect(typed).toHaveLength(1);
    expect(typed[0]!.scope).toEqual(replaced!.scope);
    expect(editor.findMatches('Shared box')).toHaveLength(0);
  }
});

test('a paste at an anchor whose paragraph the other participant deletes converges', async () => {
  const { alice, bob, sync, converged, pause, resume } = await pair(
    `<w:r><w:t xml:space="preserve">Head </w:t></w:r>${LINE}<w:r><w:t>Tail</w:t></w:r>`
  );
  converged();
  pause();
  selectLine(alice);
  expect(alice.exec({ type: 'paste', text: 'ZULU' })).toMatchObject({ ok: true });
  // Bob removes the anchor paragraph with the line in it.
  const surface = bob.surface!;
  const [first, second] = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: first!, offset: 0 },
    head: { paragraphId: second!, offset: 0 },
  });
  expect(bob.exec({ type: 'deleteText' }).ok).toBe(true);
  sync();
  resume();
  converged();
  // The pasted text is a concurrent insertion, so it survives the deletion of the text around
  // it and joins the paragraph that remains, the same way on both peers.
  for (const editor of [alice, bob]) {
    const paragraphs = editor
      .surface!.session.paragraphIds()
      .map((id) => editor.getParagraphText(id)?.text);
    expect(paragraphs).toEqual(['SecondZULU']);
    expect(editor.findMatches('Head')).toHaveLength(0);
  }
  expect(await reopened(bob, 'ZULU')).toBe(1);
});

test('a picture inserted while a line is selected lands before the line everywhere', async () => {
  const { alice, bob, converged } = await pair(
    `<w:r><w:t xml:space="preserve">Head </w:t></w:r>${LINE}<w:r><w:t>Tail</w:t></w:r>`
  );
  converged();
  selectLine(alice);
  const png = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    ),
    (char) => char.charCodeAt(0)
  );
  const result = await alice.executeImageCommand({
    type: 'insertImage',
    data: png,
    mime: 'image/png',
    widthPoints: 12,
    heightPoints: 12,
  });
  expect(result).toMatchObject({ ok: true, changed: true });
  converged();
  for (const editor of [alice, bob]) {
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    const first = xml.slice(0, xml.indexOf('</w:p>'));
    // The picture comes first in the anchor paragraph, the line after it.
    expect(first.indexOf('<pic:pic')).toBeGreaterThan(-1);
    expect(first.indexOf('<pic:pic')).toBeLessThan(first.indexOf('name="Rule"'));
  }
  expect(alice.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
  converged();
  const xml = strFromU8(unzipSync(new Uint8Array(await bob.save()))['word/document.xml']!);
  expect(xml).not.toContain('<pic:pic');
});

test('a suggesting-mode paste into a text box replicates as a tracked replacement', async () => {
  const { alice, bob, converged } = await pair();
  insertBox(alice, 'Old box text');
  converged();
  alice.surface!.setEditingMode('suggest');
  selectBox(alice, 'Old box text');
  expect(alice.exec({ type: 'paste', text: 'Proposed text' })).toMatchObject({ ok: true });
  converged();
  for (const editor of [alice, bob]) {
    const xml = await documentXml(editor);
    const box = xml.slice(xml.indexOf('<w:txbxContent'), xml.indexOf('</w:txbxContent>'));
    expect(box).toMatch(/<w:ins [^>]*w:author="Alice"[^>]*>(?:(?!<\/w:ins>).)*Proposed text/s);
    expect(box).toMatch(/<w:del [^>]*w:author="Alice"[^>]*>(?:(?!<\/w:del>).)*Old box text/s);
  }
  expect(await reopened(bob, 'Proposed text')).toBe(1);
  expect(alice.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
  converged();
  const xml = await documentXml(bob);
  expect(xml).not.toContain('Proposed text');
  expect(xml).not.toContain('<w:del ');
  expect(bob.findMatches('Old box text')).toHaveLength(1);
});

test('a copied drawing pasted on a selected line lands before the line everywhere', async () => {
  const { alice, bob, converged } = await pair(
    `<w:r><w:t xml:space="preserve">Head </w:t></w:r>${LINE}<w:r><w:t>Tail</w:t></w:r>`
  );
  converged();
  selectLine(alice);
  const copied = alice.surface!.copyFlavours();
  selectLine(alice);
  expect(alice.surface!.pasteRich(copied.text, copied.html)).toBe(true);
  converged();
  for (const editor of [alice, bob]) {
    const xml = await documentXml(editor);
    const first = xml.slice(0, xml.indexOf('</w:p>'));
    // Head, the copy, the selected line, Tail: both drawings stay in the anchor paragraph.
    expect(first.match(/<w:drawing[\s>]/g)).toHaveLength(2);
    expect(first.indexOf('Head')).toBeLessThan(first.indexOf('<w:drawing'));
    expect(first.lastIndexOf('</w:drawing>')).toBeLessThan(first.indexOf('Tail'));
    const ids = [...first.matchAll(/<wp:docPr [^>]*id="(\d+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(2);
  }
  expect(alice.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
  converged();
  const xml = await documentXml(bob);
  expect(xml.slice(0, xml.indexOf('</w:p>')).match(/<w:drawing[\s>]/g)).toHaveLength(1);
});
