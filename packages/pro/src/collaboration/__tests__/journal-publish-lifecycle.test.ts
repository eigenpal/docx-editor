/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Page hide must publish queued journals. Losing an edit is worse than sending it late.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strToU8, zipSync } from 'fflate';
import {
  TreePackageStore,
  normalizeParagraphIdentity,
  readOoxmlPackage,
  type StoryScope,
} from '@docx-editor.dev/core/store';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration';
import { createDocumentCollaboration } from '../document-session.ts';
import type { YjsCollaborationRoom } from '../session.ts';

const DOCUMENT_ID = 'pagehide-room';
const BODY: StoryScope = { kind: 'body' };
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function proseBytes(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`
    ),
  });
}

describe('collaboration journal page lifecycle', () => {
  let ydoc: Y.Doc | undefined;
  let awareness: Awareness | undefined;
  let room: YjsCollaborationRoom | undefined;

  afterEach(() => {
    room?.destroy();
    awareness?.destroy();
    ydoc?.destroy();
    room = undefined;
    awareness = undefined;
    ydoc = undefined;
  });

  test('pagehide publishes a queued journal', async () => {
    ydoc = new Y.Doc();
    awareness = new Awareness(ydoc);
    const bytes = proseBytes();
    room = await createDocumentCollaboration({
      ydoc,
      awareness,
      documentId: DOCUMENT_ID,
      identity: { actorId: 'alice', name: 'alice' },
      bootstrap: { kind: 'create', document: bytes },
    });
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
    if (!main) throw new Error('no main');
    const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
    const port = createCollaborationDocumentPort(store, { documentId: DOCUMENT_ID });
    room.session.attach(port);
    const paragraphs: string[] = [];
    const visit = (node: { kind: string; id: string; children?: readonly unknown[] }): void => {
      if (node.kind === 'paragraph') paragraphs.push(node.id);
      if (node.kind === 'textValue' || !node.children) return;
      for (const child of node.children) visit(child as typeof node);
    };
    visit(store.bodyStore().part.root);
    const paragraphId = paragraphs[0];
    if (!paragraphId) throw new Error('no paragraph');
    const before = Y.encodeStateAsUpdate(ydoc);
    const result = store.transact(BODY, (context) => {
      context.apply({ op: 'insertText', paragraphId, offset: 5, text: '!' });
    });
    if (!result.ok) throw new Error(result.detail ?? result.reason);
    expect(port.hasPendingJournals()).toBe(true);
    expect(Y.encodeStateAsUpdate(ydoc)).toEqual(before);
    window.dispatchEvent(new Event('pagehide'));
    expect(port.hasPendingJournals()).toBe(false);
    expect(Y.encodeStateAsUpdate(ydoc)).not.toEqual(before);
  });
});
