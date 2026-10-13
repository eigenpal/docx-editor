/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { readOoxmlPackage, canonicalOoxmlFingerprint } from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { collaborationDocx } from './support.ts';

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc(),
    awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'break-marks',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: collaborationDocx() },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    modules: [collaborationModule({ session: room.session })],
  });
  expect(editor.exec({ type: 'toggleParagraphMarks' })).toMatchObject({ ok: true });
  return {
    ydoc,
    editor,
    container,
    destroy() {
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

function caret(client: Peer, index: number, offset: number) {
  const surface = client.editor.surface!;
  const paragraphId = surface.session.paragraphIds()[index]!;
  expect(
    surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } })
  ).not.toBe(false);
}

function labels(client: Peer): string[] {
  return [...client.container.querySelectorAll('.docx-break-mark-label')]
    .map((label) => label.textContent!)
    .sort();
}

async function fingerprint(client: Peer) {
  const loaded = readOoxmlPackage(new Uint8Array(await client.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return canonicalOoxmlFingerprint(loaded.package.parts.get(loaded.package.mainDocumentPart)!);
}

async function converged(a: Peer, b: Peer, expected: readonly string[]) {
  expect(await fingerprint(a)).toBe(await fingerprint(b));
  expect(labels(a)).toEqual([...expected].sort());
  expect(labels(b)).toEqual([...expected].sort());
}

test('two editors label concurrent page and section breaks through undo, delete and rejoin', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let rejoined: Peer | undefined;
  try {
    expect(labels(a)).toEqual([]);
    caret(a, 0, 'Alpha'.length);
    expect(a.editor.exec({ type: 'insertBreak', kind: 'page' })).toMatchObject({ ok: true });
    caret(b, 2, 'Charlie'.length);
    expect(b.editor.exec({ type: 'insertBreak', kind: 'sectionContinuous' })).toMatchObject({
      ok: true,
    });
    sync(a, b);
    const both = ['Page break', 'Section break (continuous)'];
    await converged(a, b, both);

    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await converged(a, b, ['Section break (continuous)']);
    expect(a.editor.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await converged(a, b, both);

    // Bob deletes the break while Alice types in the same paragraph.
    const surface = b.editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    expect(
      surface.setSelection({
        anchor: { paragraphId, offset: 'Alpha'.length },
        head: { paragraphId, offset: 'Alpha'.length + 1 },
      })
    ).not.toBe(false);
    expect(surface.deleteSelection()).toBe(true);
    caret(a, 0, 0);
    expect(a.editor.exec({ type: 'insertText', text: 'Lead ' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b, ['Section break (continuous)']);

    rejoined = await peer('Rejoined', a);
    expect(await fingerprint(rejoined)).toBe(await fingerprint(a));
    expect(labels(rejoined)).toEqual(['Section break (continuous)']);
  } finally {
    rejoined?.destroy();
    a.destroy();
    b.destroy();
  }
});
