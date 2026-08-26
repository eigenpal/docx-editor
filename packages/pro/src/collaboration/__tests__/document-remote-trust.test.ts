/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A peer is not a trust boundary this side of the wire.
//
// Every other limits test in this directory drives `applyPrimitiveJournal`, which is the LOCAL
// write path. These craft shared state directly instead — the shape a hostile peer produces by
// writing its own Y.Doc and letting the transport carry the update — and assert the receiving
// replica refuses rather than absorbs it.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { strToU8, zipSync } from 'fflate';
import { CT, R, REL, createPeerHarness, type Peer } from './document-peer-support.ts';
import {
  NODE_CHILDREN_FIELD,
  NODE_SHELL_FIELD,
  PACKAGE_NODES_KEY,
  PACKAGE_PARTS_KEY,
  makePartEntry,
  unpackNodeShell,
} from '../document/schema.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const BLOBS_KEY = 'docx-package-blobs-v1';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function plainDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        '<w:p><w:r><w:t>Alpha paragraph</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Beta paragraph</w:t></w:r></w:p>' +
        '<w:sectPr/></w:body></w:document>'
    ),
  });
}

function imageDocx(): Uint8Array {
  const drawing =
    '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="190500" cy="190500"/><wp:docPr id="1" name="pic"/>' +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
    `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/>` +
    '</pic:nvPicPr><pic:blipFill><a:blip r:embed="rId2"/>' +
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="914400" cy="914400"/></a:xfrm>' +
    '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r></w:p>';
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}">` +
        `<w:body>${drawing}<w:sectPr/></w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId2" Type="${IMG}" Target="media/image1.png"/>` +
        '</Relationships>'
    ),
    'word/media/image1.png': PNG_1X1,
  });
}

/** A paragraph's logical id, read straight out of shared state the way an attacker would. */
function anyParagraphLogicalId(ydoc: Y.Doc): string {
  const nodes = ydoc.getMap<Y.Map<unknown>>(PACKAGE_NODES_KEY);
  for (const [logicalId, record] of nodes) {
    const shell = record.get(NODE_SHELL_FIELD);
    if (typeof shell === 'string' && unpackNodeShell(shell).localName === 'p') return logicalId;
  }
  throw new Error('no paragraph in shared state');
}

function reason(peer: Peer): string | undefined {
  return peer.room.session.statusSnapshot().reason?.code;
}

function detail(peer: Peer): string | undefined {
  return peer.room.session.statusSnapshot().reason?.detail;
}

const harness = createPeerHarness('remote-trust-room');

afterEach(() => harness.cleanup());

describe('remote updates are held to the same limits as local writes', () => {
  test('a part flood from a peer is refused instead of materialized', async () => {
    const { alice, bob } = await harness.pair(plainDocx());
    expect(bob.room.session.status()).toBe('ready');

    // `maxParts` is 512, and nothing on the receive path used to look. The assertion is on the
    // CODE, not merely on `error`: junk part entries also fail materialize with `missing-root`,
    // so a test that accepted any error would pass without the limit check ever running.
    alice.ydoc.transact(() => {
      const parts = alice.ydoc.getMap<Y.Map<unknown>>(PACKAGE_PARTS_KEY);
      for (let index = 0; index < 600; index += 1) {
        parts.set(
          `/word/flood${index}.xml`,
          makePartEntry(`f${index}`, 'AAAAAAAA', 'application/xml')
        );
      }
    });

    expect(bob.room.session.status()).toBe('error');
    expect(reason(bob)).toBe('too-many-parts');
    // Refused, so the flood never reaches this replica's document.
    expect(harness.packageOf(bob).parts.has('/word/flood0.xml')).toBe(false);
  });

  test('edits are refused once shared state is over a limit', async () => {
    const { alice, bob } = await harness.pair(plainDocx());
    alice.ydoc.transact(() => {
      const parts = alice.ydoc.getMap<Y.Map<unknown>>(PACKAGE_PARTS_KEY);
      for (let index = 0; index < 600; index += 1) {
        parts.set(
          `/word/flood${index}.xml`,
          makePartEntry(`f${index}`, 'AAAAAAAA', 'application/xml')
        );
      }
    });

    const paragraphId = harness.paragraphIdAt(bob, 0);
    expect(
      bob.room.session.gateOperations([{ op: 'insertText', paragraphId, offset: 0, text: 'x' }], {
        kind: 'body',
      })
    ).toBe('collaboration-session-not-ready');
  });
});

