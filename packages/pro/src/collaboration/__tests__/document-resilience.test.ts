/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Membership, reload, offline reconnect, and last-peer save must keep every replica on
// the same canonical package. A green test that only asserts "no throw" is not coverage.

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  addPackageComment,
  readOoxmlPackage,
  type OoxmlNode,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import {
  BODY,
  CT,
  OD,
  R,
  REL,
  W,
  createPeerHarness,
  nodeText,
  walk,
  type Peer,
} from './document-peer-support.ts';
import { packageDigest, packageFingerprint, saveReopenDigest } from './document-support.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const COMMENTS_PART = '/word/comments.xml';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

const harness = createPeerHarness('document-resilience-room');

afterEach(() => harness.cleanup());

function picture(embed: string): string {
  return (
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
    `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/>` +
    `</pic:nvPicPr><pic:blipFill><a:blip r:embed="${embed}"/>` +
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="914400" cy="914400"/></a:xfrm>' +
    '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>'
  );
}

function mixedDocx(): Uint8Array {
  const imageParagraph =
    `<w:p><w:r><w:t xml:space="preserve">Inline: </w:t></w:r>` +
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    '<wp:extent cx="190500" cy="190500"/>' +
    '<wp:docPr id="1" name="red"/>' +
    `${picture('rId2')}</wp:inline></w:drawing></w:r></w:p>`;
  const table =
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
    '<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>r1c1</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr/><w:p><w:r><w:t>r1c2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
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
        `<w:body>${imageParagraph}${table}<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>` +
        '<w:sectPr/></w:body></w:document>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId2" Type="${IMG}" Target="media/image1.png"/>` +
        '</Relationships>'
    ),
    'word/media/image1.png': PNG_1X1,
  });
}

function proseDocx(): Uint8Array {
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
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Bravo</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Charlie</w:t></w:r></w:p>' +
        '<w:sectPr/></w:body></w:document>'
    ),
  });
}

function kindsOf(pkg: OoxmlPackage, kind: OoxmlNode['kind']): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return found;
  walk(main.root, (node) => {
    if (node.kind === kind) found.push(node);
  });
  return found;
}

function storyText(pkg: OoxmlPackage): string {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  return main ? nodeText(main.root) : '';
}

function paragraphTexts(pkg: OoxmlPackage): string[] {
  return kindsOf(pkg, 'paragraph').map(nodeText);
}

function paragraphIdByText(peer: Peer, text: string): string {
  const pkg = harness.packageOf(peer);
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) throw new Error('no main part');
  let id: string | undefined;
  walk(main.root, (node) => {
    if (node.kind === 'paragraph' && nodeText(node).includes(text)) id = node.id;
  });
  if (!id) throw new Error(`paragraph containing ${text} missing`);
  return id;
}

function pngBytes(pkg: OoxmlPackage): Uint8Array | undefined {
  return pkg.partBytes.get('/word/media/image1.png') ?? pkg.partBytes.get('word/media/image1.png');
}

function commentBody(pkg: OoxmlPackage): string | null {
  const part = pkg.parts.get(COMMENTS_PART);
  return part ? nodeText(part.root) : null;
}

function addCommentOn(peer: Peer, paragraphId: string, text: string): string {
  const result = addPackageComment(
    peer.store,
    {
      anchor: { paragraphId, start: 0, end: 5 },
      author: peer.room.session.identity.name,
      text,
      actorId: peer.room.session.identity.actorId,
    },
    BODY
  );
  if (!result.ok) throw new Error(String(result.reason));
  peer.port.flushPendingJournals();
  return result.commentId;
}

function expectAllConverged(...peers: readonly Peer[]): void {
  const first = peers[0];
  if (!first) return;
  for (let index = 1; index < peers.length; index += 1) {
    harness.expectConverged(first, peers[index]!);
  }
}

