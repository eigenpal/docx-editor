/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import {
  planRevisionBatch,
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
