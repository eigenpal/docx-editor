/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A reviewer edits beside a counterparty's pending changes in a collaboration room. Shared
// text keeps a revision as an attribute of its characters, so a concurrent accept or reject
// cannot keep a strike over their change, or an edit that starts inside or right after it,
// intact: the editing API refuses those edits in a session. Edits that end before their
// changes converge in either client order to the state the edits reach one after the other,
// through concurrent decisions, deletion, undo, redo, reconnect, and save and reopen.
import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
import {
  DocxEditor,
  type DocxEditorRuntime,
  type Range,
  type RequestContext,
} from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocumentCollaboration } from '../document-session.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const REVIEWER = 'Avery Chen';
const COUNTERPARTY = 'Tailspin Legal';
const PROPOSED = 'thirty (30) days of receipt';
const REVISED = 'forty-five (45) days of receipt';
const BODY =
  '<w:p><w:r><w:t xml:space="preserve">Payment is due within </w:t></w:r>' +
  `<w:ins w:id="7" w:author="${COUNTERPARTY}" w:date="2026-09-01T00:00:00Z">` +
  `<w:r><w:t>${PROPOSED}</w:t></w:r></w:ins><w:r><w:t>.</w:t></w:r></w:p>` +
  '<w:p><w:r><w:t>Second clause.</w:t></w:r></w:p>';

/** Concurrent inserts at one position order by client id; tests run both orders. */
const ORDERS = {
  'reviewer first': { alice: 1, bob: 2 },
  'counterparty first': { alice: 2, bob: 1 },
};
type Order = keyof typeof ORDERS;

