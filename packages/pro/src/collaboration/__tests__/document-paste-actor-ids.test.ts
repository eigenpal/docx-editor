/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two peers pasting ONE fragment must not agree on the ids the paste mints.
//
// `document-paste.test.ts` proves the blocks and the package resources reach the peer. This
// proves the document-unique ids they carry are the pasting actor's. A paste freshens three
// package-wide namespaces at once — bookmark `@w:id`, revision `@w:id`, and `wp:docPr/@id` —
// and each one used to seed from "one past the highest in the target" and then count up. Two
// replicas compute that identically from one snapshot, so both pastes claim the same numbers.
//
// Only the merged document shows it: each replica alone looks correct. Word treats a `docPr`
// id as document-global and renumbers on open; a shared bookmark id makes one hyperlink
// resolve to the other peer's marker; a shared revision id makes Accept on your insertion
// accept theirs.
//
// A fragment with TWO of each is the point. A striped seed followed by `++` leaves the stripe
// on the second id, which looks striped and still collides.

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { OoxmlNode, OoxmlPackage } from '@docx-editor.dev/core/store';
import {
  CT,
  R,
  REL,
  createPeerHarness,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

/**
 * Stripe count, mirroring `ACTOR_ID_STRIPE` in core's `actor-scoped-ids.ts`.
 *
 * Restated here because the constant is engine-internal and this package reads the engine
 * through its published entry points. The assertion it buys is the one the `++` walk failed:
 * every id one actor mints sits in ONE residue class, not just the first.
 */
const ACTOR_ID_STRIPE = 65_536;

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (character) => character.charCodeAt(0)
);

const DATE = '2026-01-01T00:00:00Z';

function inlinePicture(docPrId: string): string {
  return (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="190500" cy="190500"/>' +
    `<wp:docPr id="${docPrId}" name="dot${docPrId}"/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
    '<pic:nvPicPr><pic:cNvPr id="0" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="190500" cy="190500"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r>'
  );
}

/** One paragraph carrying a bookmark, a tracked insertion, and a picture — all id-bearing. */
function markedParagraph(tag: string, index: string, docPrId: string): string {
  return (
    '<w:p>' +
    `<w:bookmarkStart w:id="1${index}" w:name="mark${tag}${index}"/>` +
    `<w:bookmarkEnd w:id="1${index}"/>` +
    `<w:ins w:id="2${index}" w:author="Source" w:date="${DATE}">` +
    `<w:r><w:t>Pasted ${index}</w:t></w:r></w:ins>` +
    inlinePicture(docPrId) +
    '</w:p>'
  );
}

/**
 * A fragment with two of every namespace the merge freshens.
 *
 * `tag` names the bookmarks. A pasted bookmark WINS a name collision — the target's same-name
 * markers are dropped — so two pastes that are meant to coexist must not share names, or the
 * second one silently removes the first one's markers and the count says nothing about ids.
 */
function multiIdFragment(tag: string): Uint8Array {
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
        `<w:body>${markedParagraph(tag, '1', '31')}${markedParagraph(tag, '2', '32')}</w:body>` +
        '</w:document>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId2" Type="${IMG}" Target="media/image1.png"/>` +
        '</Relationships>'
    ),
    'word/media/image1.png': PNG_1X1,
  });
}

function hostDocument(): Uint8Array {
  return zipDocument('<w:p><w:r><w:t>Host</w:t></w:r></w:p><w:sectPr/>');
}

const REVISION_KINDS: ReadonlySet<string> = new Set([
  'revisionInsert',
  'revisionDelete',
  'revisionMoveFrom',
  'revisionMoveTo',
]);

function idsIn(pkg: OoxmlPackage, read: (node: OoxmlNode) => string | undefined): number[] {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return [];
  const found = new Set<string>();
  walk(main.root, (node) => {
    const value = read(node);
    if (value !== undefined) found.add(value);
  });
  return [...found].map(Number).sort((left, right) => left - right);
}

function wmlId(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find(
    (attribute) => attribute.localName === 'id' && attribute.namespaceUri === W
  )?.value;
}

