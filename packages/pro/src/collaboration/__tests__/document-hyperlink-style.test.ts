/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A new link in a collaboration session, in a document with no hyperlink character style.
//
// The editor adds the style to the existing styles part as document setup, outside shared
// undo. The peer must receive the style with the link, undo must take back the link and leave
// the style that other participants' links may use, a concurrent edit by the peer must
// converge, an offline link must arrive with its style on reconnect, and copies that
// participants add while apart must merge into one. A session never creates the styles part:
// two participants who each created it would leave the main part with two relationships.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { reviewModule } from '../../review/review-module.ts';
import type { OoxmlNode, OoxmlPackage } from '@docx-editor.dev/core/store';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
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
/** A document with no styles part. */
const BARE_SOURCE = zipDocument(
  '<w:p><w:r><w:t xml:space="preserve">Visit example today and tomorrow</w:t></w:r></w:p>' +
    '<w:sectPr/>'
);

/** The same body, with a styles part that has no hyperlink style: the usual case. */
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
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '</w:styles>',
    },
  }
);

/** The same body, with a styles part that already defines the hyperlink style. */
const HYPERLINK_SOURCE = zipDocument(
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

/** Whether the package has a styles part. */
function hasStylesPart(pkg: OoxmlPackage): boolean {
  for (const part of pkg.parts.values()) if (part.root.localName === 'styles') return true;
  return false;
}

function bodyText(pkg: OoxmlPackage): string {
  const texts: string[] = [];
  walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node: OoxmlNode) => {
    if (node.kind === 'textValue') texts.push(node.value);
  });
  return texts.join('');
}