async function room(order: Order = 'reviewer first', body = BODY) {
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
type Room = Awaited<ReturnType<typeof room>>;
type Edit = (c: RequestContext) => Promise<void>;

async function mainOf(bytes: Uint8Array) {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
}

/** Both replicas are ready and hold the same canonical tree. Answers its fingerprint. */
async function converged(r: Room): Promise<string> {
  for (const { peer } of r.peers) expect(peer.room.session.statusSnapshot().status).toBe('ready');
  const [left, right] = await Promise.all(
    r.peers.map(async ({ editor }) => mainOf(new Uint8Array(await editor.save())))
  );
  expect(canonicalOoxmlFingerprint(left!)).toBe(canonicalOoxmlFingerprint(right!));
  return canonicalOoxmlFingerprint(left!);
}

const tracked =
  (edit: Edit): Edit =>
  async (c) => {
    c.document.changeTrackingMode = 'TrackMineOnly';
    await edit(c);
  };

const onText = (words: string, change: (range: Range) => void): Edit =>
  tracked(async (c) => {
    const found = c.document.body.search(words, { matchCase: true }).getFirst();
    await c.sync();
    change(found);
    await c.sync();
  });

const replaceProposal = onText(PROPOSED, (range) => range.insertText(REVISED, 'Replace'));

/** The reviewer edits, the counterparty edits while disconnected, then they reconnect. */
async function concurrently(r: Room, reviewer: Edit, counterparty: Edit) {
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

/** Both peers' saved bytes reopen and decide to the same texts. */
async function expectSameDecisions(r: Room) {
  const decisions: string[][] = [];
  for (const { editor } of r.peers) {
    const bytes = new Uint8Array(await editor.save());
    decisions.push([await decided(bytes, 'rejectAll'), await decided(bytes, 'acceptAll')]);
  }
  expect(decisions[0]).toEqual(decisions[1]!);
  return decisions[0]!;
}

/** What a peer shows: the body text with all markup, and its revisions as author and type. */
async function peerState(runtime: DocxEditorRuntime) {
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
async function expectSamePeers(r: Room) {
  const [left, right] = await Promise.all(r.peers.map(({ runtime }) => peerState(runtime)));
  expect(left).toEqual(right!);
  return left!;
}

/**
 * The state one document reaches when the reviewer's edit and then the counterparty's edit
 * run one after the other, without collaboration. Concurrent edits must reach it too.
 */
async function sequential(body: string, reviewer: Edit, counterparty: Edit) {
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

/** One peer accepts or rejects each revision with this author and type, one at a time. */
const decideAs =
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

/** A direct edit, outside change tracking, on the first match of `words`. */
const direct =
  (words: string, change: (range: Range) => void): Edit =>
  async (c) => {
    c.document.changeTrackingMode = 'Off';
    const found = c.document.body.search(words, { matchCase: true }).getFirst();
    await c.sync();
    change(found);
    await c.sync();
  };

// Inside the counterparty's insertion, or right after it, shared text cannot keep a concurrent
// accept or reject of that insertion intact, so these edits refuse in a collaboration session.
const INSIDE: Record<string, Edit> = {
  'writes right after the insertion': onText('receipt', (range) =>
    range.insertText(' net', 'After')
  ),
  'replaces the insertion': replaceProposal,
  'writes in the middle of it': onText('thirty', (range) =>
    range.insertText(' (or sixty)', 'After')
  ),
  'deletes part of it': onText('(30) ', (range) => range.delete()),
};

for (const [name, edit] of Object.entries(INSIDE))
  test(`in collaboration, a reviewer who ${name} is refused and the room is unchanged`, async () => {
    const r = await room();
    try {
      const before = await converged(r);
      await expect(r.peers[0]!.runtime.run(edit)).rejects.toMatchObject({
        code: 'NotImplemented',
        debugInfo: { innerError: { code: 'edit.tracked-foreign-revision-unsupported' } },
      });
      r.sync();
      expect(await converged(r)).toBe(before);
    } finally {
      r.close();
    }
  });

// At the edges of the counterparty's insertion, every edit keeps its own shared characters.
const EDGES: Record<string, Edit> = {
  'writes before the insertion': onText('thirty', (range) => range.insertText('about ', 'Before')),
  'deletes the words that end where it starts': onText('within ', (range) => range.delete()),
};

// A tracked deletion of the counterparty's own pending text refuses, so their deletion is a
// direct edit: the words leave the document while the reviewer edits beside them.
const COUNTER_EDITS: Record<string, Edit> = {
  'accepts their insertion': decideAs(COUNTERPARTY, 'Insert', 'accept'),
  'rejects their insertion': decideAs(COUNTERPARTY, 'Insert', 'reject'),
  'types inside their insertion': onText('(30)', (range) => range.insertText(' calendar', 'After')),
  'deletes the whole insertion': direct(PROPOSED, (range) => range.delete()),
};

for (const order of Object.keys(ORDERS) as Order[])
  for (const [reviewerName, reviewer] of Object.entries(EDGES))
    for (const [counterName, counterparty] of Object.entries(COUNTER_EDITS))
      test(`${order}: the reviewer ${reviewerName} while the counterparty ${counterName}`, async () => {
        const r = await room(order);
        try {
          await concurrently(r, reviewer, counterparty);
          await converged(r);
          // Both peers reach the state the two edits reach one after the other.
          expect(await expectSamePeers(r)).toEqual(await sequential(BODY, reviewer, counterparty));
          await expectSameDecisions(r);
        } finally {
          r.close();
        }
      });

// The counterparty replaced "sixty days" with their insertion: their deletion stands directly
// before their insertion.
const REPLACED =
  '<w:p><w:r><w:t xml:space="preserve">Payment is due within </w:t></w:r>' +
  `<w:del w:id="6" w:author="${COUNTERPARTY}" w:date="2026-09-01T00:00:00Z">` +
  '<w:r><w:delText xml:space="preserve">sixty days </w:delText></w:r></w:del>' +
  `<w:ins w:id="7" w:author="${COUNTERPARTY}" w:date="2026-09-01T00:00:00Z">` +
  `<w:r><w:t>${PROPOSED}</w:t></w:r></w:ins><w:r><w:t>.</w:t></w:r></w:p>` +
  '<w:p><w:r><w:t>Second clause.</w:t></w:r></w:p>';
const beforeTheirReplacement = onText('sixty days ', (range) => range.insertText('or ', 'Before'));

for (const order of Object.keys(ORDERS) as Order[])
  for (const [counterName, counterparty] of Object.entries(COUNTER_EDITS))
    test(`${order}: new words in front of the counterparty's replacement while the counterparty ${counterName}`, async () => {
      const r = await room(order, REPLACED);
      try {
        await concurrently(r, beforeTheirReplacement, counterparty);
        await converged(r);
        expect(await expectSamePeers(r)).toEqual(
          await sequential(REPLACED, beforeTheirReplacement, counterparty)
        );
        await expectSameDecisions(r);
      } finally {
        r.close();
      }
    });

const STRUCK =
  '<w:p><w:r><w:t xml:space="preserve">Payment is due within </w:t></w:r>' +
  `<w:del w:id="7" w:author="${COUNTERPARTY}" w:date="2026-09-01T00:00:00Z">` +
  `<w:r><w:delText>${PROPOSED}</w:delText></w:r></w:del><w:r><w:t>.</w:t></w:r></w:p>` +
  '<w:p><w:r><w:t>Second clause.</w:t></w:r></w:p>';

// A strike that ends where the counterparty's deleted words start stays admitted in a session.
const STRUCK_EDGES: Record<string, Edit> = {
  'strikes up to the start of their deletion': onText('within ', (range) => range.delete()),
};

const STRUCK_DECISIONS: Record<string, Edit> = {
  'accepts their deletion': decideAs(COUNTERPARTY, 'Delete', 'accept'),
  'rejects their deletion': decideAs(COUNTERPARTY, 'Delete', 'reject'),
};

for (const order of Object.keys(ORDERS) as Order[])
  for (const [reviewerName, reviewer] of Object.entries(STRUCK_EDGES))
    for (const [counterName, counterparty] of Object.entries(STRUCK_DECISIONS))
      test(`${order}: the reviewer ${reviewerName} while the counterparty ${counterName}`, async () => {
        const r = await room(order, STRUCK);
        try {
          await concurrently(r, reviewer, counterparty);
          await converged(r);
          expect(await expectSamePeers(r)).toEqual(
            await sequential(STRUCK, reviewer, counterparty)
          );
          await expectSameDecisions(r);
        } finally {
          r.close();
        }
      });

// An edit that starts right after another author's change, or strikes over it, writes a marker
// next to the one that ends the change. A concurrent decision removes that marker, and the
// change's attribute can pass to the next text, so these edits refuse in a session too.
const AFTER_THEIR_DELETION: Record<string, { body: string; edit: Edit }> = {
  'strikes the text right after their insertion': {
    body: BODY,
    edit: onText('.', (range) => range.delete()),
  },
  'strikes the text right after their deletion': {
    body: STRUCK,
    edit: onText('.', (range) => range.delete()),
  },
  'strikes their deleted words and the live text after them': {
    body: STRUCK,
    edit: onText('receipt.', (range) => range.delete()),
  },
  'writes inside their deleted words': {
    body: STRUCK,
    edit: onText('thirty', (range) => range.insertText('sixty days', 'After')),
  },
  'writes between their deletion and their insertion': {
    body: REPLACED,
    edit: onText('sixty days ', (range) => range.insertText('or ', 'After')),
  },
};

for (const [name, { body, edit }] of Object.entries(AFTER_THEIR_DELETION))
  test(`in collaboration, a reviewer who ${name} is refused and the room is unchanged`, async () => {
    const r = await room('reviewer first', body);
    try {
      const before = await converged(r);
      await expect(r.peers[0]!.runtime.run(edit)).rejects.toMatchObject({
        code: 'NotImplemented',
        debugInfo: { innerError: { code: 'edit.tracked-foreign-revision-unsupported' } },
      });
      r.sync();
      expect(await converged(r)).toBe(before);
    } finally {
      r.close();
    }
  });

for (const order of Object.keys(ORDERS) as Order[])
  test(`${order}: the reviewer resolves their own insertion alone, and the other peer sees it`, async () => {
    const r = await room(order);
    try {
      await r.peers[0]!.runtime.run(EDGES['writes before the insertion']!);
      r.sync();
      expect((await expectSamePeers(r)).revisions).toEqual([
        `${REVIEWER}:Insert`,
        `${COUNTERPARTY}:Insert`,
      ]);
      await r.peers[0]!.runtime.run(decideAs(REVIEWER, 'Insert', 'reject'));
      r.sync();
      await converged(r);
      expect(await expectSamePeers(r)).toEqual({
        text: `Payment is due within ${PROPOSED}.\rSecond clause.`,
        revisions: [`${COUNTERPARTY}:Insert`],
      });
    } finally {
      r.close();
    }
  });

/** Type `text` in suggesting mode on a peer, with the caret after `before` in paragraph 0. */
function typeInPage(r: Room, index: number, offset: number, text: string) {
  const editor = r.peers[index]!.editor;
  expect(editor.setEditingMode('suggesting').ok).toBe(true);
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
  for (const character of text) editor.surface!.type(character);
}

const MIDDLE = 'Payment is due within thirty'.length;

/** Whether `text` holds every character of `typed`, as many times as `typed` does. */
function holdsCharacters(text: string, typed: string): boolean {
  const counts = new Map<string, number>();
  for (const character of text) counts.set(character, (counts.get(character) ?? 0) + 1);
  for (const character of typed) {
    const left = counts.get(character) ?? 0;
    if (left === 0) return false;
    counts.set(character, left - 1);
  }
  return true;
}

for (const order of Object.keys(ORDERS) as Order[])
  for (const action of ['accept', 'reject'] as const)
    test(`${order}: page typing in the middle of the counterparty's insertion while they ${action} it converges`, async () => {
      const r = await room(order);
      try {
        r.pair.pause();
        typeInPage(r, 0, MIDDLE, ' (or sixty)');
        await r.peers[1]!.runtime.run(decideAs(COUNTERPARTY, 'Insert', action));
        r.sync();
        r.pair.resume();
        r.sync();
        await converged(r);
        const state = await expectSamePeers(r);
        // Known limit, also before this change: shared text keeps the insertion as an
        // attribute, so the concurrent decision can be lost and the typed characters can
        // reorder. Both peers still agree, and every typed character survives.
        expect(holdsCharacters(state.text, ' (or sixty)')).toBe(true);
      } finally {
        r.close();
      }
    });

test('undo and redo of an edge insertion converge on both peers', async () => {
  const r = await room();
  try {
    const original = await converged(r);
    await r.peers[0]!.runtime.run(EDGES['writes before the insertion']!);
    r.sync();
    const written = await converged(r);
    expect(written).not.toBe(original);

    expect(r.peers[0]!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    expect(await converged(r)).toBe(original);

    expect(r.peers[0]!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    expect(await converged(r)).toBe(written);
  } finally {
    r.close();
  }
});

test('a reviewer who edits offline and reconnects converges with the counterparty', async () => {
  const r = await room();
  try {
    r.pair.pause();
    await r.peers[0]!.runtime.run(EDGES['writes before the insertion']!);
    await r.peers[1]!.runtime.run(COUNTER_EDITS['accepts their insertion']!);
    r.sync();
    // The reviewer's session closes with the edit still held back, then reconnects.
    const reviewer = r.peers.shift()!;
    reviewer.close();
    const remounted = await r.harness.remount(reviewer.peer);
    r.peers.unshift(r.mount(remounted, REVIEWER));
    r.pair.resume();
    r.sync();
    await converged(r);
    expect(await expectSamePeers(r)).toEqual(
      await sequential(
        BODY,
        EDGES['writes before the insertion']!,
        COUNTER_EDITS['accepts their insertion']!
      )
    );
  } finally {
    r.close();
  }
});

test('a server runtime in a collaboration session refuses an edit inside their insertion', async () => {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const opened = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'tracked-foreign-revisions-server',
    sessionId: 'server',
    identity: { actorId: 'server', name: REVIEWER },
    bootstrap: { kind: 'create', document: zipDocument(BODY) },
  });
  const runtime = await DocxEditor.createCollaborative(opened.document, opened.session, {
    author: REVIEWER,
  });
  try {
    const before = await runtime.save();
    await expect(runtime.run(replaceProposal)).rejects.toMatchObject({
      code: 'NotImplemented',
      debugInfo: { innerError: { code: 'edit.tracked-foreign-revision-unsupported' } },
    });
    expect(await runtime.save()).toEqual(before);
  } finally {
    runtime.dispose();
    opened.destroy();
    awareness.destroy();
  }
});
