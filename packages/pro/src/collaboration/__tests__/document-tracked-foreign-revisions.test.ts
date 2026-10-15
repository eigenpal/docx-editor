/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A reviewer edits a counterparty's pending insertion in a collaboration room. The reviewer's
// strike nests inside the counterparty's insertion and the reviewer's new words sit beside it,
// each a separate decision. Both replicas stay ready and converge through concurrent edits in
// either client order, deletion while the other participant edits, undo, redo, reconnect, and
// save and reopen.
import { afterAll, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { DocxEditor, type Range, type RequestContext } from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
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

async function room(order: Order = 'reviewer first') {
  const harness = createPeerHarness(
    'tracked-foreign-revisions',
    { offlineEditing: true },
    ORDERS[order]
  );
  const pair = await harness.pair(zipDocument(BODY));
  const mount = (peer: Peer, author: string) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
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

async function mainXml(r: Room, index = 0) {
  const xml = strFromU8(
    unzipSync(new Uint8Array(await r.peers[index]!.editor.save()))['word/document.xml']!
  );
  return xml.slice(xml.indexOf('<w:body>'), xml.indexOf('</w:body>'));
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

test("the reviewer's replacement nests in the counterparty's insertion on both peers", async () => {
  const r = await room();
  try {
    await r.peers[0]!.runtime.run(replaceProposal);
    r.sync();
    await converged(r);
    for (const index of [0, 1]) {
      const xml = await mainXml(r, index);
      expect(xml).toMatch(
        new RegExp(
          `<w:ins [^>]*w:author="${COUNTERPARTY}"[^>]*><w:del [^>]*w:author="${REVIEWER}"[^>]*>` +
            `<w:r><w:delText>${PROPOSED.replace(/[()]/g, '\\$&')}</w:delText></w:r></w:del></w:ins>` +
            `<w:ins [^>]*w:author="${REVIEWER}"[^>]*><w:r><w:t>${REVISED.replace(/[()]/g, '\\$&')}`
        )
      );
    }
    expect(await expectSameDecisions(r)).toEqual([
      // Rejecting every decision also rejects the counterparty's insertion.
      `Payment is due within .\rSecond clause.`,
      `Payment is due within ${REVISED}.\rSecond clause.`,
    ]);
    // The counterparty accepts their own insertion; the reviewer's deletion of it stays.
    await r.peers[1]!.runtime.run(async (c) => {
      const revisions = c.document.body.revisions;
      revisions.load('items');
      await c.sync();
      for (const item of revisions.items) item.load('author,type');
      await c.sync();
      for (const item of revisions.items)
        if (item.author === COUNTERPARTY && item.type === 'Insert') item.accept();
      await c.sync();
    });
    r.sync();
    await converged(r);
    const xml = await mainXml(r);
    expect(xml).not.toContain(COUNTERPARTY);
    expect(xml).toMatch(
      new RegExp(`<w:del [^>]*w:author="${REVIEWER}"[^>]*><w:r><w:delText>thirty`)
    );
  } finally {
    r.close();
  }
});

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

// A tracked deletion of the counterparty's own pending text refuses, so their deletions are
// direct edits: the words leave the document while the reviewer edits them.
const COUNTER_EDITS: Record<string, Edit> = {
  'types inside the insertion': onText('(30)', (range) => range.insertText(' calendar', 'After')),
  'deletes part of the insertion': direct('of receipt', (range) => range.delete()),
  'deletes the whole insertion': direct(PROPOSED, (range) => range.delete()),
  'types untracked inside it': direct('days', (range) => range.insertText('business ', 'Before')),
};

const REVIEWER_EDITS: Record<string, Edit> = {
  'replaces the insertion': replaceProposal,
  'types after a word inside it': onText('thirty', (range) =>
    range.insertText(' (or sixty)', 'After')
  ),
  'deletes part of it': onText('(30) ', (range) => range.delete()),
};

for (const order of Object.keys(ORDERS) as Order[])
  for (const [reviewerName, reviewer] of Object.entries(REVIEWER_EDITS))
    for (const [counterName, counterparty] of Object.entries(COUNTER_EDITS))
      test(`${order}: the reviewer ${reviewerName} while the counterparty ${counterName}`, async () => {
        const r = await room(order);
        try {
          await concurrently(r, reviewer, counterparty);
          await converged(r);
          const [rejected, accepted] = await expectSameDecisions(r);
          // Rejecting everything never loses the reviewer-free original text.
          expect(rejected).toContain('Payment is due within');
          expect(accepted).toContain('Second clause.');
          // The reviewer's proposal survives the counterparty's concurrent edit.
          if (reviewer === replaceProposal) expect(accepted).toContain(REVISED);
          // Typing into a run that the other participant deletes at the same time keeps every
          // typed character, but the pieces can reorder. Direct typing does the same, so this
          // checks that the words survive rather than their exact order.
          else if (reviewerName.startsWith('types')) expect(accepted).toContain('or sixty');
          else expect(accepted).not.toContain('(30) ');
          expect(rejected).not.toContain('(or sixty)');
          expect(rejected).not.toContain(REVISED);
        } finally {
          r.close();
        }
      });

test("undo and redo of the reviewer's nested replacement converge on both peers", async () => {
  const r = await room();
  try {
    const original = await converged(r);
    await r.peers[0]!.runtime.run(replaceProposal);
    r.sync();
    const replaced = await converged(r);
    expect(replaced).not.toBe(original);

    expect(r.peers[0]!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    expect(await converged(r)).toBe(original);

    expect(r.peers[0]!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    expect(await converged(r)).toBe(replaced);
  } finally {
    r.close();
  }
});

test('the counterparty undoes a concurrent edit inside the nested replacement', async () => {
  const r = await room();
  try {
    await concurrently(r, replaceProposal, COUNTER_EDITS['types inside the insertion']!);
    await converged(r);
    expect(r.peers[1]!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    await converged(r);
    expect(await expectSameDecisions(r)).toEqual([
      `Payment is due within .\rSecond clause.`,
      `Payment is due within ${REVISED}.\rSecond clause.`,
    ]);
  } finally {
    r.close();
  }
});

test('a reviewer who edits offline and reconnects converges with the counterparty', async () => {
  const r = await room();
  try {
    r.pair.pause();
    await r.peers[0]!.runtime.run(replaceProposal);
    await r.peers[1]!.runtime.run(COUNTER_EDITS['types inside the insertion']!);
    r.sync();
    // The reviewer's session closes with the edit still held back, then reconnects.
    const reviewer = r.peers.shift()!;
    reviewer.close();
    const remounted = await r.harness.remount(reviewer.peer);
    r.peers.unshift(r.mount(remounted, REVIEWER));
    r.pair.resume();
    r.sync();
    await converged(r);
    const xml = await mainXml(r, 1);
    expect(xml).toContain(`w:author="${REVIEWER}"`);
    expect(xml).toContain(REVISED);
    await expectSameDecisions(r);
  } finally {
    r.close();
  }
});
