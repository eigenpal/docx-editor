/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A new link in a collaboration session, between an editor and a peer.
//
// In a session the editor never adds the hyperlink character style to the document: one
// participant's undo would take the definition from links other participants made since, and
// participants who add it while apart would each add a copy. A document without the style
// gets links without it; a document with the style gets links that use it. Either way the
// link syncs, undo and redo follow, and concurrent and offline edits converge.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { reviewModule } from '../../review/review-module.ts';
import type { OoxmlNode, OoxmlPackage } from '@docx-editor.dev/core/store';
import { createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});

const DOCUMENT_ID = 'hyperlink-style-room';
const SOURCE = zipDocument(
  '<w:p><w:r><w:t xml:space="preserve">Visit example today and tomorrow</w:t></w:r></w:p>' +
    '<w:sectPr/>'
);

/** The same body, with a styles part that defines the hyperlink character style. */
const STYLED_SOURCE = zipDocument(
  '<w:p><w:r><w:t xml:space="preserve">Visit example today and tomorrow</w:t></w:r></w:p>' +
    '<w:sectPr/>',
  {
    overrides:
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    documentRels:
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
    extraXml: {
      'word/styles.xml':
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>' +
        '<w:rPr><w:u w:val="single"/></w:rPr></w:style></w:styles>',
    },
  }
);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** Character style ids whose id is `Hyperlink`, in a package's styles part. */
function hyperlinkStyles(pkg: OoxmlPackage): string[] {
  const ids: string[] = [];
  for (const part of pkg.parts.values()) {
    if (part.root.localName !== 'styles') continue;
    walk(part.root, (node: OoxmlNode) => {
      if (node.kind === 'textValue' || node.localName !== 'style') return;
      const id = node.attributes.find((a) => a.localName === 'styleId')?.value;
      if (id === 'Hyperlink') ids.push(id);
    });
  }
  return ids;
}

/** `w:rStyle` values in the main document part. */
function runStyles(pkg: OoxmlPackage): string[] {
  const values: string[] = [];
  walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node: OoxmlNode) => {
    if (node.kind === 'textValue' || node.localName !== 'rStyle') return;
    values.push(node.attributes.find((a) => a.localName === 'val')?.value ?? '');
  });
  return values;
}

/** Number of `w:hyperlink` elements in the main document part. */
function linkCount(pkg: OoxmlPackage): number {
  let count = 0;
  walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node: OoxmlNode) => {
    if (node.kind !== 'textValue' && node.localName === 'hyperlink') count += 1;
  });
  return count;
}

function bodyText(pkg: OoxmlPackage): string {
  const texts: string[] = [];
  walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node: OoxmlNode) => {
    if (node.kind === 'textValue') texts.push(node.value);
  });
  return texts.join('');
}

async function editorWithPeer(source: Uint8Array = SOURCE) {
  const { createDocxEditor } = await import('@docx-editor.dev/core/editor');
  const harness = createPeerHarness(DOCUMENT_ID);
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: DOCUMENT_ID,
    identity: { actorId: 'editor-user', name: 'Editor user' },
    bootstrap: { kind: 'create', document: source },
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

  let online = true;
  const queued: [Y.Doc, Uint8Array][] = [];
  const forward = (target: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (origin === 'relay') return;
    if (online) Y.applyUpdate(target, update, 'relay');
    else queued.push([target, update]);
  };
  ydoc.on('update', forward(peer.ydoc));
  peer.ydoc.on('update', forward(ydoc));

  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const link = (start: number, end: number) => {
    surface.setSelection({
      anchor: { paragraphId, offset: start },
      head: { paragraphId, offset: end },
    });
    const result = editor.exec({ type: 'insertHyperlink', href: 'https://example.com' });
    if (!result.ok) throw new Error(`link refused: ${JSON.stringify(result)}`);
  };
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
    peer,
    harness,
    link,
    settle,
    observer,
    offline() {
      online = false;
    },
    reconnect() {
      online = true;
      for (const [target, update] of queued.splice(0)) Y.applyUpdate(target, update, 'relay');
    },
  };
}

