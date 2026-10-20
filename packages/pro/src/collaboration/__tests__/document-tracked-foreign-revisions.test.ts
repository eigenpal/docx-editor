/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A reviewer edits beside and inside a counterparty's pending changes through the editing
// API, in a collaboration room. Shared text keeps each revision as an attribute of its own,
// so a concurrent accept or reject of the counterparty's change reaches all of it and only
// it. Each edit converges in either client order to the state the edits reach one after the
// other, through concurrent decisions, deletion, undo, redo, reconnect, and save and reopen.
import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocumentCollaboration } from '../document-session.ts';
import { zipDocument } from './document-peer-support';
import {
  BODY,
  concurrently,
  converged,
  COUNTERPARTY,
  decideAs,
  direct,
  expectSameDecisions,
  expectSamePeers,
  onText,
  ORDERS,
  PROPOSED,
  REPLACED,
  REVIEWER,
  REVISED,
  room,
  sequential,
  STRUCK,
  type Edit,
  type Order,
} from './tracked-foreign-revisions-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const ORDER_NAMES = Object.keys(ORDERS) as Order[];
const replaceProposal = onText(PROPOSED, (range) => range.insertText(REVISED, 'Replace'));

// The reviewer's edits of the counterparty's insertion: at its edges, inside it, over it, and
// right after it.
const ON_INSERTION: Record<string, Edit> = {
  'writes before the insertion': onText('thirty', (range) => range.insertText('about ', 'Before')),
  'deletes the words that end where it starts': onText('within ', (range) => range.delete()),
  'writes right after the insertion': onText('receipt', (range) =>
    range.insertText(' net', 'After')
  ),
  'replaces the insertion': replaceProposal,
  'writes in the middle of it': onText('thirty', (range) =>
    range.insertText(' (or sixty)', 'After')
  ),
  'deletes part of it': onText('(30) ', (range) => range.delete()),
  'strikes the text right after it': onText('.', (range) => range.delete()),
};

// A tracked deletion of the counterparty's own pending text refuses, so their deletion is a
// direct edit: the words leave the document while the reviewer edits beside them.
const ON_THEIR_INSERTION: Record<string, Edit> = {
  'accepts their insertion': decideAs(COUNTERPARTY, 'Insert', 'accept'),
  'rejects their insertion': decideAs(COUNTERPARTY, 'Insert', 'reject'),
  'types inside their insertion': onText('(30)', (range) => range.insertText(' calendar', 'After')),
  'deletes the whole insertion': direct(PROPOSED, (range) => range.delete()),
};

/**
 * Pairs the one-after-the-other oracle cannot describe. Words typed into text that another
 * participant strikes at the same time join the strike, as they do in plain text, while one
 * after the other the second edit lands outside the struck text. And after words inside the
 * insertion, their search for the whole insertion finds nothing.
 */
const CONFLICTS = new Set([
  'replaces the insertion|types inside their insertion',
  'deletes part of it|types inside their insertion',
  'writes in the middle of it|deletes the whole insertion',
]);

for (const order of ORDER_NAMES)
  for (const [reviewerName, reviewer] of Object.entries(ON_INSERTION))
    for (const [counterName, counterparty] of Object.entries(ON_THEIR_INSERTION)) {
      if (CONFLICTS.has(`${reviewerName}|${counterName}`)) continue;
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
    }

for (const order of ORDER_NAMES)
  test(`${order}: words typed into their insertion while the reviewer replaces it join the strike`, async () => {
    const r = await room(order);
    try {
      await concurrently(r, replaceProposal, ON_THEIR_INSERTION['types inside their insertion']!);
      await converged(r);
      const state = await expectSamePeers(r);
      expect(state.text).toContain(' calendar');
      expect(state.revisions).toEqual([
        `${REVIEWER}:Delete`,
        `${REVIEWER}:Insert`,
        `${COUNTERPARTY}:Insert`,
      ]);
      // The reviewer's strike covers the words typed into it; rejecting everything removes
      // the counterparty's insertion, and with it their typing.
      expect(await expectSameDecisions(r)).toEqual([
        'Payment is due within .\rSecond clause.',
        `Payment is due within ${REVISED}.\rSecond clause.`,
      ]);
    } finally {
      r.close();
    }
  });

