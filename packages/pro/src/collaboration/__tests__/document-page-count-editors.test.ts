/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
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

const source = Array.from(
  { length: 20 },
  (_, index) => `<w:p><w:r><w:t>Paragraph ${index}</w:t></w:r></w:p>`
).join('');

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
}

// A remote edit that adds pages moves no local caret. The other editor's page counter must
// still hear the new total, and hear it shrink again when the edit is undone.
test('a peer hears the page total a remote edit moves, and its undo', async () => {
  const { createDocxEditor } = await import('@docx-editor.dev/core/editor');
  const a = new Y.Doc(),
    b = new Y.Doc();
  const leftRoom = await createDocumentCollaboration({
    ydoc: a,
    awareness: new Awareness(a),
    documentId: 'page-count-editors',
    identity: { actorId: 'alice', name: 'Alice' },
    bootstrap: { kind: 'create', document: zipDocument(source) },
  });
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'relay');
  const rightRoom = await createDocumentCollaboration({
    ydoc: b,
    awareness: new Awareness(b),
    documentId: 'page-count-editors',
    identity: { actorId: 'bob', name: 'Bob' },
    bootstrap: { kind: 'join', timeoutMs: 5000 },
  });
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(b, update, 'relay');
  });
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(a, update, 'relay');
  });
  const lc = document.createElement('div'),
    rc = document.createElement('div');
  document.body.append(lc, rc);
  const left = createDocxEditor({
    container: lc,
    document: leftRoom.document,
    modules: [collaborationModule({ session: leftRoom.session })],
  });
  const right = createDocxEditor({
    container: rc,
    document: rightRoom.document,
    modules: [collaborationModule({ session: rightRoom.session })],
  });
  const heard: number[] = [];
  const record = () => heard.push(right.snapshot().page.total);
  const offs = [right.on('change', record), right.on('selectionChange', record)];
  try {
    const before = right.snapshot().page.total;
    const surface = left.surface!;
    const first = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: first, offset: 0 },
      head: { paragraphId: first, offset: 0 },
    });
    const lines = Array.from({ length: 120 }, (_, index) => `Inserted ${index}`).join('\n');
    expect(left.exec({ type: 'pasteWithoutFormatting', text: `${lines}\n` }).ok).toBe(true);
    await settle();
    const grown = right.surface!.layout().pages.length;
    expect(grown).toBeGreaterThan(before);
    expect(heard.at(-1)).toBe(grown);
    expect(left.snapshot().page.total).toBe(grown);

    expect(left.exec({ type: 'undo' }).ok).toBe(true);
    await settle();
    expect(right.surface!.layout().pages.length).toBe(before);
    expect(heard.at(-1)).toBe(before);
    expect(new Uint8Array(await left.save())).toEqual(new Uint8Array(await right.save()));
  } finally {
    for (const off of offs) off();
    left.destroy();
    right.destroy();
    lc.remove();
    rc.remove();
  }
}, 60_000);
