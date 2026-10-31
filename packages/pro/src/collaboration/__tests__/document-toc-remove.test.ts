/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Removing a table of contents is one structural write: the field, or the control around it
// with its heading, leaves the tree. Two collaborating editors must converge on it through
// concurrent typing beside it, undo, redo, reconnect, save and reopen, a concurrent removal,
// a refresh by the other participant, and an edit inside the control's heading.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  canonicalOoxmlFingerprint,
  detectBodyTocs,
  readOoxmlPackage,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { zipDocument } from './document-peer-support.ts';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (inner: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${inner}</w:p>`;
const BEGIN =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-1" \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const fixture = zipDocument(
  para(run('Before')) +
    '<w:sdt><w:sdtPr><w:id w:val="7"/><w:docPartObj><w:docPartGallery w:val="Table of Contents"/>' +
    '<w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>' +
    para(run('Contents'), 'TOCHeading') +
    para(BEGIN + run('Alpha 1'), 'TOC1') +
    para(END) +
    '</w:sdtContent></w:sdt>' +
    para(run('Alpha'), 'Heading1') +
    para(run('Body words'))
);

async function peer(name: string, host?: { ydoc: Y.Doc }, bytes: Uint8Array = fixture) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'toc-remove',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: bytes },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    modules: [collaborationModule({ session: room.session })],
    author: name,
  });
  const destroy = () => {
    editor.destroy();
    container.remove();
    room.destroy();
    awareness.destroy();
    ydoc.destroy();
  };
  opened.push(destroy);
  return { ydoc, editor, destroy };
}
type Peer = Awaited<ReturnType<typeof peer>>;

const opened: (() => void)[] = [];
afterEach(() => {
  for (const destroy of opened.splice(0)) destroy();
});

function sync(a: Peer, b: Peer) {
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)), 'relay');
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc)), 'relay');
}

async function converged(a: Peer, b: Peer): Promise<string> {
  const xml = async (peer: Peer) => {
    const loaded = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
    if (!loaded.ok) throw new Error(loaded.reason);
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    return { fingerprint: canonicalOoxmlFingerprint(main), xml: serializeOoxmlPart(main) };
  };
  const [left, right] = [await xml(a), await xml(b)];
  expect(left.fingerprint).toBe(right.fingerprint);
  return left.xml;
}

function caret(peer: Peer, text: string, offset: number) {
  const surface = peer.editor.surface!;
  const index = surface.session.bodyText().split('\n').indexOf(text);
  const point = { paragraphId: surface.session.paragraphIds()[index]!, offset };
  surface.setSelection({ anchor: point, head: point });
}

const tocs = (peer: Peer) => detectBodyTocs(peer.editor.surface!.session.part()).length;

test('a removed table of contents converges through typing, undo, redo and reconnect', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);

  caret(b, 'Body words', 4);
  expect(a.editor.exec({ type: 'removeToc' })).toEqual({ ok: true, changed: true });
  expect(b.editor.exec({ type: 'insertText', text: ' more' }).ok).toBe(true);
  sync(a, b);
  const after = await converged(a, b);
  expect(after).not.toContain('<w:sdt>');
  expect(after).not.toContain('fldChar');
  expect(after).toContain('Body more words');
  expect(tocs(a)).toBe(0);
  expect(tocs(b)).toBe(0);

  expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(a, b);
  const undone = await converged(a, b);
  expect(undone).toContain('<w:sdt>');
  expect(undone).toContain('Body more words');
  expect(tocs(b)).toBe(1);

  expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
  sync(a, b);
  expect(await converged(a, b)).toBe(after);

  // Bob disconnects and reconnects from his own saved state.
  const saved = new Y.Doc();
  Y.applyUpdate(saved, Y.encodeStateAsUpdate(b.ydoc));
  b.destroy();
  opened.splice(opened.indexOf(b.destroy), 1);
  const reconnected = await peer('Bob', { ydoc: saved });
  saved.destroy();
  expect(await converged(a, reconnected)).toBe(after);

  const reopened = await peer('Carol', undefined, new Uint8Array(await a.editor.save()));
  expect(await converged(a, reopened)).toBe(after);
  expect(tocs(reopened)).toBe(0);
});

test('two participants removing the same table of contents converge', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  expect(a.editor.exec({ type: 'removeToc' }).ok).toBe(true);
  expect(b.editor.exec({ type: 'removeToc' }).ok).toBe(true);
  sync(a, b);
  const after = await converged(a, b);
  expect(after).not.toContain('<w:sdt>');
  expect(b.editor.surface!.session.bodyText()).toBe('Before\nAlpha\nBody words');
});

test('a removal converges with a refresh and with an edit in the heading', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  caret(b, 'Contents', 8);
  expect(b.editor.exec({ type: 'insertText', text: ' page' }).ok).toBe(true);
  expect(a.editor.exec({ type: 'removeToc' }).ok).toBe(true);
  sync(a, b);
  // The removal takes the heading with it, as a deleted paragraph takes text typed into it.
  const edited = await converged(a, b);
  expect(edited).not.toContain('fldChar');
  expect(edited).not.toContain('<w:sdt>');
  expect(b.editor.surface!.session.bodyText()).toBe('Before\nAlpha\nBody words');

  const c = await peer('Carol');
  const d = await peer('Dan', c);
  expect(d.editor.exec({ type: 'refreshToc', mode: 'entire' }).ok).toBe(true);
  expect(c.editor.exec({ type: 'removeToc' }).ok).toBe(true);
  sync(c, d);
  const refreshed = await converged(c, d);
  expect(refreshed).not.toContain('fldChar');
  expect(tocs(c)).toBe(0);
  expect(tocs(d)).toBe(0);
  expect(d.editor.surface!.session.bodyText()).toBe('Before\nAlpha\nBody words');
});

test('a field cut out of ordinary paragraphs converges with typing on both sides', async () => {
  const inline = zipDocument(
    para(run('Before')) +
      para(run('Lead text') + BEGIN + run('Alpha 1'), 'Lead') +
      para(run('Beta 1') + END + run('trail text'), 'Trail') +
      para(run('After'))
  );
  const a = await peer('Alice', undefined, inline);
  const b = await peer('Bob', a);
  caret(b, 'Lead textAlpha 1', 4);
  expect(b.editor.exec({ type: 'insertText', text: '!' }).ok).toBe(true);
  expect(a.editor.exec({ type: 'removeToc' })).toEqual({ ok: true, changed: true });
  // The caret waits where the field was, between the two pieces of text.
  expect(a.editor.surface!.state().selection.head.offset).toBe('Lead text'.length);
  sync(a, b);
  const after = await converged(a, b);
  expect(after).not.toContain('fldChar');
  expect(a.editor.surface!.session.bodyText()).toBe('Before\nLead! texttrail text\nAfter');
  expect(after).toContain('<w:pStyle w:val="Lead"/>');

  caret(b, 'Lead! texttrail text', 15);
  expect(b.editor.exec({ type: 'insertText', text: '?' }).ok).toBe(true);
  sync(a, b);
  expect(a.editor.surface!.session.bodyText()).toBe('Before\nLead! texttrail? text\nAfter');

  expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(a, b);
  const undone = await converged(a, b);
  expect(undone).toContain('fldChar');
  expect(tocs(a)).toBe(1);
  expect(tocs(b)).toBe(1);
  expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
  sync(a, b);
  await converged(a, b);
  expect(tocs(b)).toBe(0);
});