async function editorWithPeer(source: Uint8Array = STYLED_SOURCE) {
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

describe('a new link adds the hyperlink style for every participant', () => {
  test('the peer receives the style with the link, and undo and redo follow', async () => {
    const ctx = await editorWithPeer();
    ctx.link(6, 13);
    await ctx.settle();
    const peerPkg = () => ctx.harness.packageOf(ctx.peer);
    expect(hyperlinkStyles(peerPkg())).toEqual(['Hyperlink']);
    expect(runStyles(peerPkg())).toEqual(['Hyperlink']);

    ctx.surface.undo();
    await ctx.settle();
    expect(linkCount(peerPkg())).toBe(0);
    expect(runStyles(peerPkg())).toEqual([]);
    // The style is document setup, outside undo: it stays for content made since.
    expect(hyperlinkStyles(peerPkg())).toEqual(['Hyperlink']);

    ctx.surface.redo();
    await ctx.settle();
    expect(hyperlinkStyles(peerPkg())).toEqual(['Hyperlink']);
    expect(runStyles(peerPkg())).toEqual(['Hyperlink']);
    ctx.harness.expectConverged(ctx.peer, await ctx.observer());
  });

  test('a peer that types while the link lands converges, with one style', async () => {
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
    expect(hyperlinkStyles(peerPkg)).toEqual(['Hyperlink']);
    expect(runStyles(peerPkg)).toEqual(['Hyperlink']);
    ctx.harness.expectConverged(ctx.peer, await ctx.observer());
  });

  test('a link made offline arrives with its style on reconnect', async () => {
    const ctx = await editorWithPeer();
    ctx.offline();
    ctx.link(6, 13);
    ctx.link(24, 32);
    await ctx.settle();
    expect(hyperlinkStyles(ctx.harness.packageOf(ctx.peer))).toEqual([]);
    ctx.reconnect();
    await ctx.settle();
    const peerPkg = ctx.harness.packageOf(ctx.peer);
    expect(hyperlinkStyles(peerPkg)).toEqual(['Hyperlink']);
    expect(runStyles(peerPkg)).toEqual(['Hyperlink', 'Hyperlink']);
    ctx.harness.expectConverged(ctx.peer, await ctx.observer());
  });

  test("a document's own hyperlink style is used, and no copy is added", async () => {
    const ctx = await editorWithPeer(HYPERLINK_SOURCE);
    ctx.link(6, 13);
    await ctx.settle();
    const peerPkg = ctx.harness.packageOf(ctx.peer);
    expect(runStyles(peerPkg)).toEqual(['Hyperlink']);
    expect(hyperlinkStyles(peerPkg)).toEqual(['Hyperlink']);
    ctx.harness.expectConverged(ctx.peer, await ctx.observer());
  });

  test('a document without a styles part gets no styles part and an unstyled link', async () => {
    const ctx = await editorWithPeer(BARE_SOURCE);
    ctx.link(6, 13);
    await ctx.settle();
    const peerPkg = ctx.harness.packageOf(ctx.peer);
    expect(linkCount(peerPkg)).toBe(1);
    expect(runStyles(peerPkg)).toEqual([]);
    expect(hasStylesPart(peerPkg)).toBe(false);
    ctx.harness.expectConverged(ctx.peer, await ctx.observer());
  });
});

describe('two editors in one room', () => {
  let room = 0;
  async function mountEditor(
    ydoc: Y.Doc,
    name: string,
    documentId: string,
    source: Uint8Array | null
  ) {
    const { createDocxEditor } = await import('@docx-editor.dev/core/editor');
    const session = await createDocumentCollaboration({
      ydoc,
      awareness: new Awareness(ydoc),
      documentId,
      identity: { actorId: name, name },
      bootstrap: source ? { kind: 'create', document: source } : { kind: 'join', timeoutMs: 5_000 },
    });
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: session.document,
      author: name,
      modules: [collaborationModule({ session: session.session }), reviewModule()],
    });
    cleanups.push(() => {
      editor.destroy();
      container.remove();
      session.destroy();
      ydoc.destroy();
    });
    return editor;
  }

  /** Two editors over `source`, connected through a relay that can hold updates back. */
  async function pair(source: Uint8Array) {
    const documentId = `${DOCUMENT_ID}-${(room += 1)}`;
    const leftDoc = new Y.Doc();
    const left = await mountEditor(leftDoc, 'left', documentId, source);
    const rightDoc = new Y.Doc();
    Y.applyUpdate(rightDoc, Y.encodeStateAsUpdate(leftDoc), 'relay');
    const right = await mountEditor(rightDoc, 'right', documentId, null);
    const held: [Y.Doc, Uint8Array][] = [];
    let online = true;
    const forward = (target: Y.Doc) => (update: Uint8Array, origin: unknown) => {
      if (origin === 'relay') return;
      if (online) Y.applyUpdate(target, update, 'relay');
      else held.push([target, update]);
    };
    leftDoc.on('update', forward(rightDoc));
    rightDoc.on('update', forward(leftDoc));
    /** Let timers run, so each editor takes in what it received and repairs the merge. */
    const settle = async () => {
      for (let round = 0; round < 5; round += 1) await new Promise((r) => setTimeout(r, 0));
    };
    return {
      left,
      right,
      settle,
      offline() {
        online = false;
      },
      async reconnect() {
        online = true;
        for (const [target, update] of held.splice(0)) Y.applyUpdate(target, update, 'relay');
        await settle();
      },
    };
  }

  const linkWith = (editor: DocxEditorInstance, start: number, end: number) => {
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: start },
      head: { paragraphId, offset: end },
    });
    expect(editor.exec({ type: 'insertHyperlink', href: 'https://example.com' }).ok).toBe(true);
  };

  for (const [label, source, styled] of [
    ['without a styles part', BARE_SOURCE, false],
    ['with a styles part', STYLED_SOURCE, true],
  ] as const) {
    test(`first links made while apart converge, ${label}`, async () => {
      const room = await pair(source);
      room.offline();
      linkWith(room.left, 6, 13);
      linkWith(room.right, 24, 32);
      await room.reconnect();
      for (const editor of [room.left, room.right]) {
        const pkg = editor.surface!.session.currentPackage();
        expect(linkCount(pkg)).toBe(2);
        expect(runStyles(pkg)).toEqual(styled ? ['Hyperlink', 'Hyperlink'] : []);
        expect(hyperlinkStyles(pkg)).toEqual(styled ? ['Hyperlink'] : []);
        expect(hasStylesPart(pkg)).toBe(styled);
        expect(bodyText(pkg)).toBe('Visit example today and tomorrow');
      }
    });
  }

  {
    test('undo of the first link keeps the style a later link uses', async () => {
      const room = await pair(STYLED_SOURCE);
      linkWith(room.left, 6, 13);
      await room.settle();
      linkWith(room.right, 24, 32);
      await room.settle();
      expect(room.left.exec({ type: 'undo' }).ok).toBe(true);
      await room.settle();
      // Undo everything the left editor did: the style is no step of its own.
      while (room.left.exec({ type: 'undo' }).ok) await room.settle();
      for (const editor of [room.left, room.right]) {
        const pkg = editor.surface!.session.currentPackage();
        expect(runStyles(pkg)).toEqual(['Hyperlink']);
        expect(hyperlinkStyles(pkg)).toEqual(['Hyperlink']);
      }
      // Redo brings the first link back, with no second style.
      while (room.left.exec({ type: 'redo' }).ok) await room.settle();
      const pkg = room.right.surface!.session.currentPackage();
      expect(runStyles(pkg)).toEqual(['Hyperlink', 'Hyperlink']);
      expect(hyperlinkStyles(pkg)).toEqual(['Hyperlink']);
    });
  }
});
