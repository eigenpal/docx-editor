/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One participant adds a link over another author's pending insertion while a second strikes
// or types inside it. A revision holds run content only, so every replica saves the link
// outside the revisions, never a link inside `w:ins` or `w:del`.

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { writeOoxmlPackage, type TreeDocOp } from '@docx-editor.dev/core/store';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';

const harness = createPeerHarness('tracked-link-strike-room');

afterEach(() => {
  harness.cleanup();
});

const BODY = zipDocument(
  '<w:p><w:r><w:t>Pay </w:t></w:r>' +
    '<w:ins w:id="1" w:author="Counterparty" w:date="2026-09-01T00:00:00Z"><w:r><w:t>within thirty days</w:t></w:r></w:ins>' +
    '<w:r><w:t> now.</w:t></w:r></w:p><w:sectPr/>'
);

const REVIEWER = { author: 'Reviewer', date: '2026-09-02T00:00:00Z' };

/** Every revision wrapper that holds a link or simple field in the saved body. */
function linksInsideRevisions(xml: string): string[] {
  return [
    ...xml.matchAll(/<w:(ins|del)\b[^>]*>(?:(?!<\/w:\1>).)*?<w:(hyperlink|fldSimple)\b/gs),
  ].map((match) => `${match[1]} > ${match[2]}`);
}

describe('a link over pending text while a peer edits it', () => {
  for (const [name, edit] of [
    [
      'strikes part of it',
      (paragraphId: string): TreeDocOp => ({
        op: 'deleteText',
        paragraphId,
        start: 11,
        end: 17,
        revision: REVIEWER,
      }),
    ],
    [
      'types tracked text inside it',
      (paragraphId: string): TreeDocOp => ({
        op: 'insertText',
        paragraphId,
        offset: 11,
        text: 'X',
        revision: REVIEWER,
      }),
    ],
  ] as const) {
    test(`converges with the link outside the revisions when a peer ${name}`, async () => {
      const { alice, bob, pause, resume } = await harness.pair(BODY);
      const paragraphId = harness.paragraphIdAt(alice, 0);
      pause();
      harness.apply(alice, [
        { op: 'insertHyperlink', paragraphId, start: 4, end: 22, anchor: 'terms' },
      ]);
      harness.apply(bob, [edit(paragraphId)]);
      resume();
      harness.expectConverged(alice, bob);
      for (const peer of [alice, bob]) {
        const xml = strFromU8(
          unzipSync(writeOoxmlPackage(harness.packageOf(peer)))['word/document.xml']!
        );
        expect(xml).toContain('<w:hyperlink');
        expect(linksInsideRevisions(xml)).toEqual([]);
      }
    });
  }
});
