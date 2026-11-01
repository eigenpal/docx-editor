/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Text inside a w:bdo override lays out in the declared direction. The direction is layout
// only: edits inside the wrapper are ordinary text writes. Two collaborating editors must
// converge on them through concurrent typing and deletion, undo, redo, reconnect, and save and
// reopen, and both must lay the converged text out in the same visual order.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { caretAt, linesOf } from '@docx-editor.dev/core/layout';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { zipDocument } from './document-peer-support.ts';

const fixture = zipDocument(
  '<w:p><w:r><w:t xml:space="preserve">x </w:t></w:r>' +
    '<w:bdo w:val="rtl"><w:r><w:t>abcdef</w:t></w:r></w:bdo>' +
    '<w:r><w:t xml:space="preserve"> y</w:t></w:r></w:p>'
);

async function peer(name: string, host?: { ydoc: Y.Doc }, bytes: Uint8Array = fixture) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'bidi-wrapper-direction',
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
  return { ydoc, awareness, room, editor, destroy };
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

async function mainXml(editor: DocxEditorInstance) {
  const loaded = readOoxmlPackage(new Uint8Array(await editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  return { fingerprint: canonicalOoxmlFingerprint(main), xml: serializeOoxmlPart(main) };
}

/** Painted text, left to right, and the caret x at every offset of the first paragraph. */
function geometry(editor: DocxEditorInstance) {
  const layout = editor.surface!.layout();
  const line = linesOf(layout)[0]!;
  const text = [...line.spans]
    .sort((left, right) => left.box.x - right.box.x)
    .map((span) =>
      span.style.shaping?.direction === 'rtl' ? [...span.text].reverse().join('') : span.text
    )
    .join('');
  const paragraphId = line.range.paragraphId;
  const length = line.spans.reduce((sum, span) => sum + span.text.length, 0);
  const carets = Array.from(
    { length: length + 1 },
    (_, offset) => caretAt(layout, { paragraphId, offset })?.x
  );
  return { text, carets };
}

async function converged(a: Peer, b: Peer) {
  const [left, right] = [await mainXml(a.editor), await mainXml(b.editor)];
  expect(left.fingerprint).toBe(right.fingerprint);
  expect(geometry(a.editor)).toEqual(geometry(b.editor));
  return left.xml;
}

function caret(peer: Peer, offset: number) {
  const surface = peer.editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

test('edits inside an override converge and keep the reversed order', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  expect(geometry(a.editor).text).toBe('x fedcba y');

  // Alice types inside the override while Bob deletes its last letter.
  caret(a, 3);
  caret(b, 8);
  expect(a.editor.exec({ type: 'insertText', text: 'Q' }).ok).toBe(true);
  b.editor.surface!.deleteBackward();
  sync(a, b);
  const after = await converged(a, b);
  expect(after).toContain('<w:bdo w:val="rtl">');
  expect(geometry(a.editor).text).toBe('x edcbQa y');

  expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(a, b);
  await converged(a, b);
  expect(geometry(b.editor).text).toBe('x edcba y');

  expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
  sync(a, b);
  expect(await converged(a, b)).toBe(after);

  // Bob reconnects from his own saved state.
  const saved = new Y.Doc();
  Y.applyUpdate(saved, Y.encodeStateAsUpdate(b.ydoc));
  b.destroy();
  opened.splice(opened.indexOf(b.destroy), 1);
  const reconnected = await peer('Bob', { ydoc: saved });
  saved.destroy();
  expect(await converged(a, reconnected)).toBe(after);

  // Save and reopen keeps the wrapper and its order.
  const reopened = await peer('Carol', undefined, new Uint8Array(await a.editor.save()));
  expect((await mainXml(reopened.editor)).xml).toContain('<w:bdo w:val="rtl">');
  expect(geometry(reopened.editor)).toEqual(geometry(a.editor));
});

test('a remote caret inside an override sits at the same painted place for both', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  caret(b, 4);
  applyAwarenessUpdate(
    a.awareness,
    encodeAwarenessUpdate(b.awareness, [b.awareness.clientID]),
    'relay'
  );
  const [remote] = a.room.session.remoteSelections();
  expect(remote).toMatchObject({ actorId: 'Bob', head: { offset: 4 } });
  const paragraphId = a.editor.surface!.session.paragraphIds()[0]!;
  const local = caretAt(b.editor.surface!.layout(), { paragraphId, offset: 4 })!.x;
  expect(caretAt(a.editor.surface!.layout(), { paragraphId, offset: 4 })!.x).toBe(local);
  // Offset 4 is between b and c; the override paints it right of c and left of b.
  const xs = geometry(a.editor).carets;
  expect(xs[4]!).toBeLessThan(xs[3]!);
  expect(xs[4]!).toBeGreaterThan(xs[5]!);
});

test('offline edits inside an override converge on reconnect', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  caret(a, 3);
  expect(a.editor.exec({ type: 'insertText', text: 'P' }).ok).toBe(true);
  caret(b, 7);
  expect(b.editor.exec({ type: 'insertText', text: 'R' }).ok).toBe(true);
  // Neither side has seen the other's edit until they sync.
  expect(geometry(a.editor).text).toBe('x fedcbPa y');
  expect(geometry(b.editor).text).toBe('x fRedcba y');
  sync(a, b);
  await converged(a, b);
  expect(geometry(a.editor).text).toBe('x fRedcbPa y');
});

test('a remote deletion of the whole override converges while the other side types in it', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  const surface = b.editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({ anchor: { paragraphId, offset: 2 }, head: { paragraphId, offset: 8 } });
  caret(a, 5);
  expect(a.editor.exec({ type: 'insertText', text: 'Z' }).ok).toBe(true);
  surface.deleteBackward();
  sync(a, b);
  const after = await converged(a, b);
  expect(after).toContain('x ');
  expect(after).toContain(' y');
  expect(after).not.toContain('abc');
  // The concurrent letter survives in the place it was typed, between x and y.
  expect(geometry(a.editor).text.replace(/ /g, '')).toBe('xZy');
});
