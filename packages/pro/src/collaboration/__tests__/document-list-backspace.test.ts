/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Backspace at the start of a list item removes its number and keeps the text on its own line.
// It is an ordinary numbering write, so two collaborating editors must converge on it through
// concurrent typing, a remote deletion in the item, a concurrent press on the same item,
// undo, redo, reconnect, and save and reopen. A suggested list toggle is the same write as a
// tracked property change, which the other participant can reject or accept. Backspace at the
// start of an indented paragraph removes the indent the same way, as an ordinary paragraph
// property write.
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
const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
  '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
const item = (text: string) =>
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const fixture = zipDocument(item('One') + item('Two words') + item('Three'), {
  overrides:
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
  documentRels:
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>',
  extraXml: { 'word/numbering.xml': NUMBERING },
});

async function peer(name: string, host?: { ydoc: Y.Doc }, bytes: Uint8Array = fixture) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'list-backspace',
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

function caret(peer: Peer, index: number, offset: number) {
  const surface = peer.editor.surface!;
  const point = { paragraphId: surface.session.paragraphIds()[index]!, offset };
  surface.setSelection({ anchor: point, head: point });
}

const markers = (peer: Peer) =>
  peer.editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments)
    .filter((fragment) => fragment.kind === 'paragraph')
    .map((fragment) => fragment.marker?.text ?? null);
/** Items numbered now; a `w:pPrChange` record holds the prior numbering and is not counted. */
const numbered = (xml: string) =>
  (xml.replace(/<w:pPrChange\b.*?<\/w:pPrChange>/g, '').match(/<w:numPr>/g) ?? []).length;

test('a removed number converges through typing, undo, redo and reconnect', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);

  caret(a, 1, 0);
  caret(b, 2, 5);
  a.editor.surface!.deleteBackward();
  expect(b.editor.exec({ type: 'insertText', text: ' more' }).ok).toBe(true);
  sync(a, b);
  const after = await converged(a, b);
  expect(after).toContain('Two words');
  expect(after).toContain('Three more');
  expect(numbered(after)).toBe(2);
  expect(markers(a)).toEqual(['1.', null, '2.']);
  expect(markers(b)).toEqual(['1.', null, '2.']);

  expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(a, b);
  const undone = await converged(a, b);
  expect(numbered(undone)).toBe(3);
  expect(undone).toContain('Three more');

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
  expect(markers(reconnected)).toEqual(['1.', null, '2.']);
});

test('a removed number converges with a remote deletion in the same item', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);

  caret(a, 1, 0);
  const surface = b.editor.surface!;
  const id = surface.session.paragraphIds()[1]!;
  surface.setSelection({
    anchor: { paragraphId: id, offset: 3 },
    head: { paragraphId: id, offset: 9 },
  });
  a.editor.surface!.deleteBackward();
  b.editor.surface!.deleteBackward();
  sync(a, b);
  const after = await converged(a, b);
  expect(after).not.toContain('words');
  expect(numbered(after)).toBe(2);

  // Save and reopen keeps the item out of the list.
  const reopened = await peer('Carol', undefined, new Uint8Array(await a.editor.save()));
  expect(markers(reopened)).toEqual(['1.', null, '2.']);
});

test('two participants pressing Backspace on the same item converge without a join', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);

  caret(a, 1, 0);
  caret(b, 1, 0);
  a.editor.surface!.deleteBackward();
  b.editor.surface!.deleteBackward();
  sync(a, b);
  const after = await converged(a, b);
  expect(after).toContain('>One<');
  expect(after).toContain('Two words');
  expect(numbered(after)).toBe(2);
});

test('a suggested number removal converges, and the other participant can reject it', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);

  a.editor.surface!.setEditingMode('suggest');
  caret(a, 1, 0);
  caret(b, 2, 5);
  a.editor.surface!.deleteBackward();
  expect(b.editor.exec({ type: 'insertText', text: ' more' }).ok).toBe(true);
  sync(a, b);
  const suggested = await converged(a, b);
  expect(suggested).toContain('<w:pPrChange');
  expect(numbered(suggested)).toBe(2);

  b.editor.surface!.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
  sync(a, b);
  const rejected = await converged(a, b);
  expect(rejected).not.toContain('<w:pPrChange');
  expect(numbered(rejected)).toBe(3);
  expect(rejected).toContain('Three more');

  const reopened = await peer('Carol', undefined, new Uint8Array(await a.editor.save()));
  expect(markers(reopened)).toEqual(['1.', '2.', '3.']);
});

