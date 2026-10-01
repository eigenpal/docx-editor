/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { DocxEditor as ServerDocxEditor } from '@docx-editor.dev/editor-api';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  paraIdOf,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { zipDocument } from './document-peer-support.ts';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const fixture = zipDocument(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
    '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' +
    p('Header') +
    '</w:tc></w:tr>' +
    '<w:tr><w:tc>' +
    p('A') +
    '</w:tc><w:tc>' +
    p('B') +
    '</w:tc></w:tr></w:tbl>' +
    p('Tail')
);

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'api-row-insertion',
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
    awareness,
    room,
    editor,
    runtime,
    container,
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
async function insert(peer: Peer, tracked: boolean) {
  await peer.runtime.run(async (context) => {
    const table = context.document.body.tables.getFirst();
    table.rows.load('items');
    await context.sync();
    if (tracked) context.document.changeTrackingMode = 'TrackMineOnly';
    table.rows.items[1]!.insertRows('After', 1, [['New', 'Row']]);
    await context.sync();
  });
}

for (const tracked of [false, true]) {
  test(`merged-header insertion synchronizes, undoes and rejoins; tracked=${tracked}`, async () => {
    const a = await peer('Alice');
    const b = await peer('Bob', a);
    let c: Peer | undefined;
    let bClosed = false;
    try {
      await insert(a, tracked);
      sync(a, b);
      await converged(a, b);
      const after = canonicalOoxmlFingerprint(await main(b));
      expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
      sync(a, b);
      await converged(a, b);
      expect(canonicalOoxmlFingerprint(await main(b))).not.toBe(after);
      expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
      sync(a, b);
      await converged(a, b);
      expect(canonicalOoxmlFingerprint(await main(b))).toBe(after);
      const reconnectState = new Y.Doc();
      Y.applyUpdate(reconnectState, Y.encodeStateAsUpdate(b.ydoc));
      b.destroy();
      bClosed = true;
      try {
        c = await peer('Bob', { ydoc: reconnectState });
      } finally {
        reconnectState.destroy();
      }
      await converged(a, c);
      const reopened = await ServerDocxEditor.createServer(new Uint8Array(await c.editor.save()));
      try {
        await reopened.run(async (context) => {
          const table = context.document.body.tables.getFirst();
          table.load('values');
          await context.sync();
          expect(table.values).toEqual([['Header'], ['A', 'B'], ['New', 'Row']]);
        });
      } finally {
        reopened.dispose();
      }
      const part = await main(a);
      const stack: OoxmlNode[] = [part.root];
      let paragraphId: string | undefined;
      while (stack.length) {
        const node = stack.pop()!;
        if (node.kind === 'paragraph' && JSON.stringify(node).includes('"value":"New"')) {
          paragraphId = paraIdOf(node) ?? undefined;
          break;
        }
        if (node.kind !== 'textValue') stack.push(...node.children);
      }
      expect(paragraphId).toBeDefined();
      a.room.session.setLocalSelection({
        anchor: { paragraphId: paragraphId!, offset: 0 },
        head: { paragraphId: paragraphId!, offset: 1 },
      });
      applyAwarenessUpdate(
        c.awareness,
        encodeAwarenessUpdate(a.awareness, [a.awareness.clientID]),
        'relay'
      );
      expect(c.room.session.remoteSelections()).toMatchObject([
        { actorId: 'Alice', anchor: { paragraphId, offset: 0 } },
      ]);
    } finally {
      c?.destroy();
      if (!bClosed) b.destroy();
      a.destroy();
    }
  });
}

test('concurrent row insertion and cell edits converge; deletion keeps the surviving tail', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    await insert(a, false);
    await b.runtime.run(async (context) => {
      context.document.body.tables
        .getFirst()
        .getCell(1, 0)
        .body.getRange('End')
        .insertText(' edited', 'After');
      await context.sync();
    });
    sync(a, b);
    await converged(a, b);
    await a.runtime.run(async (context) => {
      context.document.body.tables.getFirst().delete();
      await context.sync();
    });
    await b.runtime.run(async (context) => {
      context.document.body.tables
        .getFirst()
        .getCell(2, 0)
        .body.getRange('End')
        .insertText(' concurrent', 'After');
      await context.sync();
    });
    sync(a, b);
    await converged(a, b);
    await b.runtime.run(async (context) => {
      const body = context.document.body;
      body.load('text');
      await context.sync();
      expect(body.text).toContain('Tail');
      expect(body.text).not.toContain('Header');
    });
  } finally {
    b.destroy();
    a.destroy();
  }
});
