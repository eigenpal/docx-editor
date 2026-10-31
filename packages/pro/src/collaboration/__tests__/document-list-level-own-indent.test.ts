/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A level change on a list item with its own indent drops that indent, so the item takes its
// new level's. The drop is part of the same `setListLevel` write, so two collaborating editors
// must converge on it through concurrent typing, deletion, indent writes, undo, redo,
// suggesting mode, reconnect, and save and reopen.
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
  level(2, '▪') +
  '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
/** The item's own indent, between level 0's and level 1's. */
const OWN = '<w:ind w:left="1080" w:hanging="360"/>';
const item = (text: string, ilvl: number, ind = '') =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr>${ind}</w:pPr>` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const fixture = zipDocument(item('Alpha', 0) + item('Bravo', 1, OWN) + item('Charlie', 1, OWN), {
  overrides:
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
  documentRels:
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    '</Relationships>',
  extraXml: { 'word/numbering.xml': NUMBERING },
});

async function peer(name: string, host?: { ydoc: Y.Doc }, bytes: Uint8Array = fixture) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'list-level-own-indent',
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

/** Each list item's level and the x of its marker, in reading order. */
const items = (peer: Peer) =>
  peer.editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments)
    .filter((fragment) => fragment.kind === 'paragraph')
    .map((fragment) => [fragment.marker?.level ?? null, fragment.marker?.box.x ?? null]);

/** The paragraphs' own `w:ind` elements, revision records excluded. */
const ownIndents = (xml: string) =>
  [...xml.replace(/<w:pPrChange\b.*?<\/w:pPrChange>/g, '').matchAll(/<w:ind [^>]*\/>/g)].map(
    (match) => match[0]
  );

test('a level change drops the own indent and converges through typing, undo, redo and reconnect', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  const start = items(a);

  caret(a, 1, 2);
  caret(b, 1, 5);
  expect(a.editor.surface!.adjustIndent('increase')).toBe(true);
  expect(b.editor.exec({ type: 'insertText', text: '!' }).ok).toBe(true);
  sync(a, b);
  const after = await converged(a, b);
  expect(after).toContain('Bravo!');
  expect(ownIndents(after)).toHaveLength(1);
  expect(items(a)).toEqual(items(b));
  expect(items(b)[1]![0]).toBe(2);
  expect(items(b)[1]![1]).toBeGreaterThan(start[2]![1]!);

  expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(a, b);
  const undone = await converged(a, b);
  expect(undone).toContain('Bravo!');
  expect(ownIndents(undone)).toHaveLength(2);
  expect(items(b)).toEqual(start);

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
  expect(items(reconnected)).toEqual(items(a));

  const reopened = await peer('Carol', undefined, new Uint8Array(await a.editor.save()));
  expect(items(reopened)).toEqual(items(a));
});

test('a level change while the other participant deletes the item converges', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);

  caret(a, 1, 0);
  expect(a.editor.surface!.adjustIndent('increase')).toBe(true);
  const surface = b.editor.surface!;
  const [, bravo, charlie] = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: bravo!, offset: 0 },
    head: { paragraphId: charlie!, offset: 0 },
  });
  expect(surface.deleteSelection()).toBe(true);
  sync(a, b);
  const after = await converged(a, b);
  expect(after).not.toContain('Bravo');
  expect(after).toContain('Charlie');
  expect(items(a)).toEqual(items(b));
});

test('a level change and a concurrent right indent on the same item converge', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);

  caret(a, 2, 1);
  caret(b, 2, 3);
  expect(a.editor.surface!.adjustIndent('decrease')).toBe(true);
  expect(b.editor.surface!.setIndent({ right: 600 })).toBe(true);
  sync(a, b);
  const after = await converged(a, b);
  expect(after).toContain('Charlie');
  expect(items(a)).toEqual(items(b));
});

test('a suggested level change converges, and rejecting it restores the own indent', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  const start = items(a);

  a.editor.surface!.setEditingMode('suggest');
  caret(a, 1, 1);
  expect(a.editor.surface!.adjustIndent('increase')).toBe(true);
  sync(a, b);
  const after = await converged(a, b);
  expect(after).toContain('<w:pPrChange');
  expect(ownIndents(after)).toHaveLength(1);
  expect(items(b)[1]![0]).toBe(2);

  b.editor.surface!.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
  sync(a, b);
  const rejected = await converged(a, b);
  expect(rejected).not.toContain('<w:pPrChange');
  expect(ownIndents(rejected)).toHaveLength(2);
  expect(items(a)).toEqual(start);
});
