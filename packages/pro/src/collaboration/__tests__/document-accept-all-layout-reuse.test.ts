/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A property change that changes nothing has no review card, and the review filter keeps its
// layout cache key after the last such record goes. Across two collaborating editors: one peer
// accepts every change, adds a tracked format change, and adds a tracked format change with no
// effect. After each step both peers show the layout of the saved document opened again, the
// peer that received the accept measured only the paragraphs that held a change, and the
// documents converge.

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { measuredParagraphTestRecorder } from '../../../../core/src/layout/paragraph-break-request.ts';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { zipDocument } from './document-peer-support.ts';

// Each comparison opens the saved document again and lays it out from the top.
setDefaultTimeout(60_000);

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});

const STAMP = 'w:author="Counterparty" w:date="2026-01-01T10:00:00Z"';
const PARAGRAPHS = 60;
/** A property change that changes nothing: the queue lists no card for it. */
const INERT = `<w:pPr><w:jc w:val="left"/><w:pPrChange w:id="1" ${STAMP}><w:pPr/></w:pPrChange></w:pPr>`;
/** A property change with a card. */
const CENTERED = `<w:pPr><w:jc w:val="center"/><w:pPrChange w:id="2" ${STAMP}><w:pPr/></w:pPrChange></w:pPr>`;
const inserted = (id: number) =>
  `<w:ins w:id="${id}" ${STAMP}><w:r><w:t xml:space="preserve">An inserted sentence. </w:t></w:r></w:ins>`;
/** Paragraph index to what it holds: seven changes, so a decision derives the whole queue. */
const CHANGES = new Map([
  [40, INERT],
  [42, inserted(3)],
  [44, inserted(4)],
  [46, inserted(5)],
  [48, inserted(6)],
  [50, inserted(7)],
  [52, CENTERED],
]);
const fixture = zipDocument(
  Array.from(
    { length: PARAGRAPHS },
    (_, index) =>
      `<w:p>${CHANGES.get(index) ?? ''}<w:r><w:t>Paragraph ${index} with enough words of text to fill more than one line of the page, so that its lines are worth keeping.</w:t></w:r></w:p>`
  ).join('')
);

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'accept-all-layout-reuse',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: fixture },
    offlineEditing: true,
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    author: name,
    modules: [reviewModule(), collaborationModule({ session: room.session })],
  });
  editor.surface!.layout();
  return {
    ydoc,
    room,
    editor,
    container,
    surface: editor.surface!,
    close() {
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
  a.room.session.flushPendingJournals();
  b.room.session.flushPendingJournals();
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)), 'relay');
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc)), 'relay');
  a.surface.layout();
  b.surface.layout();
}

async function fingerprint(peer: Peer): Promise<string> {
  const result = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
  if (!result.ok) throw new Error(result.reason);
  return canonicalOoxmlFingerprint(result.package.parts.get(result.package.mainDocumentPart)!);
}

async function converged(a: Peer, b: Peer): Promise<void> {
  expect(await fingerprint(b)).toBe(await fingerprint(a));
}

const round = (value: number): number => Math.round(value * 100) / 100;
/** Keys that name a node or a record. A document opened again gives its nodes other ids. */
const NAMES = /^(id|range|revision|date|key)$|Id$|Ids$|Key$/;

/** Each box, baseline, and offset to 0.01 pt, each piece of text, and its markup. */
function geometryOf(value: unknown, out: string[], depth = 0): string[] {
  if (depth > 64 || value === null || value === undefined) return out;
  if (typeof value === 'number') out.push(String(round(value)));
  else if (typeof value === 'string' || typeof value === 'boolean') out.push(String(value));
  else if (Array.isArray(value)) for (const item of value) geometryOf(item, out, depth + 1);
  else if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [key, item] of entries) {
      if (NAMES.test(key)) continue;
      out.push(key);
      geometryOf(item, out, depth + 1);
    }
  }
  return out;
}

