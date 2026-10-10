/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Hyphen elements through automation on a collaborative document (issue #1071).
//
// Automation types each hyphen as one character, U+001E or U+001F, and `insertText` turns
// the characters into elements. A remote replica receives the elements themselves.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationDocx } from './support.ts';

const ROOM = 'text-collaboration-hyphens';

function sync(source: Y.Doc, target: Y.Doc): void {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source, Y.encodeStateVector(target)), 'provider');
}

function firstParagraphXml(bytes: Uint8Array): string {
  const xml = strFromU8(unzipSync(bytes)['word/document.xml']!);
  return xml.match(/<w:p\b.*?<\/w:p>/s)![0];
}

test('hyphens survive a remote edit and a remote insertion as elements', async () => {
  const docs = [new Y.Doc(), new Y.Doc()];
  const awareness = docs.map((doc) => new Awareness(doc));
  const first = await createDocumentCollaboration({
    ydoc: docs[0]!,
    awareness: awareness[0]!,
    documentId: ROOM,
    sessionId: 'first',
    identity: { actorId: 'first', name: 'First' },
    bootstrap: {
      kind: 'create',
      document: collaborationDocx('the then</w:t><w:noBreakHyphen/><w:t>applicable rates'),
    },
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
  const writer = await DocxEditor.createCollaborative(first.document, first.session);
  const reader = await DocxEditor.createCollaborative(second.document, second.session);
  try {
    await writer.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      paragraph.insertText(' co\u001esigner', 'End');
      await context.sync();
    });
    sync(docs[0]!, docs[1]!);
    const [written, received] = [await writer.save(), await reader.save()];
    expect(firstParagraphXml(received)).toBe(firstParagraphXml(written));
    expect(firstParagraphXml(received).match(/<w:noBreakHyphen\/>/g)).toHaveLength(2);
    const text = await reader.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      paragraph.load('text');
      await context.sync();
      return paragraph.text;
    });
    expect(text).toBe('the then\u001eapplicable rates co\u001esigner');
  } finally {
    writer.dispose();
    reader.dispose();
    first.destroy();
    second.destroy();
    for (const entry of awareness) entry.destroy();
    for (const doc of docs) doc.destroy();
  }
});

test('a symbol survives remote edits on both sides of it as an element', async () => {
  const docs = [new Y.Doc(), new Y.Doc()];
  const awareness = docs.map((doc) => new Awareness(doc));
  const first = await createDocumentCollaboration({
    ydoc: docs[0]!,
    awareness: awareness[0]!,
    documentId: `${ROOM}-symbol`,
    sessionId: 'first',
    identity: { actorId: 'first', name: 'First' },
    bootstrap: {
      kind: 'create',
      document: collaborationDocx('tick</w:t><w:sym w:font="Wingdings" w:char="F0FC"/><w:t>box'),
    },
  });
  Y.applyUpdate(docs[1]!, Y.encodeStateAsUpdate(docs[0]!), 'initial');
  const second = await createDocumentCollaboration({
    ydoc: docs[1]!,
    awareness: awareness[1]!,
    documentId: `${ROOM}-symbol`,
    sessionId: 'second',
    identity: { actorId: 'second', name: 'Second' },
    bootstrap: { kind: 'join' },
  });
  const writer = await DocxEditor.createCollaborative(first.document, first.session);
  const reader = await DocxEditor.createCollaborative(second.document, second.session);
  try {
    await writer.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      paragraph.insertText('[', 'Start');
      await context.sync();
    });
    sync(docs[0]!, docs[1]!);
    await writer.run(async (context) => {
      context.document.body.paragraphs.getFirst().insertText(']', 'End');
      await context.sync();
    });
    // One sync per edit: each update changes one region of the paragraph text.
    sync(docs[0]!, docs[1]!);
    await reader.run(async (context) => {
      context.document.body.paragraphs.getFirst().insertText('!', 'End');
      await context.sync();
    });
    sync(docs[1]!, docs[0]!);
    const [written, received] = [await writer.save(), await reader.save()];
    expect(firstParagraphXml(received)).toBe(firstParagraphXml(written));
    expect(firstParagraphXml(received).match(/<w:sym /g)).toHaveLength(1);
    const text = await reader.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      paragraph.load('text');
      await context.sync();
      return paragraph.text;
    });
    expect(text).toBe('[tick(box]!');
  } finally {
    writer.dispose();
    reader.dispose();
    first.destroy();
    second.destroy();
    for (const entry of awareness) entry.destroy();
    for (const doc of docs) doc.destroy();
  }
});