describe('a new link in a session', () => {
  test('syncs without adding the style, and undo and redo follow', async () => {
    const ctx = await editorWithPeer();
    ctx.link(6, 13);
    await ctx.settle();
    const peerPkg = () => ctx.harness.packageOf(ctx.peer);
    expect(linkCount(peerPkg())).toBe(1);
    expect(hyperlinkStyles(peerPkg())).toEqual([]);
    expect(runStyles(peerPkg())).toEqual([]);

    ctx.surface.undo();
    await ctx.settle();
    expect(linkCount(peerPkg())).toBe(0);

    ctx.surface.redo();
    await ctx.settle();
    expect(linkCount(peerPkg())).toBe(1);
    expect(hyperlinkStyles(peerPkg())).toEqual([]);
    ctx.harness.expectConverged(ctx.peer, await ctx.observer());
  });

  test("uses the document's own hyperlink style", async () => {
    const ctx = await editorWithPeer(STYLED_SOURCE);
    ctx.link(6, 13);
    await ctx.settle();
    const peerPkg = ctx.harness.packageOf(ctx.peer);
    expect(runStyles(peerPkg)).toEqual(['Hyperlink']);
    expect(hyperlinkStyles(peerPkg)).toEqual(['Hyperlink']);
    ctx.harness.expectConverged(ctx.peer, await ctx.observer());
  });

  test('converges with a peer that types while the link lands', async () => {
    const ctx = await editorWithPeer();
    const peerParagraph = ctx.harness.paragraphIdAt(ctx.peer, 0);
    const typed = ctx.peer.store.transact({ kind: 'body' }, (context) => {
      context.apply({ op: 'insertText', paragraphId: peerParagraph, offset: 32, text: '!' });
    });
    expect(typed.ok).toBe(true);
    ctx.peer.port.flushPendingJournals();
    ctx.link(24, 32);
    await ctx.settle();
    const peerPkg = ctx.harness.packageOf(ctx.peer);
    expect(bodyText(peerPkg)).toBe('Visit example today and tomorrow!');
    expect(linkCount(peerPkg)).toBe(1);
    expect(hyperlinkStyles(peerPkg)).toEqual([]);
    ctx.harness.expectConverged(ctx.peer, await ctx.observer());
  });

  test('made offline, arrives on reconnect', async () => {
    const ctx = await editorWithPeer();
    ctx.offline();
    ctx.link(6, 13);
    ctx.link(24, 32);
    await ctx.settle();
    expect(linkCount(ctx.harness.packageOf(ctx.peer))).toBe(0);
    ctx.reconnect();
    await ctx.settle();
    const peerPkg = ctx.harness.packageOf(ctx.peer);
    expect(linkCount(peerPkg)).toBe(2);
    expect(hyperlinkStyles(peerPkg)).toEqual([]);
    ctx.harness.expectConverged(ctx.peer, await ctx.observer());
  });
});

describe('two editors that both add the first link while apart', () => {
  async function mountEditor(ydoc: Y.Doc, name: string, bootstrap: 'create' | 'join') {
    const { createDocxEditor } = await import('@docx-editor.dev/core/editor');
    const room = await createDocumentCollaboration({
      ydoc,
      awareness: new Awareness(ydoc),
      documentId: DOCUMENT_ID,
      identity: { actorId: name, name },
      bootstrap:
        bootstrap === 'create'
          ? { kind: 'create', document: SOURCE }
          : { kind: 'join', timeoutMs: 5_000 },
    });
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: room.document,
      author: name,
      modules: [collaborationModule({ session: room.session }), reviewModule()],
    });
    cleanups.push(() => {
      editor.destroy();
      container.remove();
      room.destroy();
      ydoc.destroy();
    });
    return editor;
  }

  test('the replicas converge on one link each, and neither adds a style', async () => {
    const leftDoc = new Y.Doc();
    const left = await mountEditor(leftDoc, 'left', 'create');
    const rightDoc = new Y.Doc();
    Y.applyUpdate(rightDoc, Y.encodeStateAsUpdate(leftDoc), 'relay');
    const right = await mountEditor(rightDoc, 'right', 'join');

    const held: [Y.Doc, Uint8Array][] = [];
    let online = false;
    const forward = (target: Y.Doc) => (update: Uint8Array, origin: unknown) => {
      if (origin === 'relay') return;
      if (online) Y.applyUpdate(target, update, 'relay');
      else held.push([target, update]);
    };
    leftDoc.on('update', forward(rightDoc));
    rightDoc.on('update', forward(leftDoc));

    const linkWith = (editor: typeof left, start: number, end: number) => {
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: start },
        head: { paragraphId, offset: end },
      });
      expect(editor.exec({ type: 'insertHyperlink', href: 'https://example.com' }).ok).toBe(true);
    };
    linkWith(left, 6, 13);
    linkWith(right, 24, 32);

    online = true;
    for (const [target, update] of held.splice(0)) Y.applyUpdate(target, update, 'relay');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const leftPkg = left.surface!.session.currentPackage();
    const rightPkg = right.surface!.session.currentPackage();
    for (const pkg of [leftPkg, rightPkg]) {
      expect(linkCount(pkg)).toBe(2);
      expect(runStyles(pkg)).toEqual([]);
      expect(hyperlinkStyles(pkg)).toEqual([]);
      expect(bodyText(pkg)).toBe('Visit example today and tomorrow');
    }
  });
});
