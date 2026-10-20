/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two editors in one room: one indents a selection across two paragraphs while the other
// deletes the second of them. Whichever client wins the ordering, both editors must end with
// the same document and stay ready (#1176). Each round takes new random clients.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { readOoxmlPackage, type OoxmlNode } from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { zipDocument } from './document-peer-support.ts';

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});

const DOCUMENT = zipDocument(
  '<w:p><w:r><w:t>First paragraph text</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Second paragraph text</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Third paragraph text</w:t></w:r></w:p><w:sectPr/>'
);

async function editorOn(ydoc: Y.Doc, bootstrap: unknown) {
  const { createDocxEditor } = await import('@docx-editor.dev/core/editor');
  const awareness = new Awareness(ydoc);
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'indent-meets-deletion',
    identity: { actorId: `user-${ydoc.clientID}`, name: 'User' },
    bootstrap: bootstrap as never,
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    modules: [collaborationModule({ session: room.session })],
  });
  return {
    editor,
    room,
    destroy: () => {
      editor.destroy();
      container.remove();
      room.destroy();
      awareness.destroy();
    },
  };
}

/** The saved body, without node ids, which each editor mints for itself. */
async function savedBody(editor: { save(): Promise<ArrayBuffer | Uint8Array | null> }) {
  const bytes = await editor.save();
  if (!bytes) throw new Error('nothing saved');
  const read = readOoxmlPackage(new Uint8Array(bytes));
  if (!read.ok) throw new Error(read.reason);
  const strip = (node: OoxmlNode): unknown =>
    node.kind === 'textValue'
      ? node.value
      : { name: node.localName, attributes: node.attributes, children: node.children.map(strip) };
  return JSON.stringify(strip(read.package.parts.get(read.package.mainDocumentPart)!.root));
}

describe('a paragraph property write meets a deletion of that paragraph', () => {
  test('both editors keep the same document and stay ready', async () => {
    for (let round = 0; round < 8; round += 1) {
      const indenterDoc = new Y.Doc();
      const indenter = await editorOn(indenterDoc, { kind: 'create', document: DOCUMENT });
      const deleterDoc = new Y.Doc();
      Y.applyUpdate(deleterDoc, Y.encodeStateAsUpdate(indenterDoc));
      const deleter = await editorOn(deleterDoc, { kind: 'join', timeoutMs: 1_000 });
      try {
        const indenting = indenter.editor.surface!;
        const deleting = deleter.editor.surface!;
        const left = indenting.session.paragraphIds();
        const right = deleting.session.paragraphIds();
        // From the middle of the first paragraph to the middle of the second, indented.
        indenting.setSelection({
          anchor: { paragraphId: left[0]!, offset: 6 },
          head: { paragraphId: left[1]!, offset: 6 },
        });
        indenting.adjustIndent('increase');
        // From the start of the second paragraph to the start of the third, deleted.
        deleting.setSelection({
          anchor: { paragraphId: right[1]!, offset: 0 },
          head: { paragraphId: right[2]!, offset: 0 },
        });
        deleting.deleteBackward();
        // Neither saw the other's edit; now both exchange.
        const toDeleter = Y.encodeStateAsUpdate(indenterDoc, Y.encodeStateVector(deleterDoc));
        const toIndenter = Y.encodeStateAsUpdate(deleterDoc, Y.encodeStateVector(indenterDoc));
        Y.applyUpdate(deleterDoc, toDeleter, 'peer');
        Y.applyUpdate(indenterDoc, toIndenter, 'peer');

        expect(indenter.room.session.statusSnapshot().status).toBe('ready');
        expect(deleter.room.session.statusSnapshot().status).toBe('ready');
        expect(indenting.session.paragraphIds()).toHaveLength(2);
        expect(deleting.session.paragraphIds()).toHaveLength(2);
        expect(await savedBody(indenter.editor)).toBe(await savedBody(deleter.editor));
      } finally {
        indenter.destroy();
        deleter.destroy();
      }
    }
  });
});
