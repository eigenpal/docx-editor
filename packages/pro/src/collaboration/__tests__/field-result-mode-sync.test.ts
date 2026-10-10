/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An edit made in the store's editable field-result mode changes ordinary result runs, so a
// peer reading in the default mode receives it as run text and converges.
//
// The editor never enables the editable mode in a collaboration session: the editor PR
// refuses that combination. This test only proves what the shared format sees if a local
// store edit of this kind reaches a room.
import { expect, test } from 'bun:test';
import { FIELD_ATOM_CHAR, paragraphTextOf } from '@docx-editor.dev/core/store';
import { BODY, createPeerHarness, zipDocument } from './document-peer-support.ts';

const FIELD =
  '<w:p><w:r><w:t xml:space="preserve">ab </w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> MERGEFIELD Name </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>Name</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
  '<w:r><w:t xml:space="preserve"> cd</w:t></w:r></w:p>';

test('an editable-mode result edit reaches a default-mode peer as run text', async () => {
  const harness = createPeerHarness('field-result-mode-sync', { offlineEditing: true });
  try {
    const { alice, bob } = await harness.pair(zipDocument(FIELD));
    const paragraphId = harness.paragraphIdAt(alice, 0);
    const result = alice.store.transact(
      BODY,
      (context) => {
        context.apply({ op: 'insertText', paragraphId, offset: 5, text: 'XY' });
      },
      { fieldResults: 'editable' }
    );
    expect(result.ok).toBe(true);
    alice.port.flushPendingJournals();
    await Promise.resolve();
    harness.expectConverged(alice, bob);
    const bobPart = harness.packageOf(bob).parts.get('/word/document.xml')!;
    expect(paragraphTextOf(bobPart, paragraphId)).toBe(`ab ${FIELD_ATOM_CHAR} cd`);
    expect(paragraphTextOf(bobPart, paragraphId, { fieldResults: 'editable' })).toBe(
      'ab NaXYme cd'
    );
  } finally {
    harness.cleanup();
  }
});