for (const order of ORDER_NAMES)
  test(`${order}: words typed in their insertion while they delete it stay, as the reviewer's insertion`, async () => {
    const r = await room(order);
    try {
      await concurrently(
        r,
        ON_INSERTION['writes in the middle of it']!,
        ON_THEIR_INSERTION['deletes the whole insertion']!
      );
      await converged(r);
      expect(await expectSamePeers(r)).toEqual({
        text: 'Payment is due within  (or sixty).\rSecond clause.',
        revisions: [`${REVIEWER}:Insert`],
      });
      expect(await expectSameDecisions(r)).toEqual([
        'Payment is due within .\rSecond clause.',
        'Payment is due within  (or sixty).\rSecond clause.',
      ]);
    } finally {
      r.close();
    }
  });

for (const order of ORDER_NAMES)
  test(`${order}: a strike of part of their insertion and their typing in it converge`, async () => {
    const r = await room(order);
    try {
      await concurrently(
        r,
        ON_INSERTION['deletes part of it']!,
        ON_THEIR_INSERTION['types inside their insertion']!
      );
      await converged(r);
      const state = await expectSamePeers(r);
      expect(state.text).toBe(
        'Payment is due within thirty (30) calendar days of receipt.\rSecond clause.'
      );
      expect(state.revisions).toEqual([`${REVIEWER}:Delete`, `${COUNTERPARTY}:Insert`]);
      const [rejected, accepted] = await expectSameDecisions(r);
      expect(rejected).toBe('Payment is due within .\rSecond clause.');
      // Their typing joins the strike or stays beside it, by client order; the strike's own
      // words go either way.
      expect(accepted).not.toContain('(30)');
    } finally {
      r.close();
    }
  });

for (const order of ORDER_NAMES)
  for (const reviewerDecision of ['accept', 'reject'] as const)
    for (const counterDecision of ['accept', 'reject'] as const)
      test(`${order}: they ${counterDecision} their insertion while the reviewer ${reviewerDecision}s the deletion inside it`, async () => {
        const r = await room(order);
        try {
          await r.peers[0]!.runtime.run(ON_INSERTION['deletes part of it']!);
          r.sync();
          const reviewer = decideAs(REVIEWER, 'Delete', reviewerDecision);
          const counterparty = decideAs(COUNTERPARTY, 'Insert', counterDecision);
          await concurrently(r, reviewer, counterparty);
          await converged(r);
          const kept = counterDecision === 'accept';
          const struck = reviewerDecision === 'accept';
          // Both decisions hold: neither one leaves the other's revision pending.
          expect(await expectSamePeers(r)).toEqual({
            text: `Payment is due within ${kept ? (struck ? 'thirty days of receipt' : PROPOSED) : ''}.\rSecond clause.`,
            revisions: [],
          });
        } finally {
          r.close();
        }
      });

// Their deletion before their insertion: the reviewer writes in front of it, or between it
// and the insertion.
const ON_REPLACEMENT: Record<string, Edit> = {
  'writes in front of their replacement': onText('sixty days ', (range) =>
    range.insertText('or ', 'Before')
  ),
  'writes between their deletion and their insertion': onText('sixty days ', (range) =>
    range.insertText('or ', 'After')
  ),
};

const ON_THEIR_REPLACEMENT: Record<string, Edit> = {
  ...ON_THEIR_INSERTION,
  'accepts their deletion': decideAs(COUNTERPARTY, 'Delete', 'accept'),
  'rejects their deletion': decideAs(COUNTERPARTY, 'Delete', 'reject'),
};

for (const order of ORDER_NAMES)
  for (const [reviewerName, reviewer] of Object.entries(ON_REPLACEMENT))
    for (const [counterName, counterparty] of Object.entries(ON_THEIR_REPLACEMENT))
      test(`${order}: the reviewer ${reviewerName} while the counterparty ${counterName}`, async () => {
        const r = await room(order, REPLACED);
        try {
          await concurrently(r, reviewer, counterparty);
          await converged(r);
          expect(await expectSamePeers(r)).toEqual(
            await sequential(REPLACED, reviewer, counterparty)
          );
          await expectSameDecisions(r);
        } finally {
          r.close();
        }
      });

// The reviewer's edits beside and over the counterparty's deleted words.
const ON_DELETION: Record<string, Edit> = {
  'strikes up to the start of their deletion': onText('within ', (range) => range.delete()),
  'strikes the text right after their deletion': onText('.', (range) => range.delete()),
  'strikes their deleted words and the live text after them': onText('receipt.', (range) =>
    range.delete()
  ),
  'writes inside their deleted words': onText('thirty', (range) =>
    range.insertText('sixty days', 'After')
  ),
};

const ON_THEIR_DELETION: Record<string, Edit> = {
  'accepts their deletion': decideAs(COUNTERPARTY, 'Delete', 'accept'),
  'rejects their deletion': decideAs(COUNTERPARTY, 'Delete', 'reject'),
};

