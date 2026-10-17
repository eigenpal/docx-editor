/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A reviewer types and deletes on the page, in suggesting mode, inside or right after a
// counterparty's pending change, while the counterparty accepts or rejects that change. The
// decision reaches all of the counterparty's change and nothing else: their insertion never
// stays pending in part, and the text after it never joins it. Each pair converges, in either
// client order, to the state the two edits reach one after the other, and the saved document
// decides alike on both peers.
import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  BODY,
  converged,
  COUNTERPARTY,
  decideAs,
  expectSameDecisions,
  expectSamePeers,
  ORDERS,
  REPLACED,
  REVIEWER,
  room,
  STRUCK,
  type Edit,
  type Order,
  type Room,
} from './tracked-foreign-revisions-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

/** A page edit of the reviewer, in suggesting mode, at an offset of the first paragraph. */
type PageEdit = (r: Room) => void;

function caretAt(r: Room, offset: number) {
  const editor = r.peers[0]!.editor;
  expect(editor.setEditingMode('suggesting').ok).toBe(true);
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
  return editor.surface!;
}

const typeAt =
  (offset: number, text: string): PageEdit =>
  (r) => {
    const surface = caretAt(r, offset);
    for (const character of text) surface.type(character);
  };

const backspaceAt =
  (offset: number, count: number): PageEdit =>
  (r) => {
    const surface = caretAt(r, offset);
    for (let at = 0; at < count; at += 1) surface.deleteBackward();
  };

const at = (text: string) => text.length;

interface Case {
  readonly body: string;
  readonly edit: PageEdit;
  readonly decisions: Record<string, Edit>;
}

const ON_INSERTION = {
  'accepts their insertion': decideAs(COUNTERPARTY, 'Insert', 'accept'),
  'rejects their insertion': decideAs(COUNTERPARTY, 'Insert', 'reject'),
};
const ON_DELETION = {
  'accepts their deletion': decideAs(COUNTERPARTY, 'Delete', 'accept'),
  'rejects their deletion': decideAs(COUNTERPARTY, 'Delete', 'reject'),
};

const CASES: Record<string, Case> = {
  'types right after their insertion': {
    body: BODY,
    edit: typeAt(at('Payment is due within thirty (30) days of receipt'), ' net'),
    decisions: ON_INSERTION,
  },
  'types in the middle of their insertion': {
    body: BODY,
    edit: typeAt(at('Payment is due within thirty'), ' (or sixty)'),
    decisions: ON_INSERTION,
  },
  'types a word that starts as the rest of their insertion does': {
    body: BODY,
    edit: typeAt(at('Payment is due within thirty'), ' net'),
    decisions: ON_INSERTION,
  },
  'deletes inside their insertion': {
    body: BODY,
    edit: backspaceAt(at('Payment is due within thirty (30)'), 4),
    decisions: ON_INSERTION,
  },
  'deletes the text right after their insertion': {
    body: BODY,
    edit: backspaceAt(at('Payment is due within thirty (30) days of receipt.'), 1),
    decisions: ON_INSERTION,
  },
  'types right after their deletion': {
    body: STRUCK,
    edit: typeAt(at('Payment is due within thirty (30) days of receipt'), ' net'),
    decisions: ON_DELETION,
  },
  'types between their deletion and their insertion': {
    body: REPLACED,
    edit: typeAt(at('Payment is due within sixty days '), 'or '),
    decisions: { ...ON_INSERTION, ...ON_DELETION },
  },
};

/** The state a room reaches when the page edit and then the decision run one after the other. */
async function oneAfterTheOther(order: Order, { body, edit }: Case, decision: Edit) {
  const r = await room(order, body);
  try {
    edit(r);
    r.sync();
    await r.peers[1]!.runtime.run(decision);
    r.sync();
    await converged(r);
    return { state: await expectSamePeers(r), decisions: await expectSameDecisions(r) };
  } finally {
    r.close();
  }
}

for (const order of Object.keys(ORDERS) as Order[])
  for (const [name, entry] of Object.entries(CASES))
    for (const [decisionName, decision] of Object.entries(entry.decisions))
      test(`${order}: the reviewer ${name} on the page while the counterparty ${decisionName}`, async () => {
        const expected = await oneAfterTheOther(order, entry, decision);
        const r = await room(order, entry.body);
        try {
          r.pair.pause();
          entry.edit(r);
          await r.peers[1]!.runtime.run(decision);
          r.sync();
          r.pair.resume();
          r.sync();
          await converged(r);
          expect(await expectSamePeers(r)).toEqual(expected.state);
          expect(await expectSameDecisions(r)).toEqual(expected.decisions);
        } finally {
          r.close();
        }
      });

for (const order of Object.keys(ORDERS) as Order[])
  test(`${order}: words typed in their insertion that follow their Enter keep their accept`, async () => {
    const r = await room(order);
    try {
      r.pair.pause();
      CASES['types in the middle of their insertion']!.edit(r);
      // The counterparty splits their insertion before the letter the words were typed after,
      // then accepts it: the typed words follow that letter into the new paragraph.
      const editor = r.peers[1]!.editor;
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      const offset = at('Payment is due within thirt');
      editor.surface!.setSelection({
        anchor: { paragraphId, offset },
        head: { paragraphId, offset },
      });
      editor.surface!.splitParagraph();
      await r.peers[1]!.runtime.run(ON_INSERTION['accepts their insertion']);
      r.sync();
      r.pair.resume();
      r.sync();
      await converged(r);
      const state = await expectSamePeers(r);
      expect(state.revisions).toEqual([`${REVIEWER}:Insert`]);
      // Rejecting what is left removes only the reviewer's words.
      expect((await expectSameDecisions(r))[0]).toBe(
        'Payment is due within thirt\ry (30) days of receipt.\rSecond clause.'
      );
    } finally {
      r.close();
    }
  });

for (const order of Object.keys(ORDERS) as Order[])
  test(`${order}: an accept of their insertion leaves the text after it untracked, whatever the reviewer typed`, async () => {
    const r = await room(order);
    try {
      r.pair.pause();
      CASES['types right after their insertion']!.edit(r);
      await r.peers[1]!.runtime.run(ON_INSERTION['accepts their insertion']);
      r.sync();
      r.pair.resume();
      r.sync();
      await converged(r);
      // Rejecting what is left removes only the reviewer's words: the period was never proposed.
      expect(await expectSameDecisions(r)).toEqual([
        'Payment is due within thirty (30) days of receipt.\rSecond clause.',
        'Payment is due within thirty (30) days of receipt net.\rSecond clause.',
      ]);
    } finally {
      r.close();
    }
  });
