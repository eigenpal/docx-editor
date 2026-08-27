/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What it costs to PUBLISH one inserted image, in work rather than in milliseconds.
//
// `publishJournalBlobs` used to `save()` the whole package and `readOoxmlPackage` it again
// inside the open Yjs transaction. A duration passes on a fast machine while that walk is
// still linear in the document. These gates count serialize visits and package reads.

import { afterEach, describe, expect, test } from 'bun:test';
import type { CanonicalPrimitiveEffect } from '@docx-editor.dev/core/collaboration/replication';
import type { ImageDecodePort } from '@docx-editor.dev/core/store';
import { ooxmlPackageReadCount } from '../../../../core/src/store/package/ooxml-package.ts';
import { canonicalSerializeNodeVisits } from '../../../../core/src/store/package/ooxml-serialize.ts';
import { collectJournalBinaryPayloads, journalBinaryLookupCount } from '../document/seed.ts';
import { BODY, createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (character) => character.charCodeAt(0)
);

const decodePort: ImageDecodePort = {
  decode: async () => ({ pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 }),
};

const IMAGE_KEY = '/word/media/image1.png';

const harness = createPeerHarness('image-publish-cost');

afterEach(() => harness.cleanup());

function paragraphsDocument(count: number): Uint8Array {
  const body = Array.from(
    { length: count },
    (_, index) => `<w:p><w:r><w:t>Paragraph ${String(index)}</w:t></w:r></w:p>`
  ).join('');
  return zipDocument(`${body}<w:sectPr/>`);
}

function mediaCount(peer: Peer): number {
  let found = 0;
  for (const name of peer.store.currentPackage().partBytes.keys()) {
    if (name.includes('/media/')) found += 1;
  }
  return found;
}

async function publishOneImage(paragraphs: number): Promise<{
  readonly serializeVisits: number;
  readonly packageReads: number;
}> {
  const { alice, bob } = await harness.pair(paragraphsDocument(paragraphs));
  const serializeBefore = canonicalSerializeNodeVisits();
  const readsBefore = ooxmlPackageReadCount();
  const inserted = await alice.store.insertImage(BODY, {
    paragraphId: harness.paragraphIdAt(alice, 0),
    offset: 0,
    bytes: PNG_1X1,
    mime: 'image/png',
    widthPoints: 12,
    heightPoints: 12,
    decodePort,
    expectedPackageRevision: alice.store.packageRevision,
  });
  expect(inserted.ok).toBe(true);
  alice.port.flushPendingJournals();
  const cost = {
    serializeVisits: canonicalSerializeNodeVisits() - serializeBefore,
    packageReads: ooxmlPackageReadCount() - readsBefore,
  };
  expect(mediaCount(alice)).toBe(1);
  expect(mediaCount(bob)).toBe(1);
  const carol = await harness.join(alice, 'carol');
  expect(mediaCount(carol)).toBe(1);
  return cost;
}

describe('cost of publishing one inserted image', () => {
  test('resolving one image looks up that image, not every part', () => {
    const descriptor = {
      storageKey: IMAGE_KEY,
      digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      size: PNG_1X1.byteLength,
      mediaType: 'image/png',
    };
    const effect: CanonicalPrimitiveEffect = { kind: 'putBinary', descriptor };
    const small = new Map<string, Uint8Array>([[IMAGE_KEY, PNG_1X1]]);
    const large = new Map<string, Uint8Array>(small);
    for (let index = 0; index < 80; index += 1) {
      large.set(`/word/media/noise-${String(index)}.bin`, PNG_1X1);
    }
    const before = journalBinaryLookupCount();
    const smallResult = collectJournalBinaryPayloads([effect], (key) => small.get(key) ?? null);
    const smallLookups = journalBinaryLookupCount() - before;
    const largeResult = collectJournalBinaryPayloads([effect], (key) => large.get(key) ?? null);
    const largeLookups = journalBinaryLookupCount() - before - smallLookups;
    expect(smallResult?.ok).toBe(true);
    expect(largeResult?.ok).toBe(true);
    expect(smallLookups).toBe(1);
    expect(largeLookups).toBe(1);
  });

  test('publishing one image does not serialize or re-parse the document', async () => {
    const small = await publishOneImage(4);
    const large = await publishOneImage(80);
    // A full-package save walks every XML node. One image may still serialize its drawing
    // fragment, which must not grow with the rest of the document.
    expect(large.serializeVisits).toBe(small.serializeVisits);
    expect(large.packageReads).toBe(small.packageReads);
    expect(large.packageReads).toBe(0);
    expect(large.serializeVisits).toBeLessThan(40);
  });
});
