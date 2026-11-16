/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The line spacing rule between participants.
//
// `Paragraph.lineSpacingRule` rewrites the paragraph's own `w:spacing`. Two editors drive it
// through the automation object model on real collaboration sessions. Every case checks that the
// replicas converge and the result survives a save and reopen.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor, type Paragraph } from '@docx-editor.dev/editor-api/browser';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { zipDocument } from './document-peer-support.ts';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const fixture = zipDocument(`${p('First')}${p('Second')}${p('Third')}<w:sectPr/>`);

const peers: { destroy(): void }[] = [];
afterEach(() => {
  for (const peer of peers.splice(0)) peer.destroy();
});

async function editorPeer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'line-spacing-rule',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: fixture },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    modules: [collaborationModule({ session: room.session })],
    author: name,
  });
  const runtime = DocxEditor.createBrowser(editor, { author: name });
  const created = {
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
  peers.push(created);
  return created;
}
type EditorPeer = Awaited<ReturnType<typeof editorPeer>>;

function sync(a: EditorPeer, b: EditorPeer) {
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)), 'relay');
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc)), 'relay');
}

async function converged(a: EditorPeer, b: EditorPeer) {
  const main = async (peer: EditorPeer) => {
    const loaded = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
    if (!loaded.ok) throw new Error(loaded.reason);
    return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  };
  expect(canonicalOoxmlFingerprint(await main(a))).toBe(canonicalOoxmlFingerprint(await main(b)));
}

/** Each paragraph's rule and points, in body order. */
async function spacing(peer: EditorPeer): Promise<[string, number | null][]> {
  return peer.runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/lineSpacingRule,items/lineSpacing');
    await context.sync();
    return paragraphs.items.map(
      (paragraph) => [paragraph.lineSpacingRule, paragraph.lineSpacing] as [string, number | null]
    );
  });
}

async function edit(
  peer: EditorPeer,
  index: number,
  write: (paragraph: Paragraph) => void
): Promise<void> {
  await peer.runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    write(paragraphs.items[index]!);
    await context.sync();
  });
}

describe('the line spacing rule between two editors', () => {
  test('a rule replicates, undoes, redoes, and survives a reopen', async () => {
    const alice = await editorPeer('Alice');
    const bob = await editorPeer('Bob', alice);
    await edit(alice, 0, (paragraph) => {
      paragraph.lineSpacingRule = 'Exactly';
      paragraph.lineSpacing = 14;
    });
    sync(alice, bob);
    expect((await spacing(bob))[0]).toEqual(['Exactly', 14]);
    await converged(alice, bob);

    expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(alice, bob);
    expect((await spacing(bob))[0]![0]).toBe('Single');
    expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
    sync(alice, bob);
    expect((await spacing(bob))[0]).toEqual(['Exactly', 14]);
    await converged(alice, bob);

    const reopened = await DocxEditor.createServer(new Uint8Array(await bob.editor.save()));
    const read = await reopened.run(async (context) => {
      const first = context.document.body.paragraphs.getFirst();
      first.load('lineSpacingRule,lineSpacing');
      await context.sync();
      return [first.lineSpacingRule, first.lineSpacing];
    });
    expect(read).toEqual(['Exactly', 14]);
    reopened.dispose();
  });

  test('concurrent rules on different paragraphs both apply', async () => {
    const alice = await editorPeer('Alice');
    const bob = await editorPeer('Bob', alice);
    await edit(alice, 0, (paragraph) => (paragraph.lineSpacingRule = 'Double'));
    await edit(bob, 1, (paragraph) => (paragraph.lineSpacingRule = 'AtLeast'));
    sync(alice, bob);
    const read = await spacing(alice);
    expect(read[0]).toEqual(['Double', 24]);
    expect(read[1]).toEqual(['AtLeast', 12]);
    expect(await spacing(bob)).toEqual(read);
    await converged(alice, bob);
  });

  test('concurrent rules on one paragraph converge on one of them', async () => {
    const alice = await editorPeer('Alice');
    const bob = await editorPeer('Bob', alice);
    await edit(alice, 2, (paragraph) => (paragraph.lineSpacingRule = 'Exactly'));
    await edit(bob, 2, (paragraph) => (paragraph.lineSpacingRule = 'OnePointFive'));
    sync(alice, bob);
    const read = (await spacing(alice))[2]![0];
    expect(['Exactly', 'OnePointFive']).toContain(read);
    expect((await spacing(bob))[2]![0]).toBe(read);
    await converged(alice, bob);
  });

  test('a rule on a paragraph the other participant deletes converges', async () => {
    const alice = await editorPeer('Alice');
    const bob = await editorPeer('Bob', alice);
    await edit(alice, 1, (paragraph) => (paragraph.lineSpacingRule = 'Exactly'));
    await edit(bob, 1, (paragraph) => paragraph.delete());
    sync(alice, bob);
    expect(await spacing(alice)).toEqual(await spacing(bob));
    await converged(alice, bob);
  });
});
