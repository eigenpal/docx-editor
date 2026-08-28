/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Variant coverage is body-scoped; this proves the STORY dimension replicates (gap 2).
//
// A property authored in a header or a footnote transacts against a different store, so its
// journal takes a different path to shared state than the body. These cases drive a
// representative property through the real registry + materializer in each non-body story and
// assert the peer converges, closing the "replicates in the body but maybe not in a header"
// gap. A story-specific replication regression fails here.

import { afterEach, describe, expect, test } from 'bun:test';
import type { OoxmlNode, StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import { createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('story-variants-room');

afterEach(() => {
  harness.cleanup();
});

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const HEADER: StoryScope = { kind: 'headerFooter', rId: 'rId7' };
const FOOTNOTES: StoryScope = { kind: 'notesPart', noteKind: 'footnote' };

function headerDoc(): Uint8Array {
  return zipDocument(
    '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId7"/>' +
      '</w:sectPr></w:pPr><w:r><w:t>body</w:t></w:r></w:p>',
    {
      documentRels:
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/></Relationships>`,
      overrides:
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
      extraXml: {
        'word/header1.xml': `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Header text</w:t></w:r></w:p></w:hdr>`,
      },
    }
  );
}

function footnoteDoc(): Uint8Array {
  const notes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>note text</w:t></w:r></w:p></w:footnote>`;
  return zipDocument(
    '<w:p><w:r><w:t>Hi</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:sectPr/>',
    {
      documentRels:
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`,
      overrides:
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>',
      extraXml: { 'word/footnotes.xml': `<w:footnotes xmlns:w="${W}">${notes}</w:footnotes>` },
    }
  );
}

/** First paragraph carrying real text in a story part (skips separator/ref-only paragraphs). */
function textParagraphId(peer: Peer, scope: StoryScope): string {
  const part = peer.store.partFor(scope);
  if (!part) throw new Error('missing story part');
  let found: string | undefined;
  walk(part.root, (node: OoxmlNode) => {
    if (found || node.kind !== 'paragraph') return;
    let hasText = false;
    walk(node, (child) => {
      if (child.kind === 'textValue' && child.value.length > 0) hasText = true;
    });
    if (hasText) found = node.id;
  });
  if (!found) throw new Error('no text paragraph in story');
  return found;
}

interface StoryCase {
  readonly name: string;
  readonly bytes: () => Uint8Array;
  readonly scope: StoryScope;
  readonly op: (paragraphId: string) => TreeDocOp;
}

const cases: readonly StoryCase[] = [
  {
    name: 'header indent',
    bytes: headerDoc,
    scope: HEADER,
    op: (paragraphId) => ({
      op: 'setParagraphProperties',
      paragraphId,
      properties: [{ localName: 'ind', attributes: { start: '720' } }],
    }),
  },
  {
    name: 'header bold',
    bytes: headerDoc,
    scope: HEADER,
    op: (paragraphId) => ({
      op: 'setRunProperties',
      paragraphId,
      start: 0,
      end: 3,
      properties: [{ localName: 'b' }],
    }),
  },
  {
    name: 'footnote indent',
    bytes: footnoteDoc,
    scope: FOOTNOTES,
    op: (paragraphId) => ({
      op: 'setParagraphProperties',
      paragraphId,
      properties: [{ localName: 'ind', attributes: { start: '720' } }],
    }),
  },
  {
    name: 'footnote bold',
    bytes: footnoteDoc,
    scope: FOOTNOTES,
    op: (paragraphId) => ({
      op: 'setRunProperties',
      paragraphId,
      start: 0,
      end: 3,
      properties: [{ localName: 'b' }],
    }),
  },
];

describe('property variants replicate in non-body stories', () => {
  for (const testCase of cases) {
    test(`${testCase.name} reaches the peer`, async () => {
      const { alice, bob } = await harness.pair(testCase.bytes());
      const paragraphId = textParagraphId(alice, testCase.scope);
      harness.apply(alice, [testCase.op(paragraphId)], testCase.scope);
      // Open the receiver's story store — the "bob views the header/note" flow — so the
      // comparison sees the story part bob materialized from shared state, not the
      // pre-open overlay. Opening it is also what a real reader does before editing there.
      bob.store.partFor(testCase.scope);
      expect(bob.room.session.statusSnapshot().status).toBe('ready');
      harness.expectConverged(alice, bob);
    });
  }
});
