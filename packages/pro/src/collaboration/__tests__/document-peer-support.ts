/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two-replica store+port harness for write-replication tests.
//
// Each caller owns one instance so parallel files do not share the open-peer list.

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strToU8, zipSync } from 'fflate';
import {
  normalizeParagraphIdentity,
  readOoxmlPackage,
  TreePackageStore,
  type OoxmlNode,
  type OoxmlPackage,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration/replication';
import {
  createDocumentCollaboration,
  type DocumentCollaborationHandle,
} from '../document-session.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

export const BODY: StoryScope = { kind: 'body' };
export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const OD =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export function zipDocument(
  body: string,
  extra?: {
    readonly overrides?: string;
    readonly documentRels?: string;
    readonly extraXml?: Record<string, string>;
  }
): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (extra?.overrides ?? '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    ...(extra?.documentRels === undefined
      ? {}
      : { 'word/_rels/document.xml.rels': strToU8(extra.documentRels) }),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
    ...Object.fromEntries(
      Object.entries(extra?.extraXml ?? {}).map(([name, xml]) => [name, strToU8(xml)])
    ),
  });
}

export interface Peer {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  readonly room: DocumentCollaborationHandle;
  readonly store: TreePackageStore;
  readonly port: ReturnType<typeof createCollaborationDocumentPort>;
  readonly detach: () => void;
}

export function walk(node: OoxmlNode, visit: (node: OoxmlNode) => void): void {
  visit(node);
  if (node.kind === 'textValue') return;
  for (const child of node.children) walk(child, visit);
}

export function nodeText(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return node.children.map(nodeText).join('');
}

export function packageDivergence(left: OoxmlPackage, right: OoxmlPackage): string {
  const leftPrint = packageFingerprint(left);
  const rightPrint = packageFingerprint(right);
  const lines: string[] = [];
  const leftParts = new Map<string, string>();
  const rightParts = new Map<string, string>();
  for (const line of leftPrint.split('\n')) {
    const cut = line.indexOf(':');
    if (cut < 0) continue;
    leftParts.set(line.slice(0, cut), line.slice(cut + 1));
  }
  for (const line of rightPrint.split('\n')) {
    const cut = line.indexOf(':');
    if (cut < 0) continue;
    rightParts.set(line.slice(0, cut), line.slice(cut + 1));
  }
  const names = [...new Set([...leftParts.keys(), ...rightParts.keys()])].sort();
  for (const name of names) {
    const leftHash = leftParts.get(name);
    const rightHash = rightParts.get(name);
    if (leftHash === rightHash) continue;
    if (leftHash === undefined) lines.push(`part ${name} missing on left`);
    else if (rightHash === undefined) lines.push(`part ${name} missing on right`);
    else lines.push(`part ${name} fingerprint differs`);
  }
  const leftMain = left.parts.get(left.mainDocumentPart);
  const rightMain = right.parts.get(right.mainDocumentPart);
  if (leftMain && rightMain) {
    const leftTexts: string[] = [];
    const rightTexts: string[] = [];
    walk(leftMain.root, (node) => {
      if (node.kind === 'paragraph') leftTexts.push(nodeText(node));
    });
    walk(rightMain.root, (node) => {
      if (node.kind === 'paragraph') rightTexts.push(nodeText(node));
    });
    if (leftTexts.join('\n') !== rightTexts.join('\n')) {
      lines.push(
        `main paragraphs left=${JSON.stringify(leftTexts)} right=${JSON.stringify(rightTexts)}`
      );
    }
  }
  return lines.join('; ') || 'packages differ';
}

