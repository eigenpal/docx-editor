/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A LIVE image insert, across two replicas.
//
// `document-images.test.ts` covers images that arrived in the seeded document. This covers the
// insert itself, which is a different failure: `insertImage` committed on the story store and
// never entered `runObservedStoreTransaction`, so the drawing, the media bytes, the image
// relationship and the content-type override all stayed local. The peer kept the old page and
// nothing reported it.
//
// Four things have to travel for one insert to arrive, and each has its own way of failing:
// the drawing tree, the `putBinary` payload through the shared blob map (or materialize fails
// `missing-blob`), the `r:embed` relationship, and the `wp`/`a`/`pic` prefixes the drawing is
// written under (or the peer refuses the part as `invalid-qname`).

import { afterEach, describe, expect, test } from 'bun:test';
import type { ImageDecodePort, OoxmlNode, OoxmlPackage } from '@docx-editor.dev/core/store';
import { BODY, createPeerHarness, walk, zipDocument } from './document-peer-support.ts';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (character) => character.charCodeAt(0)
);

const decodePort: ImageDecodePort = {
  decode: async () => ({ pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 }),
};

function textDocument(): Uint8Array {
  return zipDocument(
    '<w:p><w:r><w:t>Paragraph one</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Paragraph two</w:t></w:r></w:p><w:sectPr/>'
  );
}

function drawingCount(pkg: OoxmlPackage): number {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return 0;
  let found = 0;
  walk(main.root, (node) => {
    if (node.kind === 'drawing') found += 1;
  });
  return found;
}

function embedIds(pkg: OoxmlPackage): string[] {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  const found: string[] = [];
  if (!main) return found;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    for (const attribute of node.attributes) {
      if (attribute.localName === 'embed') found.push(attribute.value);
    }
    for (const child of node.children) visit(child);
  };
  visit(main.root);
  return found;
}

function mediaBytes(pkg: OoxmlPackage): Uint8Array[] {
  const found: Uint8Array[] = [];
  for (const [name, bytes] of pkg.partBytes) {
    if (name.includes('/media/')) found.push(bytes);
  }
  return found;
}

const harness = createPeerHarness('image-insert-room');

afterEach(() => harness.cleanup());

describe('a live image insert reaches the peer', () => {
  test('the drawing, the media bytes and the image relationship all travel', async () => {
    const { alice, bob } = await harness.pair(textDocument());
    expect(drawingCount(harness.packageOf(bob))).toBe(0);

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

    const source = harness.packageOf(alice);
    const joined = harness.packageOf(bob);

    expect(drawingCount(joined)).toBe(drawingCount(source));
    expect(drawingCount(joined)).toBe(1);
    expect(embedIds(joined)).toEqual(embedIds(source));

    const owner = joined.mainDocumentPart;
    const embed = embedIds(joined)[0];
    expect(embed).toBeDefined();
    expect(joined.relationships.get(owner)?.some((record) => record.id === embed)).toBe(true);

    const joinedMedia = mediaBytes(joined);
    expect(joinedMedia).toHaveLength(1);
    expect([...joinedMedia[0]!]).toEqual([...PNG_1X1]);

    harness.expectConverged(alice, bob);
  });

  test('an image with a hyperlink carries the external target too', async () => {
    const { alice, bob } = await harness.pair(textDocument());

    const inserted = await alice.store.insertImage(BODY, {
      paragraphId: harness.paragraphIdAt(alice, 0),
      offset: 0,
      bytes: PNG_1X1,
      mime: 'image/png',
      widthPoints: 12,
      heightPoints: 12,
      decodePort,
      expectedPackageRevision: alice.store.packageRevision,
      hyperlink: 'https://example.com/picture',
    });
    expect(inserted.ok).toBe(true);
    alice.port.flushPendingJournals();

    const joined = harness.packageOf(bob);
    const external = joined.externalTargets.filter(
      (entry) => entry.rawTarget === 'https://example.com/picture'
    );
    expect(external).toHaveLength(1);
    expect(external[0]!.ownerPart).toBe(joined.mainDocumentPart);

    harness.expectConverged(alice, bob);
  });

  test('deleting the image withdraws the bytes and the relationship on the peer', async () => {
    const { alice, bob } = await harness.pair(textDocument());
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
    expect(drawingCount(harness.packageOf(bob))).toBe(1);

    const drawingNodeId = inserted.ok ? inserted.drawingNodeId : undefined;
    expect(drawingNodeId).toBeDefined();
    const deleted = alice.store.deleteImage(BODY, drawingNodeId!);
    expect(deleted.ok).toBe(true);
    alice.port.flushPendingJournals();

    const joined = harness.packageOf(bob);
    expect(drawingCount(joined)).toBe(0);
    expect(mediaBytes(joined)).toHaveLength(0);
    harness.expectConverged(alice, bob);
  });
});
