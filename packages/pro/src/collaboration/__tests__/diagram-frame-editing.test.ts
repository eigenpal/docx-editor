/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// DrawingML diagram frame edits in two collaborating editors: a resize (with its rescaled
// saved drawing part) and an inline move reach the other participant, converge with
// concurrent typing, travel through undo and redo, survive a deletion while the other
// participant resizes, and reach a participant that joins afterward.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { moveInlineImage } from '../../../../core/src/editor/inline-image-drag.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import {
  simpleTextBody,
  smartArtDocx,
} from '../../../../core/src/store/__tests__/smartart-fixture.ts';

const FIXTURE = smartArtDocx({
  shapes: [{ off: [100_000, 200_000], ext: [1_000_000, 500_000], txBody: simpleTextBody('Plan') }],
  extent: [2_000_000, 1_000_000],
  leadingParagraphs: 1,
});
const DRAWING_PART = '/word/diagrams/drawing1.xml';

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc(),
    awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'diagram-frame-editing',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: FIXTURE },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    modules: [collaborationModule({ session: room.session })],
  });
  return {
    ydoc,
    editor: editor as DocxEditorInstance,
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

async function saved(client: Peer): Promise<OoxmlPackage> {
  const loaded = readOoxmlPackage(new Uint8Array(await client.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

/** Both saved files have the same main part and the same saved diagram drawing. */
async function converged(a: Peer, b: Peer): Promise<OoxmlPackage> {
  const [left, right] = [await saved(a), await saved(b)];
  expect(canonicalOoxmlFingerprint(left.parts.get(left.mainDocumentPart)!)).toBe(
    canonicalOoxmlFingerprint(right.parts.get(right.mainDocumentPart)!)
  );
  const [l, r] = [left.parts.get(DRAWING_PART), right.parts.get(DRAWING_PART)];
  expect(l && canonicalOoxmlFingerprint(l)).toBe(r && canonicalOoxmlFingerprint(r));
  return left;
}

type Node = { kind: string; id: string; localName?: string; children?: readonly Node[] };
type Attr = { localName: string; namespaceUri: string; value: string };

function walk(node: Node, match: (node: Node) => boolean): Node[] {
  if (node.kind === 'textValue') return [];
  return [
    ...(match(node) ? [node] : []),
    ...(node.children ?? []).flatMap((kid) => walk(kid, match)),
  ];
}

const value = (node: Node | undefined, name: string) =>
  ((node as unknown as { attributes?: Attr[] })?.attributes ?? []).find(
    (a) => a.localName === name && a.namespaceUri === ''
  )?.value;

function diagramId(client: Peer): string {
  const part = client.editor.surface!.session.currentPackage().parts.get('/word/document.xml')!;
  const id = walk(part.root as unknown as Node, (node) => node.kind === 'drawing')[0]?.id;
  if (!id) throw new Error('no diagram drawing');
  return id;
}

/** The frame width in the story part and the first saved shape width. */
function widths(pkg: OoxmlPackage) {
  const frame = walk(pkg.parts.get('/word/document.xml')!.root as unknown as Node, (n) => {
    return n.localName === 'extent';
  })[0];
  const shape = walk(pkg.parts.get(DRAWING_PART)!.root as unknown as Node, (n) => {
    return n.localName === 'ext';
  })[0];
  return [value(frame, 'cx'), value(shape, 'cx')];
}

function selectDiagram(client: Peer): string {
  const surface = client.editor.surface!;
  const id = diagramId(client);
  const paragraphs = surface.session.paragraphIds();
  surface.selectDrawing(id, paragraphs[1]!);
  return id;
}

function caretAt(client: Peer, paragraph: number, offset: number) {
  const id = client.editor.surface!.session.paragraphIds()[paragraph]!;
  client.editor.surface!.setSelection({
    anchor: { paragraphId: id, offset },
    head: { paragraphId: id, offset },
  });
}

test('a diagram resize and move converge, undo, redo, and reach a joining editor', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let joined: Peer | undefined;
  try {
    selectDiagram(a);
    const resized = a.editor.exec({
      type: 'setImageProperties',
      widthEmu: 2_600_000,
      heightEmu: 700_000,
    });
    expect(resized.ok).toBe(true);
    caretAt(b, 0, 0);
    expect(b.editor.exec({ type: 'insertText', text: 'B ' })).toMatchObject({ changed: true });
    sync(a, b);
    expect(widths(await converged(a, b))).toEqual(['2600000', '1300000']);

    // Bob moves the diagram into the first paragraph while Alice types after it.
    const surface = b.editor.surface!;
    const target = surface.session.paragraphIds()[0]!;
    const moved = moveInlineImage(
      surface,
      diagramId(b),
      { paragraphId: target, offset: 2 },
      surface.session.packageRevision()
    );
    expect(moved.committed).toBe(true);
    caretAt(a, 0, 6);
    expect(a.editor.exec({ type: 'insertText', text: 'A' })).toMatchObject({ changed: true });
    sync(a, b);
    await converged(a, b);

    // Undo of the resize travels to Bob, and redo brings it back.
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    expect(widths(await converged(a, b))).toEqual(['2000000', '1000000']);
    expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
    sync(a, b);
    expect(widths(await converged(a, b))).toEqual(['2600000', '1300000']);

    joined = await peer('Carol', a);
    expect(widths(await saved(joined))).toEqual(['2600000', '1300000']);
  } finally {
    joined?.destroy();
    b.destroy();
    a.destroy();
  }
});

test('deleting a diagram while the other editor resizes it converges', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  try {
    selectDiagram(a);
    selectDiagram(b);
    expect(a.editor.exec({ type: 'deleteImage' }).ok).toBe(true);
    expect(
      b.editor.exec({ type: 'setImageProperties', widthEmu: 1_000_000, heightEmu: 500_000 }).ok
    ).toBe(true);
    sync(a, b);
    await converged(a, b);
  } finally {
    b.destroy();
    a.destroy();
  }
});
