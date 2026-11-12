/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A tracked `replaceMatch` between two editors in one shared room.
//
// The command writes through the surface's ordinary commit lane, so the collaboration session
// sees plain tracked text ops. Both peers must converge on the same strike and insertion, undo
// and redo must travel, a joining peer must reopen the same document, and concurrent edits in
// the same paragraph must survive.

import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  revisionItemsOf,
} from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { zipDocument } from './document-peer-support.ts';

const fixture = zipDocument(
  '<w:p><w:r><w:t>The supplier ships the goods.</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p>'
);

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const headerFixture = zipDocument(
  '<w:p><w:r><w:t>Body text.</w:t></w:r></w:p>' +
    '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/></w:sectPr>',
  {
    overrides:
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    documentRels:
      `<Relationships xmlns="${REL_NS}">` +
      `<Relationship Id="rHeader" Type="${R_NS}/header" Target="header1.xml"/></Relationships>`,
    extraXml: {
      'word/header1.xml': `<w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:t>Draft header</w:t></w:r></w:p></w:hdr>`,
    },
  }
);

async function peer(name: string, host?: { ydoc: Y.Doc }, bytes = fixture) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'replace-match',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: bytes },
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

async function savedPart(peer: Peer) {
  const result = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
  if (!result.ok) throw new Error(result.reason);
  return result.package.parts.get(result.package.mainDocumentPart)!;
}

async function converged(a: Peer, b: Peer) {
  expect(canonicalOoxmlFingerprint(await savedPart(a))).toBe(
    canonicalOoxmlFingerprint(await savedPart(b))
  );
}

async function revisions(peer: Peer) {
  return revisionItemsOf(await savedPart(peer)).map((item) => [item.revisionKind, item.author]);
}

function replace(peer: Peer, query: string, text: string) {
  const [match] = peer.editor.findMatches(query);
  if (!match) throw new Error(`no match for ${query}`);
  return peer.editor.exec({ type: 'replaceMatch', match, text });
}

test('a tracked replaceMatch synchronizes, undoes, redoes, and reopens', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  let joined: Peer | undefined;
  try {
    expect(a.editor.setEditingMode('suggesting').ok).toBe(true);
    const selection = a.editor.surface!.state().selection;
    expect(replace(a, 'supplier', 'vendor')).toEqual({ ok: true, changed: true });
    expect(a.editor.surface!.state().selection).toEqual(selection);
    sync(a, b);
    await converged(a, b);
    expect(await revisions(b)).toEqual([
      ['delete', 'Alice'],
      ['insert', 'Alice'],
    ]);
    expect(b.editor.surface!.session.bodyText()).toContain('supplier');
    expect(b.editor.surface!.session.bodyText()).toContain('vendor');

    // One undo step takes back both halves for every peer.
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(await revisions(b)).toEqual([]);
    expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(await revisions(b)).toHaveLength(2);

    joined = await peer('Carol', b);
    await converged(a, joined);
    expect(await revisions(joined)).toHaveLength(2);
  } finally {
    joined?.close();
    b.close();
    a.close();
  }
});

test('concurrent typing in the same paragraph survives a tracked replaceMatch', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    expect(a.editor.setEditingMode('suggesting').ok).toBe(true);
    const paragraphId = b.editor.surface!.session.paragraphIds()[0]!;
    const end = { paragraphId, offset: 'The supplier ships the goods'.length };
    b.editor.surface!.setSelection({ anchor: end, head: end });
    expect(b.editor.exec({ type: 'insertText', text: ' today' }).ok).toBe(true);
    expect(replace(a, 'supplier', 'vendor').ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    const text = a.editor.surface!.session.bodyText();
    expect(text).toContain('vendor');
    expect(text).toContain('goods today.');
    expect(await revisions(a)).toEqual([
      ['delete', 'Alice'],
      ['insert', 'Alice'],
    ]);
  } finally {
    b.close();
    a.close();
  }
});

test('a peer deleting the matched text while it is replaced converges', async () => {
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
    expect(replace(a, 'supplier', 'vendor').ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(a.editor.surface!.session.bodyText()).toContain('the goods.');
  } finally {
    b.close();
    a.close();
  }
});