for (const order of ORDER_NAMES)
  for (const [reviewerName, reviewer] of Object.entries(ON_DELETION))
    for (const [counterName, counterparty] of Object.entries(ON_THEIR_DELETION))
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

test('in collaboration, a strike of only their deleted words refuses as it does alone', async () => {
  const r = await room('reviewer first', STRUCK);
  try {
    const before = await converged(r);
    await expect(
      r.peers[0]!.runtime.run(onText('(30) days', (range) => range.delete()))
    ).rejects.toMatchObject({
      code: 'NotImplemented',
      debugInfo: { innerError: { code: 'edit.tracked-deleted-text-only' } },
    });
    r.sync();
    expect(await converged(r)).toBe(before);
  } finally {
    r.close();
  }
});

for (const order of ORDER_NAMES)
  test(`${order}: the reviewer resolves their own insertion alone, and the other peer sees it`, async () => {
    const r = await room(order);
    try {
      await r.peers[0]!.runtime.run(ON_INSERTION['writes in the middle of it']!);
      r.sync();
      expect((await expectSamePeers(r)).revisions).toEqual([
        `${REVIEWER}:Insert`,
        `${COUNTERPARTY}:Insert`,
        `${COUNTERPARTY}:Insert`,
      ]);
      await r.peers[0]!.runtime.run(decideAs(REVIEWER, 'Insert', 'reject'));
      r.sync();
      await converged(r);
      const rejected = await expectSamePeers(r);
      expect(rejected.text).toBe(`Payment is due within ${PROPOSED}.\rSecond clause.`);
      // Their halves meet again; only their insertion is left.
      expect(new Set(rejected.revisions)).toEqual(new Set([`${COUNTERPARTY}:Insert`]));
      // Accepting their insertion leaves no revision behind.
      await r.peers[1]!.runtime.run(decideAs(COUNTERPARTY, 'Insert', 'accept'));
      r.sync();
      await converged(r);
      expect(await expectSamePeers(r)).toEqual({
        text: `Payment is due within ${PROPOSED}.\rSecond clause.`,
        revisions: [],
      });
    } finally {
      r.close();
    }
  });

for (const edit of ['writes before the insertion', 'writes in the middle of it'])
  test(`undo and redo after the reviewer ${edit} converge on both peers`, async () => {
    const r = await room();
    try {
      const original = await converged(r);
      await r.peers[0]!.runtime.run(ON_INSERTION[edit]!);
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

for (const order of ORDER_NAMES)
  test(`${order}: an undo of words in their insertion while they accept it keeps the accept`, async () => {
    const r = await room(order);
    try {
      await r.peers[0]!.runtime.run(ON_INSERTION['writes in the middle of it']!);
      r.sync();
      r.pair.pause();
      expect(r.peers[0]!.editor.exec({ type: 'undo' }).ok).toBe(true);
      await r.peers[1]!.runtime.run(decideAs(COUNTERPARTY, 'Insert', 'accept'));
      r.sync();
      r.pair.resume();
      r.sync();
      await converged(r);
      expect(await expectSamePeers(r)).toEqual({
        text: `Payment is due within ${PROPOSED}.\rSecond clause.`,
        revisions: [],
      });
    } finally {
      r.close();
    }
  });

for (const edit of ['writes before the insertion', 'writes in the middle of it'])
  test(`a reviewer who ${edit} offline and reconnects converges with the counterparty's accept`, async () => {
    const r = await room();
    try {
      r.pair.pause();
      await r.peers[0]!.runtime.run(ON_INSERTION[edit]!);
      await r.peers[1]!.runtime.run(ON_THEIR_INSERTION['accepts their insertion']!);
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
        await sequential(BODY, ON_INSERTION[edit]!, ON_THEIR_INSERTION['accepts their insertion']!)
      );
    } finally {
      r.close();
    }
  });

test('a server runtime in a collaboration session replaces their insertion', async () => {
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
    await runtime.run(replaceProposal);
    const reopened = await DocxEditor.createServer(await runtime.save());
    try {
      const revisions = await reopened.run(async (c) => {
        const items = c.document.body.revisions;
        items.load('items');
        await c.sync();
        for (const item of items.items) item.load('author,type');
        await c.sync();
        return items.items.map((item) => `${item.author}:${item.type}`).sort();
      });
      expect(revisions).toEqual([
        `${REVIEWER}:Delete`,
        `${REVIEWER}:Insert`,
        `${COUNTERPARTY}:Insert`,
      ]);
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
    opened.destroy();
    awareness.destroy();
  }
});
