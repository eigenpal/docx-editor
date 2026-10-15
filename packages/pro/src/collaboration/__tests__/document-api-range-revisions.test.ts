/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Range-scoped revision decisions and review-key ranges across two collaborating editors.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  DocxEditor,
  getReviewItemRange,
  getReviewItemRevisions,
  type RequestContext,
} from '@docx-editor.dev/editor-api/browser';
import { DocxEditor as ServerDocxEditor } from '@docx-editor.dev/editor-api';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { zipDocument } from './document-peer-support.ts';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const ins = (id: number, text: string) => `<w:ins w:id="${id}" w:author="Ada">${run(text)}</w:ins>`;
const del = (id: number, text: string) =>
  `<w:del w:id="${id}" w:author="Ada"><w:r><w:delText>${text}</w:delText></w:r></w:del>`;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const fixture = zipDocument(
  `<w:p>${run('keep ')}${ins(1, 'alpha')}</w:p>` +
    `<w:p>${run('tail ')}${ins(2, 'beta')}</w:p>` +
    `<w:p><w:commentRangeStart w:id="9"/>${run('Other')}<w:commentRangeEnd w:id="9"/>` +
    `<w:r><w:commentReference w:id="9"/></w:r></w:p>` +
    `<w:p>${run('swap ')}${del(3, 'old')}${ins(4, 'new')}</w:p>`,
  {
    overrides:
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
    documentRels: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdC" Type="${OFFICE}/comments" Target="comments.xml"/></Relationships>`,
    extraXml: {
      'word/comments.xml': `<w:comments xmlns:w="${W}"><w:comment w:id="9" w:author="Grace"><w:p>${run('Check this.')}</w:p></w:comment></w:comments>`,
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
    documentId: 'api-range-revisions',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: fixture },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    modules: [reviewModule(), collaborationModule({ session: room.session })],
    author: name,
  });
  const runtime = DocxEditor.createBrowser(editor, { author: name });
  return {
    ydoc,
    editor,
    runtime,
    destroy() {
      runtime.dispose();
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
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)), 'relay');
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc)), 'relay');
}

async function main(peer: Peer) {
  const loaded = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
}

async function converged(a: Peer, b: Peer) {
  expect(canonicalOoxmlFingerprint(await main(a))).toBe(canonicalOoxmlFingerprint(await main(b)));
}

const bodyText = (peer: Peer) =>
  peer.runtime.run(async (context) => {
    const body = context.document.body;
    body.load('text');
    await context.sync();
    return body.text;
  });

async function search(context: RequestContext, text: string) {
  const matches = context.document.body.search(text);
  matches.load('items');
  await context.sync();
  return matches.items;
}

const revisionTexts = (peer: Peer) =>
  peer.editor
    .getReviewItems({ placement: false })
    .filter((item) => item.kind === 'revision')
    .map((item) => item.text);

test('a key from one replica accepts through Range.revisions on another and converges', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const key = b.editor
      .getReviewItems({ placement: false })
      .find((item) => item.kind === 'revision' && item.text === 'alpha')!.key;

    // Bob edits another paragraph while Alice decides.
    await b.runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      paragraphs.items[2]!.insertText(' text', 'End');
      await context.sync();
    });
    await a.runtime.run(async (context) => {
      const range = getReviewItemRange(context, key);
      range.load('text');
      range.revisions.load('items');
      await context.sync();
      expect(range.text).toBe('alpha');
      expect(range.revisions.items).toHaveLength(1);
      range.revisions.acceptAll();
      await context.sync();
    });
    sync(a, b);
    await converged(a, b);
    expect(revisionTexts(a)).toEqual(['beta', 'new']);
    expect(revisionTexts(b)).toEqual(['beta', 'new']);

    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(revisionTexts(b)).toEqual(['alpha', 'beta', 'new']);
    expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(revisionTexts(b)).toEqual(['beta', 'new']);

    const reopened = await ServerDocxEditor.createServer(new Uint8Array(await b.editor.save()));
    try {
      await reopened.run(async (context) => {
        const body = context.document.body;
        body.load('text');
        context.document.body.revisions.load('items');
        await context.sync();
        expect(body.text).toBe('keep alpha\rtail beta\rOther text\rswap oldnew');
        expect(context.document.body.revisions.items).toHaveLength(3);
      });
    } finally {
      reopened.dispose();
    }
  } finally {
    b.destroy();
    a.destroy();
  }
});

test('a concurrent decision on the same change converges without a stale replay', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    await a.runtime.run(async (context) => {
      const matches = context.document.body.search('alpha');
      matches.load('items');
      await context.sync();
      matches.items[0]!.revisions.rejectAll();
      await context.sync();
    });
    await b.runtime.run(async (context) => {
      const matches = context.document.body.search('alpha');
      matches.load('items');
      await context.sync();
      matches.items[0]!.revisions.acceptAll();
      await context.sync();
    });
    sync(a, b);
    await converged(a, b);
    // Rejecting removes the inserted text and accepting keeps it; the removal survives the merge.
    expect(await bodyText(a)).toBe('keep \rtail beta\rOther\rswap oldnew');
    expect(await bodyText(b)).toBe('keep \rtail beta\rOther\rswap oldnew');
    expect(revisionTexts(a)).toEqual(['beta', 'new']);
    expect(revisionTexts(b)).toEqual(['beta', 'new']);
  } finally {
    b.destroy();
    a.destroy();
  }
});

test('an edit inside the change survives a range decision on another replica', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    await b.runtime.run(async (context) => {
      const [inside] = await search(context, 'alph');
      inside!.insertText('X', 'End');
      await context.sync();
    });
    await a.runtime.run(async (context) => {
      const [match] = await search(context, 'alpha');
      match!.revisions.acceptAll();
      await context.sync();
    });
    sync(a, b);
    await converged(a, b);
    expect(await bodyText(b)).toBe('keep alphXa\rtail beta\rOther\rswap oldnew');
    expect(revisionTexts(a)).toEqual(['beta', 'new']);
    expect(revisionTexts(b)).toEqual(['beta', 'new']);
  } finally {
    b.destroy();
    a.destroy();
  }
});

test('pair and comment keys from one replica resolve on another', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const items = b.editor.getReviewItems({ placement: false });
    const pair = items.find((item) => item.key.startsWith('revision-replace:'))!;
    const comment = items.find((item) => item.kind === 'comment')!;
    await a.runtime.run(async (context) => {
      const range = getReviewItemRange(context, comment.key);
      const halves = getReviewItemRevisions(context, pair.key);
      range.load('text');
      halves.load('items');
      await context.sync();
      expect(range.text).toBe('Other');
      expect(halves.items).toHaveLength(2);
      halves.acceptAll();
      await context.sync();
    });
    sync(a, b);
    await converged(a, b);
    expect(await bodyText(b)).toBe('keep alpha\rtail beta\rOther\rswap new');
    expect(revisionTexts(b)).toEqual(['alpha', 'beta']);
    expect(b.editor.getReviewItems({ placement: false }).map((item) => item.key)).not.toContain(
      pair.key
    );
  } finally {
    b.destroy();
    a.destroy();
  }
});
