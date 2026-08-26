/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What the MATERIALIZER costs per received character, counted rather than timed.
//
// `remote-receive-cost.test.ts` covers the fingerprint oracle. These two counters cover the
// bookkeeping either side of it, both of which are invisible to every other gate: claiming a
// reused subtree reads no record and freezes no node, and re-reading media out of the blob
// store produces no tree change at all. Both were linear in the document.

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  materializedBlobBytesRead,
  materializedPassCounts,
  materializedPlacementClaims,
} from '../document/materialize.ts';
import {
  CT,
  R,
  REL,
  createPeerHarness,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('remote-receive-bookkeeping');

afterEach(() => {
  harness.cleanup();
});

const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MEDIA_BYTES = 1024 * 1024;

function wideBody(paragraphs: number): Uint8Array {
  let body = '';
  for (let index = 0; index < paragraphs; index += 1) {
    body += `<w:p><w:r><w:t>Paragraph ${String(index)} of the fixture</w:t></w:r></w:p>`;
  }
  return zipDocument(`${body}<w:sectPr/>`);
}

/** A document whose single image is large enough that copying it cannot hide in the noise. */
function imageDocument(): Uint8Array {
  // Deliberately close to incompressible: a repeating pattern deflates past the baseline
  // zip's ratio guard and the document is refused before any of this is measured.
  const media = new Uint8Array(MEDIA_BYTES);
  let state = 0x9e3779b9;
  for (let index = 0; index < media.length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    media[index] = (state >>> 24) & 0xff;
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        '<w:p><w:r><w:t>Caption under the image</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>' +
        '<w:sectPr/></w:body></w:document>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId2" Type="${IMG}" Target="media/image1.png"/>` +
        '</Relationships>'
    ),
    'word/media/image1.png': media,
  });
}

function bodyNodeCount(peer: Peer): number {
  let count = 0;
  walk(peer.store.bodyStore().part.root, () => {
    count += 1;
  });
  return count;
}

/** Type one character and report what the receiving replica spent on bookkeeping. */
function receiveOneCharacter(
  author: Peer,
  paragraphId: string,
  offset: number
): {
  readonly placementClaims: number;
  readonly blobBytes: number;
  readonly passes: number;
  readonly fullPasses: number;
} {
  const claimsBefore = materializedPlacementClaims();
  const blobBefore = materializedBlobBytesRead();
  const passesBefore = materializedPassCounts();
  harness.apply(author, [{ op: 'insertText', paragraphId, offset, text: 'X' }]);
  const passesAfter = materializedPassCounts();
  return {
    placementClaims: materializedPlacementClaims() - claimsBefore,
    blobBytes: materializedBlobBytesRead() - blobBefore,
    passes: passesAfter.passes - passesBefore.passes,
    fullPasses: passesAfter.full - passesBefore.full,
  };
}

describe('materializer bookkeeping per received character', () => {
  test('claiming reused subtrees does not walk the document', async () => {
    const { alice, bob } = await harness.pair(wideBody(400));
    const documentNodes = bodyNodeCount(bob);
    const target = harness.paragraphIdAt(alice, 200);

    // The first edit may still find a cold cache on either side. The steady state is the gate.
    receiveOneCharacter(alice, target, 1);
    const steady = [
      receiveOneCharacter(alice, target, 2),
      receiveOneCharacter(alice, target, 3),
      receiveOneCharacter(alice, target, 4),
    ];

    console.log(
      JSON.stringify({
        documentNodes,
        placementClaimsPerCharacter: steady.map((sample) => sample.placementClaims),
        passesPerCharacter: steady.map((sample) => sample.passes),
        fullPlacementPassesPerCharacter: steady.map((sample) => sample.fullPasses),
      })
    );

    for (const sample of steady) {
      if (sample.placementClaims > 0) {
        throw new Error(
          `Receiving one character visited ${sample.placementClaims} nodes to claim reused ` +
            `subtrees, in a document of ${documentNodes} nodes. Every block the edit did not ` +
            'touch is handed back from the cache, so the walk exists only to fill a set that ' +
            'nothing on this path reads: orphan collection is off unless membership moved, ' +
            'and membership is exactly what can introduce a second parent. Claim the subtree ' +
            'root instead.'
        );
      }
    }
    harness.expectConverged(alice, bob);
  });

  test('a received character does not re-read the media it did not touch', async () => {
    const { alice, bob } = await harness.pair(imageDocument());
    const target = harness.paragraphIdAt(alice, 0);

    receiveOneCharacter(alice, target, 1);
    const steady = [receiveOneCharacter(alice, target, 2), receiveOneCharacter(alice, target, 3)];

    console.log(
      JSON.stringify({
        mediaBytesInDocument: MEDIA_BYTES,
        blobBytesReadPerCharacter: steady.map((sample) => sample.blobBytes),
      })
    );

    for (const sample of steady) {
      if (sample.blobBytes > 0) {
        throw new Error(
          `Receiving one character copied ${sample.blobBytes} bytes of media out of the blob ` +
            `store, for a document holding ${MEDIA_BYTES} bytes of it. The store returns a ` +
            'defensive copy and a descriptor names its bytes by digest, so an unchanged digest ' +
            'names bytes the materializer already holds. Fifteen megabytes of images would be ' +
            'fifteen megabytes copied per remote keystroke.'
        );
      }
    }
    // The image still has to be there — a cache that forgets it is worse than one that copies.
    const bytes = bob.store.currentPackage().partBytes.get('/word/media/image1.png');
    expect(bytes?.length).toBe(MEDIA_BYTES);
    harness.expectConverged(alice, bob);
  });
});
