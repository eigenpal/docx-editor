/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A collaboration room where a reviewer edits beside or inside a counterparty's pending
// changes, with the oracles the tests of those edits share: convergence, what each peer
// shows, and what the saved document decides to.
import { expect } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
import {
  DocxEditor,
  type DocxEditorRuntime,
  type Range,
  type RequestContext,
} from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support';

export const REVIEWER = 'Avery Chen';
export const COUNTERPARTY = 'Tailspin Legal';
export const PROPOSED = 'thirty (30) days of receipt';
export const REVISED = 'forty-five (45) days of receipt';
const DATE = 'w:date="2026-09-01T00:00:00Z"';

/** The counterparty proposed inserting `PROPOSED`. */
export const BODY =
  '<w:p><w:r><w:t xml:space="preserve">Payment is due within </w:t></w:r>' +
  `<w:ins w:id="7" w:author="${COUNTERPARTY}" ${DATE}>` +
  `<w:r><w:t>${PROPOSED}</w:t></w:r></w:ins><w:r><w:t>.</w:t></w:r></w:p>` +
  '<w:p><w:r><w:t>Second clause.</w:t></w:r></w:p>';

/** The counterparty replaced "sixty days" with their insertion. */
export const REPLACED =
  '<w:p><w:r><w:t xml:space="preserve">Payment is due within </w:t></w:r>' +
  `<w:del w:id="6" w:author="${COUNTERPARTY}" ${DATE}>` +
  '<w:r><w:delText xml:space="preserve">sixty days </w:delText></w:r></w:del>' +
  `<w:ins w:id="7" w:author="${COUNTERPARTY}" ${DATE}>` +
  `<w:r><w:t>${PROPOSED}</w:t></w:r></w:ins><w:r><w:t>.</w:t></w:r></w:p>` +
  '<w:p><w:r><w:t>Second clause.</w:t></w:r></w:p>';

/** The counterparty proposed deleting `PROPOSED`. */
export const STRUCK =
  '<w:p><w:r><w:t xml:space="preserve">Payment is due within </w:t></w:r>' +
  `<w:del w:id="7" w:author="${COUNTERPARTY}" ${DATE}>` +
  `<w:r><w:delText>${PROPOSED}</w:delText></w:r></w:del><w:r><w:t>.</w:t></w:r></w:p>` +
  '<w:p><w:r><w:t>Second clause.</w:t></w:r></w:p>';

/** Concurrent inserts at one position order by client id; tests run both orders. */
export const ORDERS = {
  'reviewer first': { alice: 1, bob: 2 },
  'counterparty first': { alice: 2, bob: 1 },
};
export type Order = keyof typeof ORDERS;

export async function room(order: Order = 'reviewer first', body = BODY) {
  const harness = createPeerHarness(
    'tracked-foreign-revisions',
    { offlineEditing: true },
    ORDERS[order]
  );
  const pair = await harness.pair(zipDocument(body));
  const mount = (peer: Peer, author: string) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      author,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    const runtime = DocxEditor.createBrowser(editor, { author, revisionTextView: 'allMarkup' });
    return {
      peer,
      editor,
      runtime,
      close() {
        runtime.dispose();
        editor.destroy();
        container.remove();
      },
    };
  };
  const peers = [mount(pair.alice, REVIEWER), mount(pair.bob, COUNTERPARTY)];
  return {
    pair,
    harness,
    peers,
    mount,
    sync() {
      for (const { peer } of peers) peer.room.session.flushPendingJournals();
    },
    close() {
      for (const peer of peers) peer.close();
      harness.cleanup();
    },
  };
}
export type Room = Awaited<ReturnType<typeof room>>;
export type Edit = (c: RequestContext) => Promise<void>;

async function mainOf(bytes: Uint8Array) {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
}

/** Both replicas are ready and hold the same canonical tree. Answers its fingerprint. */
export async function converged(r: Room): Promise<string> {
  for (const { peer } of r.peers) expect(peer.room.session.statusSnapshot().status).toBe('ready');
  const [left, right] = await Promise.all(
    r.peers.map(async ({ editor }) => mainOf(new Uint8Array(await editor.save())))
  );
  expect(canonicalOoxmlFingerprint(left!)).toBe(canonicalOoxmlFingerprint(right!));
  return canonicalOoxmlFingerprint(left!);
}