function reopenSaved(peer: Peer): OoxmlPackage {
  const loaded = readOoxmlPackage(peer.port.save());
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

describe('replicated document resilience', () => {
  test('a third peer joins mid-session and later edits reach the others', async () => {
    const { alice, bob } = await harness.pair(mixedDocx());
    const commentId = addCommentOn(alice, paragraphIdByText(alice, 'Alpha'), 'alice remark');
    const table = kindsOf(harness.packageOf(alice), 'table')[0];
    const row = kindsOf(harness.packageOf(alice), 'tableRow')[0];
    if (!table || !row) throw new Error('no table');
    harness.apply(bob, [
      { op: 'insertTableRow', tableId: table.id, rowId: row.id, where: 'below' },
    ]);
    harness.expectConverged(alice, bob);

    const carol = await harness.join(alice, 'carol');
    expectAllConverged(alice, bob, carol);
    expect(pngBytes(harness.packageOf(carol))).toEqual(PNG_1X1);
    expect(commentBody(harness.packageOf(carol))).toContain('alice remark');
    expect(kindsOf(harness.packageOf(carol), 'tableRow')).toHaveLength(2);
    expect(kindsOf(harness.packageOf(carol), 'commentRangeStart').length).toBeGreaterThan(0);

    harness.apply(carol, [
      { op: 'insertText', paragraphId: paragraphIdByText(carol, 'Alpha'), offset: 5, text: '-C' },
    ]);
    expect(storyText(harness.packageOf(alice))).toContain('Alpha-C');
    expect(storyText(harness.packageOf(bob))).toContain('Alpha-C');
    expect(commentBody(harness.packageOf(alice))).toContain('alice remark');
    expect(commentId.length).toBeGreaterThan(0);
    expectAllConverged(alice, bob, carol);
  });

  test('a fresh peer sees edits made after the other replica left', async () => {
    const { alice, bob } = await harness.pair(proseDocx());
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 5, text: '-seen' },
    ]);
    harness.expectConverged(alice, bob);
    harness.leave(bob);
    harness.apply(alice, [
      {
        op: 'insertText',
        paragraphId: harness.paragraphIdAt(alice, 1),
        offset: 5,
        text: '-alone',
      },
    ]);
    const carol = await harness.join(alice, 'carol');
    expect(storyText(harness.packageOf(carol))).toContain('Alpha-seen');
    expect(storyText(harness.packageOf(carol))).toContain('Bravo-alone');
    expect(storyText(harness.packageOf(carol))).not.toContain('Charlie-');
    harness.expectConverged(alice, carol);
    harness.apply(carol, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(carol, 2), offset: 7, text: '-C' },
    ]);
    expect(storyText(harness.packageOf(alice))).toContain('Charlie-C');
    harness.expectConverged(alice, carol);
  });

  test('reload from the surviving peer converges and can edit again', async () => {
    const { alice, bob } = await harness.pair(proseDocx());
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 5, text: '-A' },
    ]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset: 5, text: '-B' },
    ]);
    harness.expectConverged(alice, bob);
    harness.leave(alice);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 2), offset: 7, text: '-solo' },
    ]);
    const reloaded = await harness.join(bob, 'alice');
    expect(storyText(harness.packageOf(reloaded))).toContain('Alpha-A');
    expect(storyText(harness.packageOf(reloaded))).toContain('Bravo-B');
    expect(storyText(harness.packageOf(reloaded))).toContain('Charlie-solo');
    harness.expectConverged(bob, reloaded);
    harness.apply(reloaded, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(reloaded, 0), offset: 7, text: '!' },
    ]);
    expect(storyText(harness.packageOf(bob))).toContain('Alpha-A!');
    harness.expectConverged(bob, reloaded);
  });

  test('remount over the same Y.Doc converges and can edit again', async () => {
    const { alice, bob } = await harness.pair(proseDocx());
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 5, text: '-A' },
    ]);
    harness.expectConverged(alice, bob);
    const remounted = await harness.remount(alice);
    expect(storyText(harness.packageOf(remounted))).toContain('Alpha-A');
    harness.expectConverged(remounted, bob);
    harness.apply(remounted, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(remounted, 1), offset: 5, text: '-R' },
    ]);
    expect(storyText(harness.packageOf(bob))).toContain('Bravo-R');
    harness.expectConverged(remounted, bob);
  });

  test('offline concurrent inserts in the same paragraph converge', async () => {
    const { alice, bob, pause, resume } = await harness.pair(proseDocx());
    pause();
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 1), offset: 5, text: '-A' },
    ]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset: 0, text: 'B-' },
    ]);
    resume();
    expect(storyText(harness.packageOf(alice))).toContain('-A');
    expect(storyText(harness.packageOf(alice))).toContain('B-');
    expect(storyText(harness.packageOf(bob))).toContain('-A');
    expect(storyText(harness.packageOf(bob))).toContain('B-');
    harness.expectConverged(alice, bob);
  });

  test('offline concurrent inserts in different paragraphs converge', async () => {
    const { alice, bob, pause, resume } = await harness.pair(proseDocx());
    pause();
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 5, text: '-A' },
    ]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 2), offset: 7, text: '-B' },
    ]);
    resume();
    expect(paragraphTexts(harness.packageOf(alice))[0]).toBe('Alpha-A');
    expect(paragraphTexts(harness.packageOf(alice))[2]).toBe('Charlie-B');
    expect(paragraphTexts(harness.packageOf(bob))[0]).toBe('Alpha-A');
    expect(paragraphTexts(harness.packageOf(bob))[2]).toBe('Charlie-B');
    harness.expectConverged(alice, bob);
  });

  test('offline delete of the paragraph the other peer is typing in converges', async () => {
    const { alice, bob, pause, resume } = await harness.pair(proseDocx());
    const deletedId = harness.paragraphIdAt(alice, 1);
    const typedId = harness.paragraphIdAt(bob, 1);
    pause();
    harness.apply(alice, [{ op: 'deleteBlock', blockId: deletedId }]);
    harness.apply(bob, [{ op: 'insertText', paragraphId: typedId, offset: 5, text: '-typed' }]);
    resume();
    expect(alice.room.session.status()).toBe('ready');
    expect(bob.room.session.status()).toBe('ready');
    const left = paragraphTexts(harness.packageOf(alice));
    const right = paragraphTexts(harness.packageOf(bob));
    expect(left).toEqual(right);
    expect(left).toEqual(['Alpha', 'Charlie']);
    harness.expectConverged(alice, bob);
  });

  test('the last peer standing saves bytes that reopen equivalently', async () => {
    const { alice, bob, pause, resume } = await harness.pair(proseDocx());
    pause();
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 5, text: '-A' },
    ]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 2), offset: 7, text: '-B' },
    ]);
    resume();
    harness.expectConverged(alice, bob);
    harness.leave(bob);
    const saved = reopenSaved(alice);
    const live = harness.packageOf(alice);
    expect(packageFingerprint(saved)).toBe(packageFingerprint(live));
    expect(packageDigest(saved)).toEqual(packageDigest(live));
    expect(saveReopenDigest(live)).toEqual(packageDigest(saved));
    expect(storyText(saved)).toContain('Alpha-A');
    expect(storyText(saved)).toContain('Charlie-B');
  });
});
