/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Paragraph borders between participants.
//
// A border write replaces the paragraph's own `w:pBdr`. Two editors drive it through the automation
// object model on real collaboration sessions; peer stores drive the op directly where a test needs
// both writes held back at once. Every case checks that the room stays ready, the replicas converge,
// and the result survives a save and reopen.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  type OoxmlNode,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer as StorePeer } from './document-peer-support.ts';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const fixture = zipDocument(`${p('First')}${p('Second')}<w:sectPr/>`);

const peers: { destroy(): void }[] = [];
const harness = createPeerHarness('paragraph-borders-room');
afterEach(() => {
  for (const peer of peers.splice(0)) peer.destroy();
  harness.cleanup();
});

async function editorPeer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'paragraph-borders-editors',
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
  const created = {
    ydoc,
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
  peers.push(created);
  return created;
}
type EditorPeer = Awaited<ReturnType<typeof editorPeer>>;

function sync(a: EditorPeer, b: EditorPeer) {
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)), 'relay');
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc)), 'relay');
}

async function savedXml(peer: EditorPeer): Promise<string> {
  return strFromU8(unzipSync(new Uint8Array(await peer.editor.save()))['word/document.xml']!);
}

async function converged(a: EditorPeer, b: EditorPeer) {
  const main = async (peer: EditorPeer) => {
    const loaded = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
    if (!loaded.ok) throw new Error(loaded.reason);
    return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  };
  expect(canonicalOoxmlFingerprint(await main(a))).toBe(canonicalOoxmlFingerprint(await main(b)));
}

/** The line styles one paragraph's borders read, in collection order. */
async function lineStyles(peer: EditorPeer, index: number): Promise<unknown[]> {
  return peer.runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    const borders = paragraphs.items[index]!.borders;
    borders.load('items/lineStyle');
    await context.sync();
    return borders.items.map((border) => border.lineStyle);
  });
}

async function setBorder(
  peer: EditorPeer,
  index: number,
  edge: number,
  lineStyle: 'Single' | 'Double' | 'None'
): Promise<void> {
  await peer.runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    const borders = paragraphs.items[index]!.borders;
    borders.load('items');
    await context.sync();
    borders.items[edge]!.lineStyle = lineStyle;
    await context.sync();
  });
}

describe('paragraph borders between two editors', () => {
  test('a border replicates, paints on the other page, undoes, redoes, and saves', async () => {
    const alice = await editorPeer('Alice');
    const bob = await editorPeer('Bob', alice);
    await setBorder(alice, 0, 2, 'Double');
    sync(alice, bob);
    expect(await lineStyles(bob, 0)).toEqual(['None', 'None', 'Double', 'None', 'None']);
    expect(bob.container.querySelector('.docx-paragraph-border-bottom')).not.toBeNull();
    expect(await savedXml(bob)).toContain(
      '<w:bottom w:color="auto" w:space="1" w:sz="4" w:val="double"/>'
    );
    await converged(alice, bob);

    expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(alice, bob);
    expect(await lineStyles(bob, 0)).toEqual(['None', 'None', 'None', 'None', 'None']);
    expect(bob.container.querySelector('.docx-paragraph-border-bottom')).toBeNull();
    expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
    sync(alice, bob);
    expect(await lineStyles(bob, 0)).toEqual(['None', 'None', 'Double', 'None', 'None']);
    await converged(alice, bob);

    const reopened = await DocxEditor.createServer(new Uint8Array(await bob.editor.save()));
    const read = await reopened.run(async (context) => {
      const first = context.document.body.paragraphs.getFirst();
      first.borders.load('items/lineStyle');
      await context.sync();
      return first.borders.items[2]!.lineStyle;
    });
    expect(read).toBe('Double');
    reopened.dispose();
  });

  test('concurrent borders on different paragraphs both apply', async () => {
    const alice = await editorPeer('Alice');
    const bob = await editorPeer('Bob', alice);
    await setBorder(alice, 0, 0, 'Single');
    await setBorder(bob, 1, 2, 'Double');
    sync(alice, bob);
    expect(await lineStyles(alice, 1)).toEqual(['None', 'None', 'Double', 'None', 'None']);
    expect(await lineStyles(bob, 0)).toEqual(['Single', 'None', 'None', 'None', 'None']);
    await converged(alice, bob);
  });

  test('a suggested border replicates and the other participant can reject it', async () => {
    const alice = await editorPeer('Alice');
    const bob = await editorPeer('Bob', alice);
    await alice.runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      const first = context.document.body.paragraphs.getFirst();
      first.borders.load('items');
      await context.sync();
      first.borders.items[0]!.lineStyle = 'Single';
      await context.sync();
    });
    sync(alice, bob);
    const suggested = await savedXml(bob);
    expect(suggested).toContain('<w:pPrChange w:author="Alice"');
    await bob.runtime.run(async (context) => {
      context.document.body.revisions.rejectAll();
      await context.sync();
    });
    sync(alice, bob);
    expect(await lineStyles(alice, 0)).toEqual(['None', 'None', 'None', 'None', 'None']);
    const rejected = await savedXml(alice);
    expect(rejected).not.toContain('pBdr');
    expect(rejected).not.toContain('pPrChange');
    await converged(alice, bob);
  });

  test('a border on a paragraph the other participant deletes leaves both rooms in step', async () => {
    const alice = await editorPeer('Alice');
    const bob = await editorPeer('Bob', alice);
    await setBorder(alice, 0, 2, 'Single');
    await bob.runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().delete();
      await context.sync();
    });
    sync(alice, bob);
    await converged(alice, bob);
    expect(await savedXml(alice)).toContain('Second');
  });
});