export function createPeerHarness(
  documentId: string,
  sessionOptions?: { readonly offlineEditing?: boolean }
): {
  readonly pair: (
    bytes: Uint8Array
  ) => Promise<{ alice: Peer; bob: Peer; pause: () => void; resume: () => void }>;
  readonly join: (host: Peer, name: string) => Promise<Peer>;
  readonly leave: (peer: Peer) => void;
  readonly remount: (peer: Peer) => Promise<Peer>;
  readonly apply: (peer: Peer, ops: readonly TreeDocOp[], scope?: StoryScope) => void;
  readonly packageOf: (peer: Peer) => OoxmlPackage;
  readonly expectConverged: (left: Peer, right: Peer) => void;
  readonly paragraphIdAt: (peer: Peer, index: number, scope?: StoryScope) => string;
  readonly cleanup: () => void;
} {
  const opened: Peer[] = [];
  const relays: (() => void)[] = [];
  const liveDocs = new Set<Y.Doc>();

  function storeFrom(bytes: Uint8Array): TreePackageStore {
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
    if (!main) throw new Error('no main part');
    return new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  }

  function attachPeer(ydoc: Y.Doc, awareness: Awareness, room: DocumentCollaborationHandle): Peer {
    const store = storeFrom(room.document);
    const port = createCollaborationDocumentPort(store, { documentId });
    const detach = room.session.attach(port);
    const peer: Peer = { ydoc, awareness, room, store, port, detach };
    opened.push(peer);
    liveDocs.add(ydoc);
    return peer;
  }

  async function createPeer(bytes: Uint8Array, name: string): Promise<Peer> {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const room = await createDocumentCollaboration({
      ydoc,
      awareness,
      documentId,
      identity: { actorId: name, name },
      bootstrap: { kind: 'create', document: bytes },
      ...sessionOptions,
    });
    return attachPeer(ydoc, awareness, room);
  }

  function relay(left: Peer, right: Peer): { pause: () => void; resume: () => void } {
    let paused = false;
    const held: { readonly target: Y.Doc; readonly update: Uint8Array }[] = [];
    const forward = (target: Y.Doc) => (update: Uint8Array, origin: unknown) => {
      if (origin === 'relay' || origin === 'join') return;
      if (!liveDocs.has(target)) return;
      if (paused) {
        held.push({ target, update });
        return;
      }
      Y.applyUpdate(target, update, 'relay');
    };
    const onLeft = forward(right.ydoc);
    const onRight = forward(left.ydoc);
    left.ydoc.on('update', onLeft);
    right.ydoc.on('update', onRight);
    relays.push(() => {
      left.ydoc.off('update', onLeft);
      right.ydoc.off('update', onRight);
    });
    return {
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
        for (const { target, update } of held.splice(0)) {
          if (liveDocs.has(target)) Y.applyUpdate(target, update, 'relay');
        }
      },
    };
  }

  function wireToOpened(peer: Peer): { pause: () => void; resume: () => void } {
    let controls = { pause: () => {}, resume: () => {} };
    for (const existing of opened) {
      if (existing === peer) continue;
      controls = relay(existing, peer);
    }
    return controls;
  }

  async function joinPeer(
    host: Peer,
    name: string
  ): Promise<{ peer: Peer; pause: () => void; resume: () => void }> {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc), 'join');
    const room = await createDocumentCollaboration({
      ydoc,
      awareness,
      documentId,
      identity: { actorId: name, name },
      bootstrap: { kind: 'join', timeoutMs: 5_000 },
      ...sessionOptions,
    });
    const peer = attachPeer(ydoc, awareness, room);
    return { peer, ...wireToOpened(peer) };
  }

  function dropOpened(peer: Peer): void {
    const index = opened.indexOf(peer);
    if (index >= 0) opened.splice(index, 1);
  }

  function leave(peer: Peer): void {
    liveDocs.delete(peer.ydoc);
    dropOpened(peer);
    peer.detach();
    peer.room.destroy();
    peer.awareness.destroy();
    peer.ydoc.destroy();
  }

  async function remount(peer: Peer): Promise<Peer> {
    const name = peer.room.session.identity.actorId;
    const ydoc = peer.ydoc;
    dropOpened(peer);
    peer.detach();
    peer.room.destroy();
    peer.awareness.destroy();
    const awareness = new Awareness(ydoc);
    const room = await createDocumentCollaboration({
      ydoc,
      awareness,
      documentId,
      identity: { actorId: name, name },
      bootstrap: { kind: 'join', timeoutMs: 5_000 },
    });
    return attachPeer(ydoc, awareness, room);
  }

  function packageOf(peer: Peer): OoxmlPackage {
    return peer.store.currentPackage();
  }

  function storyPart(peer: Peer, scope: StoryScope = BODY) {
    const part = peer.store.partFor(scope);
    if (!part) throw new Error('missing story part');
    return part;
  }

  return {
    async pair(bytes) {
      const alice = await createPeer(bytes, 'alice');
      const joined = await joinPeer(alice, 'bob');
      return { alice, bob: joined.peer, pause: joined.pause, resume: joined.resume };
    },
    async join(host, name) {
      const joined = await joinPeer(host, name);
      return joined.peer;
    },
    leave,
    remount,
    apply(peer, ops, scope = BODY) {
      const refusal = peer.room.session.gateOperations(ops, scope);
      if (refusal) throw new Error(`gate refused: ${refusal}`);
      const result = peer.store.transact(scope, (context) => {
        for (const op of ops) context.apply(op);
      });
      if (!result.ok) throw new Error(result.detail ?? result.reason);
      peer.port.flushPendingJournals();
    },
    packageOf,
    expectConverged(left, right) {
      const leftPkg = packageOf(left);
      const rightPkg = packageOf(right);
      if (packageFingerprint(rightPkg) !== packageFingerprint(leftPkg)) {
        throw new Error(`replicas did not converge: ${packageDivergence(leftPkg, rightPkg)}`);
      }
      const leftDigest = saveReopenDigest(leftPkg);
      const rightDigest = saveReopenDigest(rightPkg);
      if (JSON.stringify(leftDigest) !== JSON.stringify(rightDigest)) {
        throw new Error(
          `save/reopen digests did not converge: ${packageDivergence(leftPkg, rightPkg)}`
        );
      }
    },
    paragraphIdAt(peer, index, scope = BODY) {
      const paragraphs: string[] = [];
      walk(storyPart(peer, scope).root, (node) => {
        if (node.kind === 'paragraph') paragraphs.push(node.id);
      });
      const id = paragraphs[index];
      if (!id) throw new Error(`no paragraph at ${index}`);
      return id;
    },
    cleanup() {
      for (const stop of relays.splice(0)) stop();
      liveDocs.clear();
      for (const peer of opened.splice(0)) {
        peer.detach();
        peer.room.destroy();
        peer.awareness.destroy();
        peer.ydoc.destroy();
      }
    },
  };
}
