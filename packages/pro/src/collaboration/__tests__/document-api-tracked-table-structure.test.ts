/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Merge and split inside a proposed table, through the editing API, between two participants.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, setSystemTime, test } from 'bun:test';
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
const fixture = zipDocument(p('Intro') + p('Tail'));

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'api-tracked-table-structure',
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
async function values(peer: Peer): Promise<string[][] | null> {
  return peer.runtime.run(async (context) => {
    const table = context.document.body.tables.getFirstOrNullObject();
    table.load('values');
    await context.sync();
    return table.isNullObject ? null : table.values;
  });
}
async function propose(peer: Peer) {
  await peer.runtime.run(async (context) => {
    context.document.changeTrackingMode = 'TrackMineOnly';
    context.document.body.paragraphs.getFirst().insertTable(3, 3, 'After', [
      ['Results', '', ''],
      ['Region', 'Q1', 'Q2'],
      ['North', '10', '12'],
    ]);
    await context.sync();
  });
}
async function reshape(peer: Peer) {
  await peer.runtime.run(async (context) => {
    context.document.changeTrackingMode = 'TrackMineOnly';
    const table = context.document.body.tables.getFirst();
    table.mergeCells(0, 0, 0, 2);
    table.getCell(2, 0).split(2, 1);
    await context.sync();
  });
}

const PROPOSED = [
  ['Results', '', ''],
  ['Region', 'Q1', 'Q2'],
  ['North', '10', '12'],
];
const SHAPED = [['Results'], ['Region', 'Q1', 'Q2'], ['North', '10', '12'], ['', '', '']];

test('a reshaped proposal replicates, undoes, redoes, rejoins, and reopens', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  let c: Peer | undefined;
  let bClosed = false;
  try {
    await propose(a);
    // Edits within the undo capture window are one step; start the reshape after it.
    setSystemTime(Date.now() + 1000);
    await reshape(a);
    setSystemTime();
    sync(a, b);
    await converged(a, b);
    expect(await values(b)).toEqual(SHAPED);
    const shaped = canonicalOoxmlFingerprint(await main(b));
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(await values(b)).toEqual(PROPOSED);
    expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(canonicalOoxmlFingerprint(await main(b))).toBe(shaped);

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
        expect(table.values).toEqual(SHAPED);
      });
    } finally {
      reopened.dispose();
    }

    // The merged header's paragraph is a selection target for the other participant.
    const stack: OoxmlNode[] = [(await main(a)).root];
    let paragraphId: string | undefined;
    while (stack.length) {
      const node = stack.pop()!;
      if (node.kind === 'paragraph' && JSON.stringify(node).includes('"value":"Results"')) {
        paragraphId = paraIdOf(node) ?? undefined;
        break;
      }
      if (node.kind !== 'textValue') stack.push(...node.children);
    }
    expect(paragraphId).toBeDefined();
    a.room.session.setLocalSelection({
      anchor: { paragraphId: paragraphId!, offset: 0 },
      head: { paragraphId: paragraphId!, offset: 7 },
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

for (const decision of ['acceptAll', 'rejectAll'] as const) {
  test(`a peer's ${decision} decides the reshaped proposal as one table`, async () => {
    const a = await peer('Alice');
    const b = await peer('Bob', a);
    try {
      await propose(a);
      await reshape(a);
      sync(a, b);
      await b.runtime.run(async (context) => {
        context.document.body.revisions[decision]();
        await context.sync();
      });
      sync(a, b);
      await converged(a, b);
      expect(await values(a)).toEqual(decision === 'acceptAll' ? SHAPED : null);
      const xml = JSON.stringify(await main(a));
      expect(xml).not.toContain('"localName":"ins"');
      expect(xml).toContain('"value":"Tail"');
    } finally {
      b.destroy();
      a.destroy();
    }
  });
}

test('a peer typing into the proposal while it is reshaped converges', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    await propose(a);
    sync(a, b);
    await reshape(a);
    await b.runtime.run(async (context) => {
      context.document.body.tables
        .getFirst()
        .getCell(1, 1)
        .body.getRange('End')
        .insertText(' total', 'After');
      await context.sync();
    });
    sync(a, b);
    await converged(a, b);
    const table = await values(a);
    expect(table?.[0]).toEqual(['Results']);
    expect(table?.[1]).toEqual(['Region', 'Q1 total', 'Q2']);
  } finally {
    b.destroy();
    a.destroy();
  }
});

test('a peer rejecting the proposal while it is reshaped removes the whole table', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    await propose(a);
    sync(a, b);
    await reshape(a);
    await b.runtime.run(async (context) => {
      context.document.body.revisions.rejectAll();
      await context.sync();
    });
    sync(a, b);
    await converged(a, b);
    await a.runtime.run(async (context) => {
      const body = context.document.body;
      body.load('text');
      await context.sync();
      expect(body.text).toContain('Tail');
      expect(body.text).not.toContain('Region');
    });
    expect(await values(a)).toBeNull();
  } finally {
    b.destroy();
    a.destroy();
  }
});
