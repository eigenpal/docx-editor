/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A tracked deletion over an equation strikes the whole equation. Peers receive one `w:del`
// holding the `m:oMath`, converge while another participant types, and decide it either way.

import { afterEach, expect, test } from 'bun:test';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';

const peers = createPeerHarness('tracked-equation-delete-room');
afterEach(() => peers.cleanup());

const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const REVISION = { author: 'Alice', date: '2026-01-02T03:04:05Z' };
// "Let " [4,5) equation " hold." — then a second paragraph the other participant types into.
const bytes = () =>
  zipDocument(
    `<w:p ${M}><w:r><w:t xml:space="preserve">Let </w:t></w:r>` +
      '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>' +
      '<w:r><w:t xml:space="preserve"> hold.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Other</w:t></w:r></w:p>'
  );

test('a peer typing beside the struck equation in the same paragraph converges', async () => {
  const { alice, bob, pause, resume } = await peers.pair(bytes());
  pause();
  peers.apply(alice, [
    {
      op: 'deleteText',
      paragraphId: peers.paragraphIdAt(alice, 0),
      start: 3,
      end: 6,
      revision: REVISION,
    },
  ]);
  peers.apply(bob, [
    { op: 'insertText', paragraphId: peers.paragraphIdAt(bob, 0), offset: 0, text: 'Now ' },
  ]);
  resume();
  alice.port.flushPendingJournals();
  bob.port.flushPendingJournals();
  peers.expectConverged(alice, bob);
  const xml = serializeOoxmlPart(bob.store.bodyStore().part);
  expect(xml).toContain('Now ');
  expect(xml).toMatch(/<w:del [^>]*>.*<m:oMath>.*<\/w:del>/);
});

for (const [decision, kept] of [
  ['rejectAllRevisions', true],
  ['acceptAllRevisions', false],
] as const) {
  test(`the struck equation converges, and ${decision} on the other peer converges`, async () => {
    const { alice, bob, pause, resume } = await peers.pair(bytes());
    pause();
    peers.apply(alice, [
      {
        op: 'deleteText',
        paragraphId: peers.paragraphIdAt(alice, 0),
        start: 3,
        end: 6,
        revision: REVISION,
      },
    ]);
    peers.apply(bob, [
      { op: 'insertText', paragraphId: peers.paragraphIdAt(bob, 1), offset: 0, text: 'B' },
    ]);
    resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    peers.expectConverged(alice, bob);
    expect(serializeOoxmlPart(bob.store.bodyStore().part)).toMatch(
      /<w:del [^>]*>.*<m:oMath>.*<\/w:del>/
    );

    peers.apply(bob, [{ op: decision }]);
    bob.port.flushPendingJournals();
    alice.port.flushPendingJournals();
    peers.expectConverged(alice, bob);
    const xml = serializeOoxmlPart(alice.store.bodyStore().part);
    expect(xml.includes('<m:oMath>')).toBe(kept);
    expect(xml).toContain('BOther');
  });
}
