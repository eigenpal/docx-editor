/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two participants make tracked edits in one room, one of them inside the other's pending
// insertion, which splits it into two halves that share its id. A save from either replica
// gives every revision element its own id. The save does not change the ids either replica
// holds, so both still converge, a peer that joins afterwards loads the shared ids, and undo
// and redo after the save reach the same states on both peers.
import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { readOoxmlPackage, type OoxmlNode, type OoxmlPackage } from '@docx-editor.dev/core/store';
import {
  COUNTERPARTY,
  concurrently,
  converged,
  expectSameDecisions,
  onText,
  ORDERS,
  room,
  type Order,
  type Room,
} from './tracked-foreign-revisions-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REVISIONS = new Set(['ins', 'del', 'rPrChange', 'pPrChange', 'moveFrom', 'moveTo']);

const typeInside = onText('thirty', (range) => range.insertText(' (or sixty)', 'After'));
const typeElsewhere = onText('Second', (range) => range.insertText('The ', 'Before'));

/** `localName:id` of every revision element in every WML part, by part name. */
function revisionIds(pkg: OoxmlPackage): string[] {
  const found: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === W && REVISIONS.has(node.localName)) {
      const id = node.attributes.find(
        (attribute) => attribute.namespaceUri === W && attribute.localName === 'id'
      )?.value;
      found.push(`${node.localName}:${id}`);
    }
    for (const child of node.children) visit(child);
  };
  for (const name of [...pkg.parts.keys()].sort()) visit(pkg.parts.get(name)!.root);
  return found;
}

const live = (r: Room, index: number) =>
  revisionIds(r.peers[index]!.editor.surface!.session.currentPackage());

function opened(bytes: Uint8Array): OoxmlPackage {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

async function saved(r: Room, index: number): Promise<OoxmlPackage> {
  return opened(new Uint8Array(await r.peers[index]!.editor.save()));
}

function expectUniqueInRange(ids: readonly string[]): void {
  const values = ids.map((entry) => entry.slice(entry.indexOf(':') + 1));
  expect(new Set(values).size).toBe(values.length);
  for (const value of values) {
    expect(value).toMatch(/^\d{1,10}$/);
    expect(Number(value)).toBeLessThanOrEqual(2_147_483_647);
  }
}

/** Some id appears on more than one element: the halves of the split insertion. */
function hasSharedId(ids: readonly string[]): boolean {
  const values = ids.map((entry) => entry.slice(entry.indexOf(':') + 1));
  return new Set(values).size < values.length;
}

for (const order of Object.keys(ORDERS) as Order[])
  test(`${order}: a save gives unique ids and leaves both replicas' ids as they are`, async () => {
    const r = await room(order);
    try {
      await concurrently(r, typeInside, typeElsewhere);
      await converged(r);
      const before = live(r, 0);
      expect(live(r, 1)).toEqual(before);
      expect(hasSharedId(before)).toBe(true);

      const fromReviewer = await saved(r, 0);
      const fromCounterparty = await saved(r, 1);
      expectUniqueInRange(revisionIds(fromReviewer));
      // Both replicas hold one tree, so both save the same ids.
      expect(revisionIds(fromCounterparty)).toEqual(revisionIds(fromReviewer));

      // The save is a projection: both replicas keep the shared ids and still converge.
      expect(live(r, 0)).toEqual(before);
      expect(live(r, 1)).toEqual(before);
      await converged(r);
      // A peer that joins after the save loads the ids the room holds, from the first bytes
      // it is handed.
      const joined = await r.harness.join(r.pair.alice, 'carol');
      expect(revisionIds(opened(joined.room.document))).toEqual(before);
      expect(revisionIds(r.harness.packageOf(joined))).toEqual(before);

      // Each saved copy decides the same way: the counterparty's halves and the reviewer's
      // words are separate decisions that still reach the same texts.
      const [rejected, accepted] = await expectSameDecisions(r);
      expect(rejected).toBe('Payment is due within .\rSecond clause.');
      expect(accepted).toBe(
        'Payment is due within thirty (or sixty) (30) days of receipt.\rThe Second clause.'
      );
    } finally {
      r.close();
    }
  });

test('undo and redo after a save converge and save unique ids again', async () => {
  const r = await room();
  try {
    const original = await converged(r);
    await r.peers[0]!.runtime.run(typeInside);
    r.sync();
    const written = await converged(r);
    const shared = live(r, 0);
    expectUniqueInRange(revisionIds(await saved(r, 0)));

    expect(r.peers[0]!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    expect(await converged(r)).toBe(original);
    expect(live(r, 1)).toEqual(['ins:7']);

    expect(r.peers[0]!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    expect(await converged(r)).toBe(written);
    expect(live(r, 0)).toEqual(shared);
    expect(live(r, 1)).toEqual(shared);
    const again = revisionIds(await saved(r, 1));
    expectUniqueInRange(again);
    expect(again.filter((entry) => entry.startsWith('ins:'))).toHaveLength(shared.length);
  } finally {
    r.close();
  }
});

test('the counterparty author still owns both halves after save and reopen', async () => {
  const r = await room();
  try {
    await r.peers[0]!.runtime.run(typeInside);
    r.sync();
    const main = (await saved(r, 0)).parts.get('/word/document.xml')!;
    const authors: string[] = [];
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.namespaceUri === W && node.localName === 'ins') {
        authors.push(node.attributes.find((a) => a.localName === 'author')?.value ?? '');
      }
      for (const child of node.children) visit(child);
    };
    visit(main.root);
    expect(authors.filter((author) => author === COUNTERPARTY)).toHaveLength(2);
  } finally {
    r.close();
  }
});
