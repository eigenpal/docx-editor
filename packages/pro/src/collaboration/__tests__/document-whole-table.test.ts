/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Whole-table selection and deletion between an editor and a peer: selecting sends no
// document update, deletion and its tracked strike converge with concurrent typing, undo and
// redo reach the peer, and an offline deletion converges on reconnect.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { reviewModule } from '../../review/review-module.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});

const DOCUMENT_ID = 'whole-table-room';
const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const TABLE_DOCX = zipDocument(
  '<w:p><w:r><w:t>before</w:t></w:r></w:p>' +
    '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    `<w:tr>${cell('A1')}${cell('B1')}</w:tr><w:tr>${cell('A2')}${cell('B2')}</w:tr></w:tbl>` +
    '<w:p><w:r><w:t>after</w:t></w:r></w:p>' +
    '<w:sectPr/>'
);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

async function editorWithPeer() {
  const { createDocxEditor } = await import('@docx-editor.dev/core/editor');
  const { selectCellRectangle } =
    await import('../../../../core/src/editor/__tests__/paginated-surface-fixtures.ts');
  const harness = createPeerHarness(DOCUMENT_ID);
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: DOCUMENT_ID,
    identity: { actorId: 'editor-user', name: 'Editor user' },
    bootstrap: { kind: 'create', document: TABLE_DOCX },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    author: 'Editor user',
    modules: [collaborationModule({ session: room.session }), reviewModule()],
  });
  const peer = await harness.join({ ydoc } as unknown as Peer, 'peer');

  // A relay that can go offline: updates queue while paused and flush on reconnect.
  let online = true;
  const queued: [Y.Doc, Uint8Array][] = [];
  let peerUpdates = 0;
  const forward = (target: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (origin === 'relay') return;
    if (target === peer.ydoc) peerUpdates += 1;
    if (online) Y.applyUpdate(target, update, 'relay');
    else queued.push([target, update]);
  };
  ydoc.on('update', forward(peer.ydoc));
  peer.ydoc.on('update', forward(ydoc));
  awareness.on('update', ({ added, updated }: { added: number[]; updated: number[] }) => {
    applyAwarenessUpdate(
      peer.awareness,
      encodeAwarenessUpdate(awareness, [...added, ...updated]),
      'relay'
    );
  });

  const surface = editor.surface!;
  const tables = (target: Peer) => {
    const found: OoxmlNode[] = [];
    const pkg = harness.packageOf(target);
    walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node) => {
      if (node.kind !== 'textValue' && node.localName === 'tbl') found.push(node);
    });
    return found;
  };
  const peerCellParagraph = (text: string) => {
    let id = '';
    walk(tables(peer)[0]!, (node) => {
      if (!id && node.kind === 'paragraph' && nodeText(node) === text) id = node.id;
    });
    return id;
  };
  const selectWholeTable = () =>
    selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const observer = () => harness.join({ ydoc } as unknown as Peer, 'observer');

  cleanups.push(() => {
    editor.destroy();
    container.remove();
    harness.cleanup();
    room.destroy();
    ydoc.destroy();
  });
  return {
    editor,
    surface,
    room,
    peer,
    harness,
    tables,
    peerCellParagraph,
    selectWholeTable,
    settle,
    observer,
    peerUpdates: () => peerUpdates,
    offline() {
      online = false;
    },
    reconnect() {
      online = true;
      for (const [target, update] of queued.splice(0)) Y.applyUpdate(target, update, 'relay');
    },
  };
}

describe('whole-table selection with a peer', () => {
  test('selecting the table sends no document update and paints as a remote cell selection', async () => {
    const { editor, surface, peer, peerUpdates } = await editorWithPeer();
    const before = peerUpdates();
    const paragraphId = surface.session.paragraphIds()[1]!;
    surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 0 } });
    expect(editor.exec({ type: 'selectTableRegion', region: 'table' })).toEqual({
      ok: true,
      changed: false,
    });
    expect(peerUpdates()).toBe(before);
    expect(peer.room.session.remoteSelections()).toMatchObject([
      { actorId: 'editor-user', kind: 'cells' },
    ]);
  });
});

describe('whole-table deletion with a peer', () => {
  test('Backspace deletes the table on both replicas, and undo and redo follow', async () => {
    const ctx = await editorWithPeer();
    ctx.selectWholeTable();
    ctx.surface.deleteBackward();
    expect(ctx.tables(ctx.peer)).toHaveLength(0);
    ctx.surface.undo();
    await ctx.settle();
    expect(ctx.tables(ctx.peer)).toHaveLength(1);
    ctx.surface.redo();
    await ctx.settle();
    expect(ctx.tables(ctx.peer)).toHaveLength(0);
    ctx.harness.expectConverged(ctx.peer, await ctx.observer());
  });

  test('deleting the table while the peer types in it converges on the deletion', async () => {
    const ctx = await editorWithPeer();
    const typed = ctx.peerCellParagraph('B2');
    ctx.offline();
    ctx.selectWholeTable();
    ctx.surface.deleteBackward();
    ctx.harness.apply(ctx.peer, [
      { op: 'insertText', paragraphId: typed, offset: 2, text: '-peer' },
    ]);
    ctx.reconnect();
    await ctx.settle();
    expect(ctx.tables(ctx.peer)).toHaveLength(0);
    ctx.harness.expectConverged(ctx.peer, await ctx.observer());
  });

  test('an offline deletion converges with peer typing outside the table on reconnect', async () => {
    const ctx = await editorWithPeer();
    ctx.offline();
    ctx.selectWholeTable();
    ctx.surface.deleteBackward();
    ctx.harness.apply(ctx.peer, [
      {
        op: 'insertText',
        paragraphId: ctx.harness.paragraphIdAt(ctx.peer, 0),
        offset: 6,
        text: '!',
      },
    ]);
    ctx.reconnect();
    await ctx.settle();
    expect(ctx.tables(ctx.peer)).toHaveLength(0);
    expect(ctx.surface.session.paragraphIds()).toHaveLength(2);
    ctx.harness.expectConverged(ctx.peer, await ctx.observer());
  });
});

describe('suggesting mode with a peer', () => {
  test('a range strike across the table and peer typing in a cell both survive', async () => {
    const ctx = await editorWithPeer();
    expect(ctx.editor.setEditingMode('suggesting')).toMatchObject({ ok: true });
    const typed = ctx.peerCellParagraph('A1');
    const ids = ctx.surface.session.paragraphIds();
    ctx.offline();
    ctx.surface.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 'before'.length },
      head: { paragraphId: ids.at(-1)!, offset: 0 },
    });
    ctx.surface.deleteBackward();
    ctx.harness.apply(ctx.peer, [
      { op: 'insertText', paragraphId: typed, offset: 2, text: '-peer' },
    ]);
    ctx.reconnect();
    await ctx.settle();
    const [table] = ctx.tables(ctx.peer);
    expect(table).toBeDefined();
    expect(nodeText(table!)).toContain('-peer');
    ctx.harness.expectConverged(ctx.peer, await ctx.observer());
  });

  test('Backspace on a whole-table selection is refused and sends nothing', async () => {
    const ctx = await editorWithPeer();
    expect(ctx.editor.setEditingMode('suggesting')).toMatchObject({ ok: true });
    const before = ctx.peerUpdates();
    ctx.selectWholeTable();
    ctx.surface.deleteBackward();
    expect(ctx.peerUpdates()).toBe(before);
    expect(ctx.tables(ctx.peer)).toHaveLength(1);
  });
});