function bookmarkIds(pkg: OoxmlPackage): number[] {
  return idsIn(pkg, (node) =>
    node.kind !== 'textValue' && node.kind === 'bookmarkStart' ? wmlId(node) : undefined
  );
}

function revisionIds(pkg: OoxmlPackage): number[] {
  return idsIn(pkg, (node) =>
    node.kind !== 'textValue' && REVISION_KINDS.has(node.kind) ? wmlId(node) : undefined
  );
}

function docPrIds(pkg: OoxmlPackage): number[] {
  return idsIn(pkg, (node) =>
    node.kind !== 'textValue' && node.kind === 'drawingDocPr'
      ? node.attributes.find(
          (attribute) => attribute.localName === 'id' && attribute.namespaceUri === ''
        )?.value
      : undefined
  );
}

/** One paste at the head of the peer's first paragraph, attributed to the peer's actor. */
function pasteOn(
  harness: ReturnType<typeof createPeerHarness>,
  peer: Peer,
  fragmentBytes: Uint8Array
): void {
  const pasted = peer.store.applyFragmentPaste(
    { kind: 'body' },
    {
      paragraphId: harness.paragraphIdAt(peer, 0),
      offset: 0,
      fragmentBytes,
      lastMarkCovered: true,
      actorId: peer.room.session.identity.actorId,
    }
  );
  if (!pasted.ok) throw new Error(pasted.detail ?? pasted.reason);
  peer.port.flushPendingJournals();
}

/** Every id one actor minted must share one residue class — the stripe it was given. */
function expectOneStripe(minted: readonly number[]): void {
  expect(minted.length).toBeGreaterThan(1);
  const residues = new Set(minted.map((id) => id % ACTOR_ID_STRIPE));
  expect(residues.size).toBe(1);
}

const harness = createPeerHarness('paste-actor-id-room');

afterEach(() => harness.cleanup());

describe('concurrent pastes stripe every id namespace they mint', () => {
  test('two peers pasting one fragment share no bookmark, revision, or docPr id', async () => {
    const { alice, bob, pause, resume } = await harness.pair(hostDocument());
    const fragmentBytes = multiIdFragment('same');

    pause();
    pasteOn(harness, alice, fragmentBytes);
    pasteOn(harness, bob, fragmentBytes);

    const mintedByAlice = {
      bookmarks: bookmarkIds(harness.packageOf(alice)),
      revisions: revisionIds(harness.packageOf(alice)),
      docPr: docPrIds(harness.packageOf(alice)),
    };
    const mintedByBob = {
      bookmarks: bookmarkIds(harness.packageOf(bob)),
      revisions: revisionIds(harness.packageOf(bob)),
      docPr: docPrIds(harness.packageOf(bob)),
    };

    // Two of each travelled, so two of each were minted.
    for (const family of ['bookmarks', 'revisions', 'docPr'] as const) {
      expect(mintedByAlice[family]).toHaveLength(2);
      expect(mintedByBob[family]).toHaveLength(2);
      // The collision this exists to prevent: no value on both sides.
      const shared = mintedByAlice[family].filter((id) => mintedByBob[family].includes(id));
      expect(shared).toEqual([]);
      // And the SECOND id stayed in the stripe rather than walking out of it.
      expectOneStripe(mintedByAlice[family]);
      expectOneStripe(mintedByBob[family]);
    }

    // Whether two concurrent pastes both survive the merge is a question about the
    // replication model, not about the ids, and this engine resolves the story part to one of
    // them. So the relay is released only to leave the room in a clean state.
    resume();
  });

  test('a paste onto a peer already holding one lands four distinct ids', async () => {
    // The sequential case, with the relay live: bob pastes into a document that already
    // carries alice's paste. Every id must still be distinct, so a striped mint cannot
    // silently reuse an id it can see.
    const { alice, bob } = await harness.pair(hostDocument());

    pasteOn(harness, alice, multiIdFragment('first'));
    pasteOn(harness, bob, multiIdFragment('second'));

    const landed = harness.packageOf(bob);
    for (const ids of [bookmarkIds(landed), revisionIds(landed), docPrIds(landed)]) {
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(4);
    }
  });
});