test('suggested list toggles converge, and the other participant can reject or accept them', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);

  a.editor.surface!.setEditingMode('suggest');
  caret(a, 0, 1);
  caret(b, 0, 3);
  expect(a.editor.surface!.toggleList('bullet')).toBe(true);
  expect(b.editor.exec({ type: 'insertText', text: ' more' }).ok).toBe(true);
  sync(a, b);
  const switched = await converged(a, b);
  expect(switched.match(/<w:pPrChange/g)).toHaveLength(1);
  expect(markers(b)).toEqual(markers(a));
  expect(markers(b)[0]).toBe('•');

  b.editor.surface!.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
  sync(a, b);
  const rejected = await converged(a, b);
  expect(rejected).not.toContain('<w:pPrChange');
  expect(rejected).toContain('One more');
  expect(markers(a)).toEqual(['1.', '2.', '3.']);

  // Turning the list off on the last item is a suggestion too, and accept keeps it off.
  caret(a, 2, 0);
  expect(a.editor.surface!.toggleList('ordered')).toBe(true);
  sync(a, b);
  expect(markers(b)).toEqual(['1.', '2.', null]);
  b.editor.surface!.session.applyTreeOps([{ op: 'acceptAllRevisions' }]);
  sync(a, b);
  const accepted = await converged(a, b);
  expect(accepted).not.toContain('<w:pPrChange');
  expect(numbered(accepted)).toBe(2);

  const reopened = await peer('Carol', undefined, new Uint8Array(await a.editor.save()));
  expect(markers(reopened)).toEqual(['1.', '2.', null]);
});

const INDENTED = zipDocument(
  '<w:p><w:r><w:t>Intro</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:ind w:left="1440" w:right="720"/></w:pPr>' +
    '<w:r><w:t xml:space="preserve">Indented words</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Tail</w:t></w:r></w:p>'
);
const indentOf = (xml: string) =>
  /<w:p\b[^>]*>(?:<w:pPr>(.*?)<\/w:pPr>)?<w:r><w:t[^>]*>Indented/.exec(xml)?.[1] ?? '';

test('a removed indent converges through typing, undo, redo, a later join and reopen', async () => {
  const a = await peer('Alice', undefined, INDENTED);
  const b = await peer('Bob', a);

  caret(a, 1, 0);
  caret(b, 1, 8);
  a.editor.surface!.deleteBackward();
  expect(b.editor.exec({ type: 'insertText', text: ' more' }).ok).toBe(true);
  sync(a, b);
  const after = await converged(a, b);
  expect(indentOf(after)).toBe('<w:ind w:right="720"/>');
  expect(after).toContain('Indented more words');

  expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(a, b);
  const undone = await converged(a, b);
  expect(indentOf(undone)).toBe('<w:ind w:left="1440" w:right="720"/>');
  expect(undone).toContain('Indented more words');
  expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
  sync(a, b);
  expect(await converged(a, b)).toBe(after);

  // With the indent gone, the next press joins, while Bob deletes in the same paragraph.
  caret(a, 1, 0);
  caret(b, 1, 0);
  b.editor.surface!.setSelection({
    anchor: { paragraphId: b.editor.surface!.session.paragraphIds()[1]!, offset: 9 },
    head: { paragraphId: b.editor.surface!.session.paragraphIds()[1]!, offset: 14 },
  });
  b.editor.surface!.deleteSelection();
  a.editor.surface!.deleteBackward();
  sync(a, b);
  const joined = await converged(a, b);
  expect(joined.replaceAll('</w:t></w:r><w:r><w:t>', '')).toContain(
    '<w:t>IntroIndented words</w:t>'
  );

  const reopened = await peer('Carol', undefined, new Uint8Array(await a.editor.save()));
  expect(await converged(a, reopened)).toBe(joined);
});

test('a removed indent converges with a peer deleting that paragraph', async () => {
  const a = await peer('Alice', undefined, INDENTED);
  const b = await peer('Bob', a);

  caret(a, 1, 0);
  const ids = b.editor.surface!.session.paragraphIds();
  b.editor.surface!.setSelection({
    anchor: { paragraphId: ids[0]!, offset: 5 },
    head: { paragraphId: ids[2]!, offset: 0 },
  });
  b.editor.surface!.deleteSelection();
  a.editor.surface!.deleteBackward();
  sync(a, b);
  const settled = await converged(a, b);
  expect(settled).not.toContain('Indented');
  expect(settled.replaceAll('</w:t></w:r><w:r><w:t>', '')).toContain('<w:t>IntroTail</w:t>');

  expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(a, b);
  expect(await converged(a, b)).not.toContain('Indented');
});

test('a suggested indent removal converges, and the other participant can reject it', async () => {
  const a = await peer('Alice', undefined, INDENTED);
  const b = await peer('Bob', a);

  a.editor.surface!.setEditingMode('suggest');
  caret(a, 1, 0);
  a.editor.surface!.deleteBackward();
  sync(a, b);
  const suggested = await converged(a, b);
  expect(indentOf(suggested)).toMatch(/^<w:ind w:right="720"\/><w:pPrChange /);

  b.editor.surface!.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
  sync(a, b);
  expect(indentOf(await converged(a, b))).toBe('<w:ind w:left="1440" w:right="720"/>');
});
