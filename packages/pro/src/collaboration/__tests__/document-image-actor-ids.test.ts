/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two peers inserting a picture from ONE snapshot must not agree on `wp:docPr/@id`.
//
// `document-image-insert.test.ts` proves one insert reaches the peer. This proves the id it
// carries is the inserting actor's, not a value both peers computed the same way. `docPr` ids
// are document-global to Word: two drawings under one id makes Word renumber on open, and the
// merged document is the only place that shows it — each replica looks fine alone.
//
// The actor is passed the way `paginated-surface.ts` passes it, as a VALUE. `insertImage`
// awaits a decode before it mints, and `runWithTransactionActor` is ambient and synchronous,
// so an ambient wrap around this call would already be unbound at the mint.

import { afterEach, describe, expect, test } from 'bun:test';
import type { ImageDecodePort, OoxmlNode, OoxmlPackage } from '@docx-editor.dev/core/store';
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

function textDocument(): Uint8Array {
  return zipDocument(
    '<w:p><w:r><w:t>Paragraph one</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Paragraph two</w:t></w:r></w:p><w:sectPr/>'
  );
}

function docPrIds(pkg: OoxmlPackage): string[] {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  const found: string[] = [];
  if (!main) return found;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'drawingDocPr') {
      const id = node.attributes.find(
        (attribute) => attribute.localName === 'id' && attribute.namespaceUri === ''
      )?.value;
      if (id !== undefined) found.push(id);
    }
    for (const child of node.children) visit(child);
  };
  visit(main.root);
  return found;
}

/** One picture at the head of the peer's first paragraph, attributed to the peer's actor. */
async function insertPicture(harness: ReturnType<typeof createPeerHarness>, peer: Peer) {
  const inserted = await peer.store.insertImage(BODY, {
    paragraphId: harness.paragraphIdAt(peer, 0),
    offset: 0,
    bytes: PNG_1X1,
    mime: 'image/png',
    widthPoints: 12,
    heightPoints: 12,
    decodePort,
    expectedPackageRevision: peer.store.packageRevision,
    actorId: peer.room.session.identity.actorId,
  });
  if (!inserted.ok) throw new Error(inserted.detail ?? inserted.reason);
  peer.port.flushPendingJournals();
}

const harness = createPeerHarness('image-actor-id-room');

afterEach(() => harness.cleanup());

describe('concurrent image inserts stripe their docPr ids', () => {
  test('two peers inserting from one snapshot take different docPr ids', async () => {
    const { alice, bob, pause, resume } = await harness.pair(textDocument());

    pause();
    await insertPicture(harness, alice);
    await insertPicture(harness, bob);

    const mintedByAlice = docPrIds(harness.packageOf(alice));
    const mintedByBob = docPrIds(harness.packageOf(bob));
    expect(mintedByAlice).toHaveLength(1);
    expect(mintedByBob).toHaveLength(1);
    expect(mintedByAlice[0]).not.toBe(mintedByBob[0]);

    resume();

    const merged = docPrIds(harness.packageOf(alice));
    expect(merged).toHaveLength(2);
    expect(new Set(merged).size).toBe(2);
    expect(new Set(merged)).toEqual(new Set([mintedByAlice[0]!, mintedByBob[0]!]));
  });
});
