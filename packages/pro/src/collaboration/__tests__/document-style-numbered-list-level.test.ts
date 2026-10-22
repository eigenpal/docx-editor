/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A list item numbered through its paragraph style gets its own `w:numPr` when its level moves,
// and a `w:numId="0"` override when it leaves the list. Both are ordinary `setListNumbering`
// writes, so two collaborating editors must converge on them through concurrent typing, undo,
// redo, reconnect, and save and reopen.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { zipDocument } from './document-peer-support.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const level = (ilvl: number, text: string) =>
  `<w:lvl w:ilvl="${ilvl}"><w:numFmt w:val="bullet"/><w:lvlText w:val="${text}"/>` +
  `<w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">` +
  level(0, '•') +
  level(1, 'o') +
  '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
const STYLES =
  `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="ListBullet">` +
  '<w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>' +
  '</w:style></w:styles>';
const item = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const fixture = zipDocument(item('Alpha') + item('Bravo') + item('Charlie'), {
  overrides:
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
  documentRels:
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    '<Relationship Id="rIdSty" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>',
  extraXml: { 'word/numbering.xml': NUMBERING, 'word/styles.xml': STYLES },
});

async function peer(name: string, host?: { ydoc: Y.Doc }, bytes: Uint8Array = fixture) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'style-numbered-list-level',
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

async function savedXml(peer: Peer) {
  const loaded = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  return { fingerprint: canonicalOoxmlFingerprint(main), xml: serializeOoxmlPart(main) };
}

async function converged(a: Peer, b: Peer): Promise<string> {
  const [left, right] = [await savedXml(a), await savedXml(b)];
  expect(left.fingerprint).toBe(right.fingerprint);
  return left.xml;
}

function caret(peer: Peer, paragraph: number, offset: number) {
  const surface = peer.editor.surface!;
  const paragraphId = surface.session.paragraphIds()[paragraph]!;
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

/** The marker level each paragraph is drawn with, or null when it is not a list item. */
const levels = (peer: Peer) =>
  peer.editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments)
    .filter((fragment) => fragment.kind === 'paragraph')
    .map((fragment) => fragment.marker?.level ?? null);

const numPrs = (xml: string) => [...xml.matchAll(/<w:numPr>.*?<\/w:numPr>/g)].map((m) => m[0]);

test('indenting a style-numbered item converges through typing, undo, redo and reconnect', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);

  caret(a, 1, 5);
  caret(b, 2, 0);
  expect(a.editor.surface!.adjustIndent('increase')).toBe(true);
  expect(b.editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
  sync(a, b);
  const after = await converged(a, b);
  expect(after).toContain('XCharlie');
  expect(numPrs(after)).toEqual(['<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>']);
  expect(levels(a)).toEqual([0, 1, 0]);
  expect(levels(b)).toEqual([0, 1, 0]);

  expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(a, b);
  const undone = await converged(a, b);
  expect(numPrs(undone)).toHaveLength(0);
  expect(levels(b)).toEqual([0, 0, 0]);

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
  expect(levels(reconnected)).toEqual([0, 1, 0]);
});

test('turning a style-numbered item off converges and stays off after save and reopen', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);

  caret(a, 1, 2);
  caret(b, 0, 5);
  expect(a.editor.surface!.toggleList('bullet')).toBe(true);
  expect(b.editor.exec({ type: 'insertText', text: '!' }).ok).toBe(true);
  sync(a, b);
  const after = await converged(a, b);
  expect(after).toContain('Alpha!');
  expect(numPrs(after)).toEqual(['<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>']);
  expect(levels(b)).toEqual([0, null, 0]);

  expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(a, b);
  expect(numPrs(await converged(a, b))).toHaveLength(0);
  expect(levels(b)).toEqual([0, 0, 0]);

  expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
  sync(a, b);
  expect(await converged(a, b)).toBe(after);

  const reopened = await peer('Carol', undefined, new Uint8Array(await a.editor.save()));
  expect(levels(reopened)).toEqual([0, null, 0]);
});

test('two participants indenting the same style-numbered item converge', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);

  caret(a, 1, 1);
  caret(b, 1, 3);
  expect(a.editor.surface!.adjustIndent('increase')).toBe(true);
  expect(b.editor.surface!.adjustIndent('increase')).toBe(true);
  sync(a, b);
  const after = await converged(a, b);
  expect(after).toContain('Bravo');
  expect(numPrs(after)).toHaveLength(1);
  expect(levels(a)).toEqual(levels(b));
  expect(levels(a)[1]).toBe(1);

  // Both wrote the same value, so either undo may find its write already replaced. Whatever
  // each one does, the participants agree and keep the text.
  a.editor.exec({ type: 'undo' });
  b.editor.exec({ type: 'undo' });
  sync(a, b);
  const undone = await converged(a, b);
  expect(undone).toContain('Bravo');
  expect(levels(a)).toEqual(levels(b));
});
