/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import {
  planRevisionBatch,
  reviewItemKey,
  revisionItemsOf,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
const peers = createPeerHarness('structural-table-revisions');
afterEach(() => peers.cleanup());
for (const action of ['accept', 'reject'] as const) {
  test(`${action} table topology, grid and property changes replay and undo as one transaction`, async () => {
    const cellMarker = action === 'accept' ? 'cellDel' : 'cellIns';
    const body =
      '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr><w:trPrChange w:id="3" w:author="Ada"><w:trPr/></w:trPrChange></w:trPr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>survivor</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:' +
      cellMarker +
      ' w:id="4" w:author="Ada"/></w:tcPr><w:p><w:r><w:t>removed</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/>';
    const { alice, bob } = await peers.pair(zipDocument(body));
    const before = serializeOoxmlPart(alice.store.bodyStore().part);
    const batch = planRevisionBatch(alice.store.bodyStore().part, action);
    expect(batch.result.skipped).toEqual([]);
    expect(batch.result.resolved).toHaveLength(2);
    peers.apply(alice, batch.ops);
    peers.expectConverged(alice, bob);
    const after = serializeOoxmlPart(bob.store.bodyStore().part);
    expect(after).not.toContain('removed');
    expect(after).toContain('w:w="4000"');
    expect(revisionItemsOf(bob.store.bodyStore().part)).toHaveLength(0);
    expect(alice.room.session.undo()).toBe(true);
    peers.expectConverged(alice, bob);
    expect(serializeOoxmlPart(bob.store.bodyStore().part)).toBe(before);
    expect(alice.room.session.redo()).toBe(true);
    peers.expectConverged(alice, bob);
    expect(serializeOoxmlPart(bob.store.bodyStore().part)).toBe(after);
  });
}

for (const action of ['accept', 'reject'] as const) {
  test(`${action} paragraph-table joins and numbering history replay with undo/redo`, async () => {
    const mark = action === 'accept' ? 'del' : 'ins';
    const body = `<w:p><w:pPr><w:rPr><w:${mark} w:id="1" w:author="Ada"/></w:rPr></w:pPr><w:r><w:t>Before</w:t></w:r></w:p><w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:pPr><w:numPr><w:numId w:val="1"/><w:ins w:id="2" w:author="Ada"/></w:numPr></w:pPr><w:r><w:t>List</w:t></w:r></w:p>`;
    const { alice, bob } = await peers.pair(zipDocument(body));
    const before = serializeOoxmlPart(alice.store.bodyStore().part);
    const batch = planRevisionBatch(alice.store.bodyStore().part, action);
    expect(batch.result.skipped).toEqual([]);
    peers.apply(alice, batch.ops);
    peers.expectConverged(alice, bob);
    const after = serializeOoxmlPart(bob.store.bodyStore().part);
    expect(after.indexOf('<w:tc>')).toBeLessThan(after.indexOf('Before'));
    expect(after).toContain('<w:numId w:val="1"/>');
    expect(revisionItemsOf(bob.store.bodyStore().part)).toHaveLength(0);
    expect(alice.room.session.undo()).toBe(true);
    peers.expectConverged(alice, bob);
    expect(serializeOoxmlPart(bob.store.bodyStore().part)).toBe(before);
    expect(alice.room.session.redo()).toBe(true);
    peers.expectConverged(alice, bob);
    expect(serializeOoxmlPart(bob.store.bodyStore().part)).toBe(after);
  });
}

test('a cell decision keeps a table alignment change pending for its row on both peers', async () => {
  const width = (twips: number) => `<w:tcW w:w="${twips}" w:type="dxa"/>`;
  const cell = (text: string) =>
    `<w:tc><w:tcPr>${width(3000)}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const body =
    '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:jc w:val="center"/><w:tblPrChange w:id="1" w:author="Ada"><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr></w:tblPrChange></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    `<w:tr>${cell('a')}${cell('b')}<w:tc><w:tcPr>${width(1500)}<w:cellIns w:id="4" w:author="Ada"/><w:tcPrChange w:id="5" w:author="Ada"><w:tcPr>${width(3000)}</w:tcPr></w:tcPrChange></w:tcPr><w:p><w:r><w:t>inserted</w:t></w:r></w:p></w:tc></w:tr>` +
    `<w:tr>${cell('x')}${cell('y')}${cell('z')}</w:tr></w:tbl><w:p/>`;
  const { alice, bob } = await peers.pair(zipDocument(body));
  const keyOf = (part: Parameters<typeof revisionItemsOf>[0], kind: string) =>
    reviewItemKey(revisionItemsOf(part).find((item) => item.revisionKind === kind)!);
  const decide = (peer: typeof alice, key: string) => {
    const plan = planRevisionBatch(peer.store.bodyStore().part, 'reject', [key], undefined, {
      explicit: true,
    });
    expect(plan.result.skipped).toEqual([]);
    peers.apply(peer, plan.ops);
    peers.expectConverged(alice, bob);
  };
  const alignment = keyOf(alice.store.bodyStore().part, 'format');
  decide(alice, keyOf(alice.store.bodyStore().part, 'structural'));
  expect(revisionItemsOf(bob.store.bodyStore().part).map(reviewItemKey)).toEqual([alignment]);
  decide(bob, alignment);
  const after = serializeOoxmlPart(alice.store.bodyStore().part);
  expect(after).not.toContain('inserted');
  expect(after).toContain(
    '<w:tblPrEx><w:jc w:val="center"/></w:tblPrEx><w:trPr><w:jc w:val="center"/></w:trPr>'
  );
  expect(revisionItemsOf(alice.store.bodyStore().part)).toHaveLength(0);
  expect(bob.room.session.undo()).toBe(true);
  peers.expectConverged(alice, bob);
  expect(revisionItemsOf(alice.store.bodyStore().part).map(reviewItemKey)).toEqual([alignment]);
  expect(bob.room.session.redo()).toBe(true);
  peers.expectConverged(alice, bob);
  expect(serializeOoxmlPart(alice.store.bodyStore().part)).toBe(after);
});
