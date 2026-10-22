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

// Decisions that change structure around a change converge on every peer and undo as one step:
// a change in comment text, and a block content control the decision empties.
const peers = createPeerHarness('revision-boundaries');
afterEach(() => peers.cleanup());
const ann = (id: number) => `w:id="${id}" w:author="Ann" w:date="2026-10-01T10:00:00Z"`;
const COMMENTS = '/word/comments.xml';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

for (const action of ['accept', 'reject'] as const)
  test(`${action} a change in comment text on both peers`, async () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const body =
      '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Commented.</w:t></w:r><w:commentRangeEnd w:id="0"/>' +
      '<w:r><w:commentReference w:id="0"/></w:r></w:p>';
    const { alice, bob } = await peers.pair(
      zipDocument(body, {
        overrides: `<Override PartName="${COMMENTS}" ContentType="${CT}.comments+xml"/>`,
        documentRels:
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>',
        extraXml: {
          'word/comments.xml': `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Cy"><w:p><w:r><w:t xml:space="preserve">Remark </w:t></w:r><w:ins ${ann(1)}><w:r><w:t>added</w:t></w:r></w:ins></w:p></w:comment></w:comments>`,
        },
      })
    );
    const comments = () => peers.packageOf(alice).parts.get(COMMENTS)!;
    const plan = planRevisionBatch(comments(), action);
    expect(plan.result.resolved).toHaveLength(1);
    const result = alice.store.transact({ kind: 'body' }, (context) => {
      for (const op of plan.ops) context.applyTo(COMMENTS, op);
    });
    expect(result.ok).toBe(true);
    alice.port.flushPendingJournals();
    peers.expectConverged(alice, bob);
    const xml = serializeOoxmlPart(peers.packageOf(bob).parts.get(COMMENTS)!);
    expect(xml).not.toMatch(/<w:ins\b/);
    expect(xml.includes('added')).toBe(action === 'accept');
    expect(alice.room.session.undo()).toBe(true);
    peers.expectConverged(alice, bob);
    expect(revisionItemsOf(peers.packageOf(bob).parts.get(COMMENTS)!)).toHaveLength(1);
  });

test('a block content control a decision empties moves inline on both peers', async () => {
  const body =
    '<w:p><w:r><w:t>Before.</w:t></w:r></w:p>' +
    `<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent><w:p><w:pPr><w:rPr><w:del ${ann(1)}/></w:rPr></w:pPr>` +
    `<w:del ${ann(2)}><w:r><w:delText>only</w:delText></w:r></w:del></w:p></w:sdtContent></w:sdt>` +
    '<w:p><w:r><w:t>After.</w:t></w:r></w:p>';
  const { alice, bob } = await peers.pair(zipDocument(body));
  const before = serializeOoxmlPart(alice.store.bodyStore().part);
  peers.apply(alice, planRevisionBatch(alice.store.bodyStore().part, 'accept').ops);
  peers.expectConverged(alice, bob);
  const after = serializeOoxmlPart(bob.store.bodyStore().part);
  expect(after.replace(/ w14:\w+="[^"]*"/g, '')).toMatch(
    /<w:p><w:sdt><w:sdtPr><w:id w:val="7"\/><w:showingPlcHdr\/>/
  );
  expect(after).toContain('After.');
  expect(alice.room.session.undo()).toBe(true);
  peers.expectConverged(alice, bob);
  expect(serializeOoxmlPart(bob.store.bodyStore().part)).toBe(before);
  expect(alice.room.session.redo()).toBe(true);
  peers.expectConverged(alice, bob);
  expect(serializeOoxmlPart(bob.store.bodyStore().part)).toBe(after);
});

test('two tables a decision leaves side by side join on both peers', async () => {
  const table = (text: string) =>
    '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid>' +
    `<w:tr><w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
  const body =
    table('a') +
    `<w:p><w:pPr><w:rPr><w:del ${ann(1)}/></w:rPr></w:pPr><w:del ${ann(2)}><w:r><w:delText>between</w:delText></w:r></w:del></w:p>` +
    table('x') +
    '<w:p><w:r><w:t>After.</w:t></w:r></w:p>';
  const { alice, bob } = await peers.pair(zipDocument(body));
  const before = serializeOoxmlPart(alice.store.bodyStore().part);
  peers.apply(alice, planRevisionBatch(alice.store.bodyStore().part, 'accept').ops);
  peers.expectConverged(alice, bob);
  const after = serializeOoxmlPart(bob.store.bodyStore().part);
  expect(after.match(/<w:tbl>/g)).toHaveLength(1);
  expect(after).toContain('>x<');
  expect(alice.room.session.undo()).toBe(true);
  peers.expectConverged(alice, bob);
  expect(serializeOoxmlPart(bob.store.bodyStore().part)).toBe(before);
});
