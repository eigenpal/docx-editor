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
const FOOTER: StoryScope = { kind: 'headerFooter', rId: 'rId8' };
const FOOTNOTES: StoryScope = { kind: 'notesPart', noteKind: 'footnote' };
const ENDNOTES: StoryScope = { kind: 'notesPart', noteKind: 'endnote' };

function furnitureDoc(): Uint8Array {
  const type = (kind: string) =>
    `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`;
  return zipDocument(
    '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId7"/>' +
      '<w:footerReference w:type="default" r:id="rId8"/>' +
      '</w:sectPr></w:pPr><w:r><w:t>body</w:t></w:r></w:p>',
    {
      documentRels:
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rId8" Type="${R}/footer" Target="footer1.xml"/></Relationships>`,
      overrides:
        `<Override PartName="/word/header1.xml" ContentType="${type('header')}"/>` +
        `<Override PartName="/word/footer1.xml" ContentType="${type('footer')}"/>`,
      extraXml: {
        'word/header1.xml': `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Header text</w:t></w:r></w:p></w:hdr>`,
        'word/footer1.xml': `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>Footer text</w:t></w:r></w:p></w:ftr>`,
      },
    }
  );
}

function notesDoc(): Uint8Array {
  const notes = (kind: 'footnote' | 'endnote') =>
    `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}>` +
    `<w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>` +
    `<w:${kind} w:id="1"><w:p><w:r><w:${kind}Ref/></w:r><w:r><w:t>note text</w:t></w:r></w:p></w:${kind}>`;
  const type = (kind: string) =>
    `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`;
  return zipDocument(
    '<w:p><w:r><w:t>Hi</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r>' +
      '<w:r><w:endnoteReference w:id="1"/></w:r></w:p><w:sectPr/>',
    {
      documentRels:
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/></Relationships>`,
      overrides:
        `<Override PartName="/word/footnotes.xml" ContentType="${type('footnotes')}"/>` +
        `<Override PartName="/word/endnotes.xml" ContentType="${type('endnotes')}"/>`,
      extraXml: {
        'word/footnotes.xml': `<w:footnotes xmlns:w="${W}">${notes('footnote')}</w:footnotes>`,
        'word/endnotes.xml': `<w:endnotes xmlns:w="${W}">${notes('endnote')}</w:endnotes>`,
      },
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
  readonly partName: string;
  readonly bytes: () => Uint8Array;
  readonly scope: StoryScope;
  readonly op: (paragraphId: string) => TreeDocOp;
  /** The element the edit must leave in the receiver's story part. */
  readonly expectLocalName: string;
}

function storyPartFromPackage(peer: Peer, name: string): OoxmlNode {
  const part = peer.store.currentPackage().parts.get(name);
  if (!part) throw new Error(`no ${name} in package`);
  return part.root;
}

function containsLocalName(root: OoxmlNode, localName: string): boolean {
  let present = false;
  walk(root, (node: OoxmlNode) => {
    if (node.kind !== 'textValue' && node.localName === localName) present = true;
  });
  return present;
}

function containsParaId(root: OoxmlNode): boolean {
  let present = false;
  walk(root, (node: OoxmlNode) => {
    if (node.kind === 'textValue') return;
    if (node.attributes.some((attribute) => attribute.localName === 'paraId')) present = true;
  });
  return present;
}

const indent = (paragraphId: string): TreeDocOp => ({
  op: 'setParagraphProperties',
  paragraphId,
  properties: [{ localName: 'ind', attributes: { start: '720' } }],
});

const bold = (paragraphId: string): TreeDocOp => ({
  op: 'setRunProperties',
  paragraphId,
  start: 0,
  end: 3,
  properties: [{ localName: 'b' }],
});

const stories = [
  { story: 'header', bytes: furnitureDoc, scope: HEADER, partName: '/word/header1.xml' },
  { story: 'footer', bytes: furnitureDoc, scope: FOOTER, partName: '/word/footer1.xml' },
  { story: 'footnote', bytes: notesDoc, scope: FOOTNOTES, partName: '/word/footnotes.xml' },
  { story: 'endnote', bytes: notesDoc, scope: ENDNOTES, partName: '/word/endnotes.xml' },
] as const;

const cases: readonly StoryCase[] = stories.flatMap(({ story, ...shared }) => [
  { name: `${story} indent`, ...shared, op: indent, expectLocalName: 'ind' },
  { name: `${story} bold`, ...shared, op: bold, expectLocalName: 'b' },
]);

describe('property variants replicate in non-body stories', () => {
  for (const testCase of cases) {
    test(`${testCase.name} reaches the peer`, async () => {
      const { alice, bob } = await harness.pair(testCase.bytes());
      const paragraphId = textParagraphId(alice, testCase.scope);
      harness.apply(alice, [testCase.op(paragraphId)], testCase.scope);
      expect(bob.room.session.statusSnapshot().status).toBe('ready');

      // Gap 2's core claim: the property VALUE replicates into a non-body story WITHOUT the
      // receiver opening that story store — read it straight from bob's materialized package.
      const received = storyPartFromPackage(bob, testCase.partName);
      expect(containsLocalName(received, testCase.expectLocalName)).toBe(true);

      // Every story seeds paragraph identity into shared state, so the receiver's package
      // matches the author's before it opens the story store (#580).
      expect(containsParaId(storyPartFromPackage(alice, testCase.partName))).toBe(true);
      expect(containsParaId(received)).toBe(true);
      harness.expectConverged(alice, bob);

      // Opening the story, the ordinary "view the header/note" flow, changes nothing.
      bob.store.partFor(testCase.scope);
      harness.expectConverged(alice, bob);
    });
  }
});

describe('received story edits match before any story store opens', () => {
  for (const { story, bytes, scope } of stories) {
    test(`${story}: a cold joiner and a remounted peer match the author`, async () => {
      const { alice, bob } = await harness.pair(bytes());
      harness.apply(alice, [indent(textParagraphId(alice, scope))], scope);
      // Neither peer below has opened the story store.
      const carol = await harness.join(alice, 'carol');
      harness.expectConverged(alice, carol);
      const remounted = await harness.remount(bob);
      harness.expectConverged(alice, remounted);
      harness.apply(alice, [bold(textParagraphId(alice, scope))], scope);
      harness.expectConverged(alice, remounted);
      harness.expectConverged(alice, carol);
    });
  }
});
