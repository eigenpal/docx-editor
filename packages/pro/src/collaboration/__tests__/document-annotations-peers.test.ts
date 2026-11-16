/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Proofing annotations on a collaborative document.
//
// Annotations are one participant's view state: the other participant never sees them, and the
// shared document never holds them. An accepted fix is an ordinary edit, so it reaches the other
// participant and its save. A remote edit before a critique moves it; a remote edit inside the
// critiqued text, or a remote deletion of its paragraph, removes it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  DocxEditor,
  type CritiquePopupOptions,
  type DocxEditorServerRuntime,
} from '@docx-editor.dev/editor-api';
import { createDocumentCollaboration } from '../document-session.ts';

const ROOM = 'document-annotations-peers';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

const DOCUMENT = zipSync({
  '[Content_Types].xml': strToU8(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>` +
      '<w:p w14:paraId="11111111" w14:textId="11111111"><w:r><w:t xml:space="preserve">Teh cat and teh dog.</w:t></w:r></w:p>' +
      '<w:p w14:paraId="22222222" w14:textId="22222222"><w:r><w:t>Recieve it.</w:t></w:r></w:p>' +
      '<w:p w14:paraId="33333333" w14:textId="33333333"><w:r><w:t>Last line.</w:t></w:r></w:p>' +
      '<w:sectPr/></w:body></w:document>'
  ),
});

const popup = (...suggestions: string[]): CritiquePopupOptions => ({
  brandingTextResourceId: '',
  subtitleResourceId: '',
  titleResourceId: '',
  suggestions,
});

function sync(source: Y.Doc, target: Y.Doc): void {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source, Y.encodeStateVector(target)), 'provider');
}

async function annotationCount(runtime: DocxEditorServerRuntime, index: number): Promise<number> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    const annotations = paragraphs.items[index]!.getAnnotations();
    annotations.load('items');
    await context.sync();
    return annotations.items.length;
  });
}

async function texts(runtime: DocxEditorServerRuntime): Promise<string[]> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    return paragraphs.items.map((paragraph) => paragraph.text);
  });
}

test('annotations stay local, follow remote edits, and an accepted fix reaches the peer', async () => {
  const docs = [new Y.Doc(), new Y.Doc()];
  const awareness = docs.map((doc) => new Awareness(doc));
  const first = await createDocumentCollaboration({
    ydoc: docs[0]!,
    awareness: awareness[0]!,
    documentId: ROOM,
    sessionId: 'first',
    identity: { actorId: 'first', name: 'First' },
    bootstrap: { kind: 'create', document: DOCUMENT },
  });
  Y.applyUpdate(docs[1]!, Y.encodeStateAsUpdate(docs[0]!), 'initial');
  const second = await createDocumentCollaboration({
    ydoc: docs[1]!,
    awareness: awareness[1]!,
    documentId: ROOM,
    sessionId: 'second',
    identity: { actorId: 'second', name: 'Second' },
    bootstrap: { kind: 'join' },
  });
  const checker = await DocxEditor.createCollaborative(first.document, first.session);
  const peer = await DocxEditor.createCollaborative(second.document, second.session);
  try {
    const ids = await checker.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      const inFirst = paragraphs.items[0]!.insertAnnotations({
        critiques: [
          { colorScheme: 'Red', start: 0, length: 3, popupOptions: popup('The') },
          { colorScheme: 'Red', start: 12, length: 3, popupOptions: popup('the') },
        ],
      });
      const inSecond = paragraphs.items[1]!.insertAnnotations({
        critiques: [{ colorScheme: 'Red', start: 0, length: 7, popupOptions: popup('Receive') }],
      });
      const inThird = paragraphs.items[2]!.insertAnnotations({
        critiques: [{ colorScheme: 'Blue', start: 0, length: 4 }],
      });
      await context.sync();
      return [...inFirst.value, ...inSecond.value, ...inThird.value];
    });
    expect(ids).toHaveLength(4);
    sync(docs[0]!, docs[1]!);
    expect(await annotationCount(peer, 0)).toBe(0);

    // The peer edits before one critique, inside another, and deletes a third's paragraph.
    await peer.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      const inside = paragraphs.items[0]!.search('cat');
      inside.load('items');
      await context.sync();
      inside.items[0]!.insertText('big cat', 'Replace');
      paragraphs.items[2]!.delete();
      await context.sync();
    });
    sync(docs[1]!, docs[0]!);

    const after = await checker.run(async (context) => {
      const moved = context.document.getAnnotationById(ids[1]!).critiqueAnnotation;
      moved.load('critique');
      const kept = context.document.getAnnotationById(ids[0]!);
      kept.load('state');
      await context.sync();
      return { start: moved.critique.start, state: kept.state };
    });
    expect(after).toEqual({ start: 16, state: 'Created' });
    const removed = await checker
      .run(async (context) => {
        context.document.getAnnotationById(ids[3]!).load('id');
        await context.sync();
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(removed).toMatchObject({ code: 'ItemNotFound' });

    // Accepting is an ordinary edit: it reaches the peer and the peer's save.
    await checker.run(async (context) => {
      context.document.getAnnotationById(ids[1]!).critiqueAnnotation.accept();
      context.document.getAnnotationById(ids[2]!).critiqueAnnotation.accept();
      await context.sync();
    });
    sync(docs[0]!, docs[1]!);
    expect(await texts(peer)).toEqual(['Teh big cat and the dog.', 'Receive it.']);
    expect(await texts(checker)).toEqual(['Teh big cat and the dog.', 'Receive it.']);
    const saved = strFromU8(unzipSync(await peer.save())['word/document.xml']!);
    expect(saved).toContain('Receive it.');
    expect(await annotationCount(checker, 0)).toBe(1);
  } finally {
    checker.dispose();
    peer.dispose();
    first.destroy();
    second.destroy();
    for (const entry of awareness) entry.destroy();
    for (const doc of docs) doc.destroy();
  }
});

test('a concurrent remote edit inside the critiqued text refuses the accept', async () => {
  const docs = [new Y.Doc(), new Y.Doc()];
  const awareness = docs.map((doc) => new Awareness(doc));
  const first = await createDocumentCollaboration({
    ydoc: docs[0]!,
    awareness: awareness[0]!,
    documentId: `${ROOM}-concurrent`,
    sessionId: 'first',
    identity: { actorId: 'first', name: 'First' },
    bootstrap: { kind: 'create', document: DOCUMENT },
  });
  Y.applyUpdate(docs[1]!, Y.encodeStateAsUpdate(docs[0]!), 'initial');
  const second = await createDocumentCollaboration({
    ydoc: docs[1]!,
    awareness: awareness[1]!,
    documentId: `${ROOM}-concurrent`,
    sessionId: 'second',
    identity: { actorId: 'second', name: 'Second' },
    bootstrap: { kind: 'join' },
  });
  const checker = await DocxEditor.createCollaborative(first.document, first.session);
  const peer = await DocxEditor.createCollaborative(second.document, second.session);
  try {
    const [id] = await checker.run(async (context) => {
      const ids = context.document.body.paragraphs.getFirst().insertAnnotations({
        critiques: [{ colorScheme: 'Red', start: 0, length: 3, popupOptions: popup('The') }],
      });
      await context.sync();
      return ids.value;
    });
    await peer.run(async (context) => {
      const found = context.document.body.search('Teh');
      found.load('items');
      await context.sync();
      found.items[0]!.insertText('Ten', 'Replace');
      await context.sync();
    });
    sync(docs[1]!, docs[0]!);
    const refused = await checker
      .run(async (context) => {
        context.document.getAnnotationById(id!).critiqueAnnotation.accept();
        await context.sync();
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(refused).toMatchObject({ code: 'ItemNotFound' });
    sync(docs[0]!, docs[1]!);
    expect((await texts(peer))[0]).toBe('Ten cat and teh dog.');
    expect((await texts(checker))[0]).toBe('Ten cat and teh dog.');
  } finally {
    checker.dispose();
    peer.dispose();
    first.destroy();
    second.destroy();
    for (const entry of awareness) entry.destroy();
    for (const doc of docs) doc.destroy();
  }
});