test('a replaceMatch made stale by a remote edit refuses on the peer that issues it', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const [stale] = a.editor.findMatches('ships');
    const blockId = a.editor.surface!.session.paragraphIds()[0]!;
    const range = { blockId, start: stale!.start, length: 5, expectedText: 'ships' };
    // Bob rewrites the start of the paragraph, which moves "ships" away from its offsets.
    const [the] = b.editor.findMatches('The supplier');
    expect(b.editor.exec({ type: 'replaceMatch', match: the!, text: 'A vendor' }).ok).toBe(true);
    sync(a, b);
    const before = a.editor.surface!.session.bodyText();
    expect(before).toContain('A vendor ships the goods.');

    for (const match of [stale!, range]) {
      expect(a.editor.exec({ type: 'replaceMatch', match, text: 'sends' })).toMatchObject({
        ok: false,
        code: 'notFound',
      });
    }
    expect(a.editor.surface!.session.bodyText()).toBe(before);
    sync(a, b);
    await converged(a, b);

    // Found again, the replacement lands for both peers.
    expect(replace(a, 'ships', 'sends')).toEqual({ ok: true, changed: true });
    sync(a, b);
    await converged(a, b);
    expect(b.editor.surface!.session.bodyText()).toContain('A vendor sends the goods.');
  } finally {
    b.close();
    a.close();
  }
});

test('a header range replaced from the body synchronizes, undoes, and converges', async () => {
  const a = await peer('Alice', undefined, headerFixture);
  const b = await peer('Bob', a);
  try {
    expect(a.editor.setEditingMode('suggesting').ok).toBe(true);
    const match = a.editor.findMatches('Draft')[0]!;
    expect(match.scope?.kind).toBe('headerFooter');
    const range = { blockId: match.blockId, start: match.start, length: 5, expectedText: 'Draft' };
    expect(a.editor.getActiveScope()).toEqual({ kind: 'body' });
    expect(a.editor.exec({ type: 'replaceMatch', match: range, text: 'Final' })).toEqual({
      ok: true,
      changed: true,
    });
    // The header was edited where it stands; neither peer was moved into it.
    expect(a.editor.getActiveScope()).toEqual({ kind: 'body' });
    sync(a, b);
    await converged(a, b);
    expect(b.editor.getActiveScope()).toEqual({ kind: 'body' });
    const final = (peer: Peer) =>
      peer.editor.findMatches('Final').map((found) => found.scope?.kind ?? 'body');
    expect(final(b)).toEqual(['headerFooter']);

    // One undo step on Alice takes the tracked replacement back for both peers.
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(final(a)).toEqual([]);
    expect(final(b)).toEqual([]);
    expect(b.editor.findMatches('Draft header')).toHaveLength(1);
    expect(a.editor.getActiveScope()).toEqual({ kind: 'body' });
    expect(b.editor.getActiveScope()).toEqual({ kind: 'body' });
  } finally {
    b.close();
    a.close();
  }
});

test('a header replace from the body converges beside body typing, with no scope change', async () => {
  const a = await peer('Alice', undefined, headerFixture);
  const b = await peer('Bob', a);
  try {
    const bodyId = b.editor.surface!.session.paragraphIds()[0]!;
    const end = { paragraphId: bodyId, offset: 'Body text'.length };
    b.editor.surface!.setSelection({ anchor: end, head: end });
    const aliceCaret = a.editor.surface!.state().selection;
    const match = a.editor.findMatches('Draft')[0]!;
    const range = { blockId: match.blockId, start: match.start, length: 5, expectedText: 'Draft' };

    expect(b.editor.exec({ type: 'insertText', text: ' here' }).ok).toBe(true);
    expect(a.editor.exec({ type: 'replaceMatch', match: range, text: 'Final' }).ok).toBe(true);
    expect(a.editor.surface!.state().selection).toEqual(aliceCaret);
    sync(a, b);
    await converged(a, b);
    expect(b.editor.findMatches('Final header')).toHaveLength(1);
    expect(b.editor.surface!.session.bodyText()).toContain('Body text here.');
    for (const each of [a, b]) expect(each.editor.getActiveScope()).toEqual({ kind: 'body' });

    // Alice's undo takes back only her header edit, for both peers.
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(b.editor.findMatches('Draft header')).toHaveLength(1);
    expect(b.editor.surface!.session.bodyText()).toContain('Body text here.');
    for (const each of [a, b]) expect(each.editor.getActiveScope()).toEqual({ kind: 'body' });
  } finally {
    b.close();
    a.close();
  }
});
