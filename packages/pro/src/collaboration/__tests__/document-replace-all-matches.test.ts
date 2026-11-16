/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `replaceAllMatches` between two editors in one shared room.
//
// The command commits one transaction per story through the surface's ordinary commit lane,
// all under one history group. Both peers must converge on every story, one undo must take
// back the body and the header together for every peer, a joining peer must reopen the same
// document, and concurrent edits in the replaced paragraphs must survive.

import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { zipDocument } from './document-peer-support.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HDR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';

const fixture = zipDocument(
  '<w:p><w:r><w:t>The supplier ships the goods to the supplier.</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Second paragraph names the supplier.</w:t></w:r></w:p>' +
    '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>',
  {
    overrides:
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rIdH" Type="${HDR}" Target="header1.xml"/></Relationships>`,
    extraXml: {
      'word/header1.xml': `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Supplier copy</w:t></w:r></w:p></w:hdr>`,
    },
  }
);

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'replace-all-matches',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: fixture },
    offlineEditing: true,
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    author: name,
    modules: [reviewModule(), collaborationModule({ session: room.session })],
  });
  return {
    ydoc,
    room,
    editor,
    close() {
      editor.destroy();
      container.remove();
      room.destroy();
      awareness.destroy();
      ydoc.destroy();
    },
  };
}
type Peer = Awaited<ReturnType<typeof peer>>;

function sync(a: Peer, b: Peer) {
  a.room.session.flushPendingJournals();
  b.room.session.flushPendingJournals();
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)), 'relay');
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc)), 'relay');
}

/** The body and header parts of a saved copy, fingerprinted. */
async function savedStories(peer: Peer) {
  const result = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
  if (!result.ok) throw new Error(result.reason);
  const { parts, mainDocumentPart } = result.package;
  return {
    body: canonicalOoxmlFingerprint(parts.get(mainDocumentPart)!),
    header: canonicalOoxmlFingerprint(parts.get('/word/header1.xml')!),
  };
}

async function converged(a: Peer, b: Peer) {
  expect(await savedStories(a)).toEqual(await savedStories(b));
}

const replaceAll = (peer: Peer, query: string, text: string) =>
  peer.editor.exec({ type: 'replaceAllMatches', query, text });

const matches = (peer: Peer, query: string) =>
  peer.editor.findMatches(query, { matchCase: true }).length;

test('a tracked replaceAllMatches synchronizes, undoes in one step, redoes, and reopens', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  let joined: Peer | undefined;
  try {
    const original = await savedStories(a);
    expect(a.editor.setEditingMode('suggesting').ok).toBe(true);
    expect(replaceAll(a, 'supplier', 'vendor')).toMatchObject({
      ok: true,
      changed: true,
      replacements: { replaced: 4, skipped: 0 },
    });
    sync(a, b);
    await converged(a, b);
    // Four tracked insertions on Bob's side too, one of them in the header.
    expect(matches(b, 'vendor')).toBe(4);
    expect(b.editor.getTrackedChanges().filter((change) => change.kind === 'insert')).toHaveLength(
      4
    );

    // One undo takes back the body and the header for every peer.
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(await savedStories(b)).toEqual(original);
    expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(matches(b, 'vendor')).toBe(4);

    joined = await peer('Carol', b);
    await converged(a, joined);
    expect(matches(joined, 'vendor')).toBe(4);
  } finally {
    joined?.close();
    b.close();
    a.close();
  }
});

test('concurrent typing in a replaced paragraph survives replaceAllMatches', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const paragraphId = b.editor.surface!.session.paragraphIds()[1]!;
    const end = { paragraphId, offset: 'Second paragraph names the supplier'.length };
    b.editor.surface!.setSelection({ anchor: end, head: end });
    expect(b.editor.exec({ type: 'insertText', text: ' today' }).ok).toBe(true);
    expect(replaceAll(a, 'supplier', 'vendor')).toMatchObject({
      ok: true,
      replacements: { replaced: 4, skipped: 0 },
    });
    sync(a, b);
    await converged(a, b);
    const text = a.editor.surface!.session.bodyText();
    expect(text).toContain('names the vendor today.');
    expect(text).not.toContain('supplier');
  } finally {
    b.close();
    a.close();
  }
});

test('a peer deleting matched text while every match is replaced converges', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    expect(a.editor.setEditingMode('suggesting').ok).toBe(true);
    const paragraphId = b.editor.surface!.session.paragraphIds()[0]!;
    b.editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 'The supplier ships'.length },
    });
    expect(b.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(replaceAll(a, 'supplier', 'vendor').ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    // Bob's deletion took the first match with it; Alice's proposal for it stays as an
    // insertion. The other three matches carry a strike and an insertion each.
    for (const p of [a, b]) {
      expect(p.editor.surface!.session.bodyText()).toBe(
        'vendor the goods to the suppliervendor.\nSecond paragraph names the suppliervendor.'
      );
      const kinds = p.editor.getTrackedChanges().map((change) => `${change.kind}:${change.author}`);
      expect(kinds.filter((kind) => kind === 'insert:Alice')).toHaveLength(4);
      expect(kinds.filter((kind) => kind === 'delete:Alice')).toHaveLength(3);
      expect(kinds).toHaveLength(7);
    }
    // Every "supplier" left is struck: a second run on either peer replaces none of them.
    expect(replaceAll(b, 'supplier', 'vendor')).toMatchObject({
      ok: true,
      changed: false,
      replacements: { replaced: 0, skipped: 3 },
    });
  } finally {
    b.close();
    a.close();
  }
});

test('undo on one peer after the other peer replaces all leaves the other edit alone', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const paragraphId = a.editor.surface!.session.paragraphIds()[1]!;
    const start = { paragraphId, offset: 0 };
    a.editor.surface!.setSelection({ anchor: start, head: start });
    expect(a.editor.exec({ type: 'insertText', text: 'Note: ' }).ok).toBe(true);
    sync(a, b);
    expect(replaceAll(b, 'supplier', 'vendor').ok).toBe(true);
    sync(a, b);
    // Alice undoes her own typing; Bob's replacements stay.
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    const text = b.editor.surface!.session.bodyText();
    expect(text).not.toContain('Note: ');
    expect(matches(b, 'vendor')).toBe(4);
  } finally {
    b.close();
    a.close();
  }
});
