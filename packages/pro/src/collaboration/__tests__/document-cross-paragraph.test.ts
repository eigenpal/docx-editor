/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A range delete that joins existing paragraphs must replicate to the receiving replica.
//
// The authoring replica already committed the joined tree. Adopting the removed paragraph's
// `w:pPr` onto the survivor made the materialized part fail `known-node-invariant`, so the
// peer refused to install it and kept the pre-edit text.

import { afterEach, describe, expect, test } from 'bun:test';
import type { StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import {
  BODY,
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('cross-paragraph-typeover');
const HEADER: StoryScope = { kind: 'headerFooter', rId: 'rId7' };
const SAMPLE = new URL('../../../../../examples/vite/public/sample.docx', import.meta.url);

afterEach(() => {
  harness.cleanup();
});

function titledParagraph(text: string): string {
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function plainParagraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

const WITH_PROPERTIES = zipDocument(
  titledParagraph('DOCX-EDITOR.DEV') + titledParagraph('ELEMENT TEST DOCUMENT') + '<w:sectPr/>'
);

const THREE = zipDocument(
  titledParagraph('Alpha') + titledParagraph('Bravo') + titledParagraph('Charlie') + '<w:sectPr/>'
);

const TABLE_CELL = zipDocument(
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
    '<w:tr><w:tc><w:tcPr/>' +
    titledParagraph('CellOne') +
    titledParagraph('CellTwo') +
    '</w:tc><w:tc><w:tcPr/>' +
    titledParagraph('Other') +
    '</w:tc></w:tr></w:tbl>' +
    '<w:sectPr/>'
);

const R_HEADER = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';

const HEADER_DOC = zipDocument(
  plainParagraph('body') + '<w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr>',
  {
    overrides:
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    documentRels:
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId7" Type="${R_HEADER}" Target="header1.xml"/></Relationships>`,
    extraXml: {
      'word/header1.xml':
        `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        titledParagraph('HeadOne') +
        titledParagraph('HeadTwo') +
        `</w:hdr>`,
    },
  }
);

function paragraphNodes(peer: Peer, scope: StoryScope = BODY) {
  const part = scope.kind === 'body' ? peer.store.bodyStore().part : peer.store.partFor(scope);
  if (!part) throw new Error('missing story part');
  const paragraphs: { id: string; text: string }[] = [];
  walk(part.root, (node) => {
    if (node.kind === 'paragraph') paragraphs.push({ id: node.id, text: nodeText(node) });
  });
  return paragraphs;
}

function paragraphTexts(peer: Peer, scope: StoryScope = BODY): string[] {
  return paragraphNodes(peer, scope).map((paragraph) => paragraph.text);
}

function typeOverOps(
  peer: Peer,
  firstIndex: number,
  firstOffset: number,
  lastIndex: number,
  lastOffset: number,
  insert: string,
  scope: StoryScope = BODY
): TreeDocOp[] {
  const paragraphs = paragraphNodes(peer, scope);
  const firstId = paragraphs[firstIndex]!.id;
  const ops: TreeDocOp[] = [];
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const id = paragraphs[index]!.id;
    const length = paragraphs[index]!.text.length;
    const start = index === firstIndex ? firstOffset : 0;
    const end = index === lastIndex ? lastOffset : length;
    if (start < end) ops.push({ op: 'deleteText', paragraphId: id, start, end });
  }
  for (let index = firstIndex + 1; index <= lastIndex; index += 1) {
    ops.push({
      op: 'joinParagraphs',
      firstId,
      secondId: paragraphs[index]!.id,
    });
  }
  if (insert.length > 0) {
    ops.push({
      op: 'insertText',
      paragraphId: firstId,
      offset: firstOffset,
      text: insert,
    });
  }
  return ops;
}

function expectJoined(alice: Peer, bob: Peer, expected: string, scope: StoryScope = BODY): void {
  expect(alice.room.session.status()).toBe('ready');
  expect(bob.room.session.status()).toBe('ready');
  expect(paragraphTexts(alice, scope)[0]).toBe(expected);
  expect(paragraphTexts(bob, scope)[0]).toBe(expected);
  expect(packageFingerprint(harness.packageOf(bob))).toBe(
    packageFingerprint(harness.packageOf(alice))
  );
  expect(saveReopenDigest(harness.packageOf(bob))).toEqual(
    saveReopenDigest(harness.packageOf(alice))
  );
}

describe('cross-paragraph type-over replication', () => {
  test('two existing paragraphs with properties join on the receiving replica', async () => {
    const { alice, bob } = await harness.pair(WITH_PROPERTIES);
    harness.apply(alice, typeOverOps(alice, 0, 7, 1, 10, '[span-edit]'));
    expectJoined(alice, bob, 'DOCX-ED[span-edit]ST DOCUMENT');
  });

  test('the demo document type-over streams to the other replica', async () => {
    const bytes = new Uint8Array(await Bun.file(SAMPLE).arrayBuffer());
    const { alice, bob } = await harness.pair(bytes);
    const texts = paragraphTexts(alice);
    const firstIndex = texts.findIndex((text) => text.includes('DOCX-EDITOR.DEV'));
    const secondIndex = texts.findIndex((text) => text.includes('ELEMENT TEST DOCUMENT'));
    expect(secondIndex).toBe(firstIndex + 1);
    const firstMid = Math.max(1, Math.floor(texts[firstIndex]!.length / 2));
    const secondMid = Math.max(1, Math.floor(texts[secondIndex]!.length / 2));
    harness.apply(
      alice,
      typeOverOps(alice, firstIndex, firstMid, secondIndex, secondMid, '[span-edit]')
    );
    expect(paragraphTexts(alice)[firstIndex]).toBe('DOCX-ED[span-edit]ST DOCUMENT');
    expect(paragraphTexts(bob)[firstIndex]).toBe('DOCX-ED[span-edit]ST DOCUMENT');
    expect(alice.room.session.status()).toBe('ready');
    expect(bob.room.session.status()).toBe('ready');
    expect(packageFingerprint(harness.packageOf(bob))).toBe(
      packageFingerprint(harness.packageOf(alice))
    );
    expect(saveReopenDigest(harness.packageOf(bob))).toEqual(
      saveReopenDigest(harness.packageOf(alice))
    );
  });

  test('a selection spanning three paragraphs joins on the receiving replica', async () => {
    const { alice, bob } = await harness.pair(THREE);
    harness.apply(alice, typeOverOps(alice, 0, 2, 2, 4, '[span-edit]'));
    expectJoined(alice, bob, 'Al[span-edit]lie');
  });

  test('a single character over a cross-paragraph selection replicates', async () => {
    const { alice, bob } = await harness.pair(WITH_PROPERTIES);
    harness.apply(alice, typeOverOps(alice, 0, 7, 1, 10, 'x'));
    expectJoined(alice, bob, 'DOCX-EDxST DOCUMENT');
  });

  test('a cross-paragraph range delete with no insert replicates', async () => {
    const { alice, bob } = await harness.pair(WITH_PROPERTIES);
    harness.apply(alice, typeOverOps(alice, 0, 7, 1, 10, ''));
    expectJoined(alice, bob, 'DOCX-EDST DOCUMENT');
  });

  test('a selection that starts at a paragraph start replicates', async () => {
    const { alice, bob } = await harness.pair(WITH_PROPERTIES);
    harness.apply(alice, typeOverOps(alice, 0, 0, 1, 10, '[span-edit]'));
    expectJoined(alice, bob, '[span-edit]ST DOCUMENT');
  });

  test('a selection that ends at a paragraph end replicates', async () => {
    const { alice, bob } = await harness.pair(WITH_PROPERTIES);
    harness.apply(alice, typeOverOps(alice, 0, 7, 1, 21, '[span-edit]'));
    expectJoined(alice, bob, 'DOCX-ED[span-edit]');
  });

  test('a cross-paragraph type-over inside a table cell replicates', async () => {
    const { alice, bob } = await harness.pair(TABLE_CELL);
    const first = paragraphNodes(alice).find((paragraph) => paragraph.text === 'CellOne');
    const second = paragraphNodes(alice).find((paragraph) => paragraph.text === 'CellTwo');
    if (!first || !second) throw new Error('missing cell paragraphs');
    harness.apply(alice, [
      { op: 'deleteText', paragraphId: first.id, start: 4, end: 7 },
      { op: 'deleteText', paragraphId: second.id, start: 0, end: 4 },
      { op: 'joinParagraphs', firstId: first.id, secondId: second.id },
      { op: 'insertText', paragraphId: first.id, offset: 4, text: 'x' },
    ]);
    expect(paragraphTexts(alice)).toContain('CellxTwo');
    expect(paragraphTexts(bob)).toContain('CellxTwo');
    expect(alice.room.session.status()).toBe('ready');
    expect(bob.room.session.status()).toBe('ready');
    harness.expectConverged(alice, bob);
  });

  test('a cross-paragraph type-over in a header story replicates', async () => {
    const { alice, bob } = await harness.pair(HEADER_DOC);
    harness.apply(alice, typeOverOps(alice, 0, 4, 1, 4, 'x', HEADER), HEADER);
    expectJoined(alice, bob, 'HeadxTwo', HEADER);
  });

  test('a concurrent edit in another paragraph still converges', async () => {
    const { alice, bob } = await harness.pair(THREE);
    const charlie = paragraphNodes(bob)[2]!.id;
    const refusal = alice.room.session.gateOperations(
      typeOverOps(alice, 0, 2, 1, 2, '[span-edit]'),
      BODY
    );
    if (refusal) throw new Error(`gate refused: ${refusal}`);
    const aliceResult = alice.store.transact(BODY, (context) => {
      for (const op of typeOverOps(alice, 0, 2, 1, 2, '[span-edit]')) context.apply(op);
    });
    if (!aliceResult.ok) throw new Error(aliceResult.detail ?? aliceResult.reason);
    const bobRefusal = bob.room.session.gateOperations(
      [{ op: 'insertText', paragraphId: charlie, offset: 7, text: '-B' }],
      BODY
    );
    if (bobRefusal) throw new Error(`gate refused: ${bobRefusal}`);
    const bobResult = bob.store.transact(BODY, (context) => {
      context.apply({ op: 'insertText', paragraphId: charlie, offset: 7, text: '-B' });
    });
    if (!bobResult.ok) throw new Error(bobResult.detail ?? bobResult.reason);
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    expect(paragraphTexts(alice)).toEqual(['Al[span-edit]avo', 'Charlie-B']);
    expect(paragraphTexts(bob)).toEqual(['Al[span-edit]avo', 'Charlie-B']);
    harness.expectConverged(alice, bob);
  });

  test('a join across table cells stays a not-adjacent-siblings refusal', async () => {
    const { alice, bob } = await harness.pair(TABLE_CELL);
    const first = paragraphNodes(alice).find((paragraph) => paragraph.text === 'CellOne');
    const other = paragraphNodes(alice).find((paragraph) => paragraph.text === 'Other');
    if (!first || !other) throw new Error('missing cell paragraphs');
    const before = paragraphTexts(alice);
    const result = alice.store.transact(BODY, (context) => {
      context.apply({ op: 'joinParagraphs', firstId: first.id, secondId: other.id });
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.reason).toBe('not-adjacent-siblings');
    expect(paragraphTexts(alice)).toEqual(before);
    expect(paragraphTexts(bob)).toEqual(before);
    expect(alice.room.session.status()).toBe('ready');
    expect(bob.room.session.status()).toBe('ready');
  });
});