/** One paragraph's own `w:pBdr` children as `edge:val`, or null without one. */
function borderEdges(peer: StorePeer, index = 0): string[] | null {
  const paragraphId = harness.paragraphIdAt(peer, index);
  let found: OoxmlNode | null = null;
  const walk = (node: OoxmlNode): void => {
    if (found || node.kind === 'textValue') return;
    if (node.id === paragraphId) found = node;
    else node.children.forEach(walk);
  };
  walk(peer.store.bodyStore().part.root);
  const paragraph = found as OoxmlNode | null;
  if (!paragraph || paragraph.kind === 'textValue') return null;
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  if (!pPr || pPr.kind === 'textValue') return null;
  const pBdrs = pPr.children.filter(
    (child) => child.kind !== 'textValue' && child.localName === 'pBdr'
  );
  // Never two: a merged replica keeps one copy of an element the schema allows once.
  expect(pBdrs.length).toBeLessThanOrEqual(1);
  const pBdr = pBdrs[0];
  if (!pBdr || pBdr.kind === 'textValue') return null;
  return pBdr.children.flatMap((child) =>
    child.kind === 'textValue'
      ? []
      : [`${child.localName}:${child.attributes.find((a) => a.localName === 'val')?.value}`]
  );
}

function bordersOp(peer: StorePeer, edge: 'top' | 'bottom', val: string): TreeDocOp {
  return {
    op: 'setParagraphBorders',
    paragraphId: harness.paragraphIdAt(peer, 0),
    edges: [{ edge, attributes: { val, sz: '4', space: '1', color: 'auto' } }],
  };
}

function expectHealthy(...room: StorePeer[]) {
  for (const peer of room) expect(peer.room.session.status()).toBe('ready');
  for (const peer of room.slice(1)) harness.expectConverged(room[0]!, peer);
}

const PLAIN = zipDocument('<w:p><w:r><w:t>Bordered</w:t></w:r></w:p><w:sectPr/>');
const STYLED = zipDocument(
  '<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>Bordered</w:t></w:r></w:p><w:sectPr/>'
);

describe('concurrent paragraph borders', () => {
  test('two offline borders on one paragraph converge on one element after reconnecting', async () => {
    const { alice, bob, pause, resume } = await harness.pair(PLAIN);
    pause();
    harness.apply(alice, [bordersOp(alice, 'top', 'single')]);
    harness.apply(bob, [bordersOp(bob, 'bottom', 'double')]);
    resume();
    expectHealthy(alice, bob);
    const merged = borderEdges(alice);
    expect([['top:single'], ['bottom:double']]).toContainEqual(merged ?? []);
    expect(borderEdges(bob)).toEqual(merged);
    const late = await harness.join(bob, 'late');
    expectHealthy(alice, bob, late);
    expect(borderEdges(late)).toEqual(merged);
  });

  test('a border and an alignment on one paragraph both apply', async () => {
    const { alice, bob, pause, resume } = await harness.pair(STYLED);
    pause();
    harness.apply(alice, [bordersOp(alice, 'bottom', 'single')]);
    harness.apply(bob, [
      {
        op: 'setParagraphProperties',
        paragraphId: harness.paragraphIdAt(bob, 0),
        properties: [{ localName: 'jc', attributes: { val: 'center' } }],
      },
    ]);
    resume();
    expectHealthy(alice, bob);
    expect(borderEdges(bob)).toEqual(['bottom:single']);
  });

  test('the losing author can write again and undo', async () => {
    const { alice, bob, pause, resume } = await harness.pair(PLAIN);
    pause();
    harness.apply(alice, [bordersOp(alice, 'top', 'single')]);
    harness.apply(bob, [bordersOp(bob, 'bottom', 'double')]);
    resume();
    const loser = borderEdges(alice)?.[0] === 'top:single' ? bob : alice;
    const other = loser === alice ? bob : alice;
    harness.apply(loser, [bordersOp(loser, 'top', 'triple')]);
    expectHealthy(alice, bob);
    expect(borderEdges(other)).toEqual(['top:triple']);
    expect(loser.room.session.undo()).toBe(true);
    expectHealthy(alice, bob);
    expect(borderEdges(other)).toEqual(borderEdges(loser));
  });

  test('removing the border on one replica removes it everywhere', async () => {
    const { alice, bob } = await harness.pair(PLAIN);
    harness.apply(alice, [bordersOp(alice, 'bottom', 'single')]);
    expectHealthy(alice, bob);
    harness.apply(bob, [
      { op: 'setParagraphBorders', paragraphId: harness.paragraphIdAt(bob, 0), edges: [] },
    ]);
    expectHealthy(alice, bob);
    expect(borderEdges(alice)).toBeNull();
    const remounted = await harness.remount(alice);
    expectHealthy(remounted, bob);
    expect(borderEdges(remounted)).toBeNull();
  });
});