export const tracked =
  (edit: Edit): Edit =>
  async (c) => {
    c.document.changeTrackingMode = 'TrackMineOnly';
    await edit(c);
  };

export const onText = (words: string, change: (range: Range) => void): Edit =>
  tracked(async (c) => {
    const found = c.document.body.search(words, { matchCase: true }).getFirst();
    await c.sync();
    change(found);
    await c.sync();
  });

/** A direct edit, outside change tracking, on the first match of `words`. */
export const direct =
  (words: string, change: (range: Range) => void): Edit =>
  async (c) => {
    c.document.changeTrackingMode = 'Off';
    const found = c.document.body.search(words, { matchCase: true }).getFirst();
    await c.sync();
    change(found);
    await c.sync();
  };

/** One peer accepts or rejects each revision with this author and type, one at a time. */
export const decideAs =
  (author: string, type: string, action: 'accept' | 'reject'): Edit =>
  async (c) => {
    const revisions = c.document.body.revisions;
    revisions.load('items');
    await c.sync();
    for (const item of revisions.items) item.load('author,type');
    await c.sync();
    const matches = revisions.items.filter((item) => item.author === author && item.type === type);
    expect(matches.length).toBeGreaterThan(0);
    for (const item of matches) item[action]();
    await c.sync();
  };

/** The reviewer edits, the counterparty edits while disconnected, then they reconnect. */
export async function concurrently(r: Room, reviewer: Edit, counterparty: Edit) {
  r.pair.pause();
  await r.peers[0]!.runtime.run(reviewer);
  await r.peers[1]!.runtime.run(counterparty);
  r.sync();
  r.pair.resume();
  r.sync();
}

async function decided(bytes: Uint8Array, action: 'acceptAll' | 'rejectAll') {
  const reopened = await DocxEditor.createServer(bytes);
  try {
    return await reopened.run(async (c) => {
      c.document.body.revisions[action]();
      await c.sync();
      c.document.body.load('text');
      await c.sync();
      return c.document.body.text;
    });
  } finally {
    reopened.dispose();
  }
}

/** Both peers' saved bytes reopen and decide to the same texts: rejected, then accepted. */
export async function expectSameDecisions(r: Room): Promise<string[]> {
  const decisions: string[][] = [];
  for (const { editor } of r.peers) {
    const bytes = new Uint8Array(await editor.save());
    decisions.push([await decided(bytes, 'rejectAll'), await decided(bytes, 'acceptAll')]);
  }
  expect(decisions[0]).toEqual(decisions[1]!);
  return decisions[0]!;
}

/** What a peer shows: the body text with all markup, and its revisions as author and type. */
export async function peerState(runtime: DocxEditorRuntime) {
  return runtime.run(async (c) => {
    const revisions = c.document.body.revisions;
    c.document.body.load('text');
    revisions.load('items');
    await c.sync();
    for (const item of revisions.items) item.load('author,type');
    await c.sync();
    return {
      text: c.document.body.text,
      revisions: revisions.items.map((item) => `${item.author}:${item.type}`).sort(),
    };
  });
}

/** Both peers show the same text and the same revisions. Answers that state. */
export async function expectSamePeers(r: Room) {
  const [left, right] = await Promise.all(r.peers.map(({ runtime }) => peerState(runtime)));
  expect(left).toEqual(right!);
  return left!;
}

/**
 * The state one document reaches when the reviewer's edit and then the counterparty's edit
 * run one after the other, without collaboration. Concurrent edits must reach it too.
 */
export async function sequential(body: string, reviewer: Edit, counterparty: Edit) {
  const first = await DocxEditor.createServer(zipDocument(body), { author: REVIEWER });
  let bytes: Uint8Array;
  try {
    await first.run(reviewer);
    bytes = await first.save();
  } finally {
    first.dispose();
  }
  const second = await DocxEditor.createServer(bytes, { author: COUNTERPARTY });
  try {
    await second.run(counterparty);
    return await peerState(second as unknown as DocxEditorRuntime);
  } finally {
    second.dispose();
  }
}
