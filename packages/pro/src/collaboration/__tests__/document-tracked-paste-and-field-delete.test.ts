/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Pasted tracked changes and a suggested simple-field deletion reach every peer as the same
// revisions, converge with concurrent typing, resolve from either side, and survive undo,
// redo and save/reopen.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  revisionItemsOf,
  serializeOoxmlPart,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { projectExternalHtml } from '../../../../core/src/editor/clipboard-html-read.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('tracked-paste-field-delete-room');

afterEach(() => harness.cleanup());

const WORD_HTML = readFileSync(
  new URL(
    '../../../../core/src/editor/__tests__/fixtures/word-mac-tracked-changes.html',
    import.meta.url
  ),
  'utf8'
);
const ADA = { author: 'Ada Lovelace', date: '2026-02-03T04:05:06Z' };
const BOB = { author: 'Bob Reviewer', date: '2026-02-03T04:05:07Z' };

const mainOf = (pkg: OoxmlPackage) => pkg.parts.get(pkg.mainDocumentPart)!;
const revisionsOf = (peer: Peer) =>
  revisionItemsOf(mainOf(harness.packageOf(peer))).map((item) => [
    item.revisionKind,
    item.author,
    item.text,
  ]);

function expectSame(left: Peer, right: Peer): void {
  harness.expectConverged(left, right);
  expect(saveReopenDigest(harness.packageOf(right))).toEqual(
    saveReopenDigest(harness.packageOf(left))
  );
  expect(revisionsOf(right)).toEqual(revisionsOf(left));
}

describe('pasted tracked changes in collaboration', () => {
  test('a peer receives every pasted revision, and resolves them for both', async () => {
    const { alice, bob } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>Host paragraph</w:t></w:r></w:p>')
    );
    const projected = projectExternalHtml(WORD_HTML);
    if (!projected.ok) throw new Error(projected.reason);
    const pasted = alice.store.applyFragmentPaste(
      { kind: 'body' },
      {
        paragraphId: harness.paragraphIdAt(alice, 0),
        offset: 4,
        fragmentBytes: projected.fragmentBytes,
        lastMarkCovered: projected.lastMarkCovered,
      }
    );
    expect(pasted.ok).toBe(true);
    alice.port.flushPendingJournals();
    expectSame(alice, bob);
    const authors = new Set(revisionsOf(bob).map(([, author]) => author));
    expect(authors).toEqual(new Set(['Ann Author', "Bob O'Brien & Co"]));
    const pastedXml = serializeOoxmlPart(mainOf(harness.packageOf(bob)));
    expect(pastedXml).toContain('<w:rPrChange ');
    expect(pastedXml).toContain('<w:pPrChange ');
    expect(pastedXml).toMatch(/<w:trPr><w:ins /);

    // Bob types in a pasted paragraph while Alice's paste is live, then rejects everything.
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 0), offset: 0, text: 'B: ' },
    ]);
    expectSame(alice, bob);
    harness.apply(bob, [{ op: 'rejectAllRevisions' }]);
    expectSame(alice, bob);
    expect(revisionsOf(alice)).toEqual([]);

    expect(bob.room.session.undo()).toBe(true);
    expectSame(alice, bob);
    expect(revisionsOf(alice).length).toBeGreaterThan(10);

    expect(alice.room.session.undo()).toBe(true);
    expectSame(alice, bob);
    expect(alice.room.session.redo()).toBe(true);
    expectSame(alice, bob);
  });
});

describe('a rich paste suggested in collaboration', () => {
  test('the whole paste is one proposal on both peers, and either can reject it', async () => {
    const { alice, bob } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>Host paragraph</w:t></w:r></w:p>')
    );
    const projected = projectExternalHtml(WORD_HTML);
    if (!projected.ok) throw new Error(projected.reason);
    const pasted = alice.store.applyFragmentPaste(
      { kind: 'body' },
      {
        paragraphId: harness.paragraphIdAt(alice, 0),
        offset: 4,
        fragmentBytes: projected.fragmentBytes,
        lastMarkCovered: projected.lastMarkCovered,
        revision: ADA,
      }
    );
    expect(pasted.ok).toBe(true);
    alice.port.flushPendingJournals();
    expectSame(alice, bob);
    const insertionAuthors = new Set(
      revisionsOf(bob)
        .filter(([kind]) => kind === 'insert')
        .map(([, author]) => author)
    );
    expect(insertionAuthors).toEqual(new Set(['Ada Lovelace']));

    // Bob types inside the proposal while it is pending, then rejects everything.
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset: 0, text: 'B' },
    ]);
    expectSame(alice, bob);
    harness.apply(bob, [{ op: 'rejectAllRevisions' }]);
    expectSame(alice, bob);
    expect(revisionsOf(alice)).toEqual([]);

    expect(bob.room.session.undo()).toBe(true);
    expectSame(alice, bob);
    expect(alice.room.session.undo()).toBe(true);
    expectSame(alice, bob);
  });
});

describe('a suggested simple-field deletion in collaboration', () => {
  for (const field of [
    '<w:fldSimple w:instr="PAGE"/>',
    '<w:fldSimple w:instr=" AUTHOR "><w:r><w:t>Someone</w:t></w:r></w:fldSimple>',
  ]) {
    test(`${field.includes('PAGE') ? 'an empty' : 'a cached'} field converges and resolves`, async () => {
      const { alice, bob } = await harness.pair(
        zipDocument(
          `<w:p><w:r><w:t xml:space="preserve">Field: </w:t></w:r>${field}` +
            '<w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>'
        )
      );
      const paragraphId = harness.paragraphIdAt(alice, 0);
      // Concurrent: Alice strikes the field while Bob types on both sides of it.
      harness.apply(alice, [{ op: 'deleteText', paragraphId, start: 7, end: 8, revision: ADA }]);
      harness.apply(bob, [
        { op: 'insertText', paragraphId, offset: 8, text: '!' },
        { op: 'insertText', paragraphId, offset: 0, text: '>' },
      ]);
      expectSame(alice, bob);
      const xml = serializeOoxmlPart(mainOf(harness.packageOf(bob)));
      expect(xml).not.toContain('fldSimple');
      expect(xml).toMatch(/<w:del [^>]*><w:r><w:fldChar w:fldCharType="begin"\/>/);
      expect(revisionsOf(bob)).toEqual([
        ['delete', 'Ada Lovelace', field.includes('PAGE') ? '{PAGE}' : 'Someone'],
      ]);

      // Bob proposes deleting more around the struck field; the strikes stay separate.
      harness.apply(bob, [
        {
          op: 'deleteText',
          paragraphId: harness.paragraphIdAt(bob, 0),
          start: 1,
          end: 3,
          revision: BOB,
        },
      ]);
      expectSame(alice, bob);

      // Bob accepts Alice's strike: the whole field goes, for both of them.
      harness.apply(bob, [{ op: 'acceptRevision', revision: { id: '0', ...ADA } }]);
      expectSame(alice, bob);
      const accepted = serializeOoxmlPart(mainOf(harness.packageOf(alice)));
      expect(accepted).not.toContain('fldChar');
      expect(accepted).not.toContain('Someone');

      expect(bob.room.session.undo()).toBe(true);
      expectSame(alice, bob);
      expect(serializeOoxmlPart(mainOf(harness.packageOf(alice)))).toContain('<w:delInstrText');
    });
  }
});