const markupOf = (container: HTMLElement) => ({
  bars: container.querySelectorAll('.docx-change-bar').length,
  marked: [...container.querySelectorAll<HTMLElement>('.docx-revision')]
    .map((element) => element.textContent ?? '')
    .join(''),
});

/**
 * Expect the live layout of `peer` to be the layout of its saved document opened again
 * outside any session: the same geometry and the same markup. Returns the markup.
 */
function compareFresh(peer: Peer): ReturnType<typeof markupOf> {
  const live = peer.surface.layout();
  const container = document.createElement('div');
  document.body.append(container);
  const fresh = createDocxEditor({
    container,
    document: peer.surface.save(),
    author: 'Reader',
    modules: [reviewModule()],
  });
  try {
    const again = fresh.surface!.layout();
    const geometry = geometryOf(live.pages, []);
    // The comparison holds real content: at least one line for each paragraph.
    expect(geometry.filter((entry) => entry === 'baseline').length).toBeGreaterThanOrEqual(
      PARAGRAPHS
    );
    expect(live.pages.length).toBeGreaterThan(1);
    expect(geometry.join('\n')).toBe(geometryOf(again.pages, []).join('\n'));
    const markup = markupOf(peer.container);
    expect(markup).toEqual(markupOf(container));
    return markup;
  } finally {
    fresh.destroy();
    container.remove();
  }
}

const listed = (peer: Peer) => peer.surface.session.reviewItems().length;

/** A tracked alignment of the paragraph at `index`, as a reader in Suggest mode makes it. */
function align(peer: Peer, index: number, value: 'left' | 'center') {
  const paragraphId = peer.surface.session.paragraphIds()[index]!;
  const at = { paragraphId, offset: 0 };
  peer.surface.setEditingMode('suggest');
  peer.surface.setSelection({ anchor: at, head: at });
  expect(peer.editor.exec({ type: 'setAlignment', align: value }).ok).toBe(true);
}

test('a peer keeps its measured lines when the other peer accepts every change', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    await converged(a, b);
    // The inert record has no card on either peer and paints no markup.
    for (const each of [a, b]) {
      expect(listed(each)).toBe(CHANGES.size - 1);
      expect(compareFresh(each).bars).toBe(CHANGES.size - 1);
    }

    // Bob accepts every change. Alice receives it and measures only what changed.
    const ids = a.surface.session.paragraphIds();
    const changed = new Set([...CHANGES.keys()].map((index) => ids[index]!));
    const measured = measuredParagraphTestRecorder();
    try {
      expect(b.editor.exec({ type: 'acceptAllRevisions' }).ok).toBe(true);
      sync(a, b);
      expect(measured.paragraphIds.length).toBeGreaterThan(0);
      expect(measured.paragraphIds.filter((id) => !changed.has(id))).toEqual([]);
    } finally {
      measured.dispose();
    }
    for (const each of [a, b]) {
      expect(listed(each)).toBe(0);
      expect(compareFresh(each)).toEqual({ bars: 0, marked: '' });
    }
    await converged(a, b);

    // Bob adds a tracked format change. It has a card and a change bar on both peers.
    align(b, 10, 'center');
    sync(a, b);
    for (const each of [a, b]) {
      expect(listed(each)).toBe(1);
      expect(compareFresh(each).bars).toBe(1);
    }
    await converged(a, b);

    // Bob adds one with no effect. Both peers leave it out again and paint no markup for it.
    align(b, 14, 'left');
    sync(a, b);
    for (const each of [a, b]) {
      expect(listed(each)).toBe(1);
      expect(compareFresh(each).bars).toBe(1);
    }
    await converged(a, b);

    // Alice centers that paragraph while Bob undoes his last change. Neither peer has seen
    // the other's write when both commit.
    align(a, 14, 'center');
    expect(b.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    expect(listed(b)).toBe(listed(a));
    for (const each of [a, b]) compareFresh(each);
    await converged(a, b);
  } finally {
    b.close();
    a.close();
  }
});