describe('media bytes are verified against their digest, not trusted by it', () => {
  test('swapping the bytes behind a digest is refused', async () => {
    const { alice, bob } = await harness.pair(imageDocx());
    expect(bob.room.session.status()).toBe('ready');

    const blobs = alice.ydoc.getMap<Uint8Array>(BLOBS_KEY);
    const digests = [...blobs.keys()];
    expect(digests.length).toBeGreaterThan(0);
    const digest = digests[0]!;

    // The innocent image already verified on both replicas. Overwriting the entry now is the
    // interesting case: a digest-keyed cache would answer from memory and never look again.
    alice.ydoc.transact(() => {
      blobs.set(digest, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    });

    expect(bob.room.session.status()).toBe('error');
    expect(reason(bob)).toBe('blob-digest-mismatch');
    expect(detail(bob)).toBe(digest);

    // And the substituted bytes are not what this replica holds.
    const png =
      harness.packageOf(bob).partBytes.get('/word/media/image1.png') ??
      harness.packageOf(bob).partBytes.get('word/media/image1.png');
    expect(png === undefined || [...png].join(',') === [...PNG_1X1].join(',')).toBe(true);
  });

  test('a joiner refuses a room whose media does not match its digest', async () => {
    const alice = (await harness.pair(imageDocx())).alice;
    const blobs = alice.ydoc.getMap<Uint8Array>(BLOBS_KEY);
    const digest = [...blobs.keys()][0]!;
    alice.ydoc.transact(() => {
      blobs.set(digest, new Uint8Array([9, 9, 9, 9]));
    });

    // Joining reads the blob to materialize, so the substitution is caught before this peer
    // renders anything. `missing-blob` would be the honest report only if it were absent.
    await expect(harness.join(alice, 'carol')).rejects.toThrow('blob-digest-mismatch');
  });
});

describe('a repair that drops content leaves ready', () => {
  test('a child id that names no record is reported, not silently skipped', async () => {
    const { alice, bob } = await harness.pair(plainDocx());
    expect(bob.room.session.status()).toBe('ready');

    const paragraphId = anyParagraphLogicalId(alice.ydoc);
    alice.ydoc.transact(() => {
      const record = alice.ydoc.getMap<Y.Map<unknown>>(PACKAGE_NODES_KEY).get(paragraphId);
      const children = record?.get(NODE_CHILDREN_FIELD);
      if (!(children instanceof Y.Array)) throw new Error('no child array');
      children.push(['ZZZZZZZZ']);
    });

    // The materializer skips the unknown child and records the issue. Dropping that list was
    // what made this silent: the document is short a child and every replica said `ready`.
    expect(bob.room.session.status()).toBe('error');
    expect(reason(bob)).toBe('materialize-dropped-content');
    expect(detail(bob)).toContain('child-id-not-in-registry');
  });

  test('an ordinary edit keeps the session ready', async () => {
    // The guard above is only worth having if it stays quiet on healthy traffic.
    const { alice, bob } = await harness.pair(plainDocx());
    const paragraphId = harness.paragraphIdAt(alice, 0);
    harness.apply(alice, [{ op: 'insertText', paragraphId, offset: 0, text: 'Hello ' }]);

    expect(alice.room.session.status()).toBe('ready');
    expect(bob.room.session.status()).toBe('ready');
    harness.expectConverged(alice, bob);
  });
});
