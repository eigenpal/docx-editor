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
// A clipboard paste must replicate the story AND the package resources.
//
// insertFragment lands blocks in one transaction with a resource merge (styles,
// numbering, media, relationships). A journal that carries only the story leaves
// a peer with drawings, style ids, or numIds that name parts it does not hold.
// That is silent divergence — the same class of bug comment writes hit when
// comments.xml did not travel.

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  ooxmlTreesEqual,
  relationshipsOf,
  type OoxmlNode,
  type OoxmlPackage,
  type TreePackageStore,
} from '@docx-editor.dev/core/store';
import type {
  CanonicalPrimitiveJournal,
  CollaborationDocumentPort,
} from '@docx-editor.dev/core/collaboration';
import { CT, R, REL, createPeerHarness, walk } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const STYLES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const NUMBERING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const STYLES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';
const NUMBERING_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

const harness = createPeerHarness('paste-replication-room');

afterEach(() => harness.cleanup());

function hostDoc(): Uint8Array {
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
        '<w:p><w:r><w:t>Host</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'
    ),
  });
}

function formattedFragment(): Uint8Array {
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
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>BoldPaste</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    ),
  });
}

function imageFragment(): Uint8Array {
  const picture =
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
    `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/>` +
    `</pic:nvPicPr><pic:blipFill><a:blip r:embed="rId2"/>` +
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="914400" cy="914400"/></a:xfrm>' +
    '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>';
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
        '<w:body><w:p><w:r><w:t>Pic</w:t></w:r>' +
        '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="190500" cy="190500"/><wp:docPr id="1" name="dot"/>' +
        `${picture}</wp:inline></w:drawing></w:r></w:p></w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId2" Type="${IMG}" Target="media/image1.png"/>` +
        '</Relationships>'
    ),
    'word/media/image1.png': PNG_1X1,
  });
}

function styleFragment(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        `<Override PartName="/word/styles.xml" ContentType="${STYLES_CT}"/>` +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdS" Type="${STYLES}" Target="styles.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>Quoted</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}">` +
        '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/>' +
        '<w:rPr><w:i/></w:rPr></w:style></w:styles>'
    ),
  });
}

function numberingFragment(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        `<Override PartName="/word/numbering.xml" ContentType="${NUMBERING_CT}"/>` +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdN" Type="${NUMBERING}" Target="numbering.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
        '<w:r><w:t>ItemOne</w:t></w:r></w:p></w:body></w:document>'
    ),
    'word/numbering.xml': strToU8(
      `<w:numbering xmlns:w="${W}">` +
        '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' +
        '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
        '<w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum>' +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
    ),
  });
}

function allText(pkg: OoxmlPackage): string {
  const parts: string[] = [];
  for (const part of pkg.parts.values()) {
    walk(part.root, (node) => {
      if (node.kind === 'textValue') parts.push(node.value);
    });
  }
  return parts.join('');
}

function mediaPng(pkg: OoxmlPackage): Uint8Array | undefined {
  for (const [name, bytes] of pkg.partBytes) {
    if (name.includes('/media/') && name.endsWith('.png')) return bytes;
  }
  return undefined;
}

function hasRelType(pkg: OoxmlPackage, type: string): boolean {
  return relationshipsOf(pkg, pkg.mainDocumentPart).some((record) => record.type === type);
}

function hasStyleId(pkg: OoxmlPackage, styleId: string): boolean {
  const part = pkg.parts.get('/word/styles.xml');
  if (!part) return false;
  let found = false;
  walk(part.root, (node: OoxmlNode) => {
    if (node.kind === 'textValue') return;
    for (const attribute of node.attributes) {
      if (attribute.localName === 'styleId' && attribute.value === styleId) found = true;
    }
  });
  return found;
}

function hasNumId(pkg: OoxmlPackage, numId: string): boolean {
  const part = pkg.parts.get('/word/numbering.xml');
  if (!part) return false;
  let found = false;
  walk(part.root, (node: OoxmlNode) => {
    if (node.kind === 'textValue') return;
    if (node.localName !== 'num') return;
    for (const attribute of node.attributes) {
      if (attribute.localName === 'numId' && attribute.value === numId) found = true;
    }
  });
  return found;
}

function expectPackagesEqual(left: OoxmlPackage, right: OoxmlPackage): void {
  expect(packageFingerprint(right)).toBe(packageFingerprint(left));
  const leftMain = left.parts.get(left.mainDocumentPart);
  const rightMain = right.parts.get(right.mainDocumentPart);
  expect(leftMain).toBeDefined();
  expect(rightMain).toBeDefined();
  expect(ooxmlTreesEqual(leftMain!, rightMain!)).toBe(true);
  expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
}

function pasteOn(
  peer: { readonly store: TreePackageStore; readonly port: CollaborationDocumentPort },
  fragmentBytes: Uint8Array
): CanonicalPrimitiveJournal[] {
  const journals: CanonicalPrimitiveJournal[] = [];
  const stop = peer.port.observePrimitiveJournal((journal) => journals.push(journal));
  const paragraphs: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') paragraphs.push(node.id);
  });
  const paragraphId = paragraphs[0];
  if (!paragraphId) throw new Error('no host paragraph');
  const pasted = peer.store.applyFragmentPaste(
    { kind: 'body' },
    {
      paragraphId,
      offset: 0,
      fragmentBytes,
      lastMarkCovered: true,
    }
  );
  if (!pasted.ok) throw new Error(pasted.detail ?? pasted.reason);
  peer.port.flushPendingJournals();
  stop();
  return journals;
}

describe('clipboard paste replicates the story and package resources', () => {
  test('plain text and formatting arrive on the peer with matching fingerprints', async () => {
    const { alice, bob } = await harness.pair(hostDoc());
    const journals = pasteOn(alice, formattedFragment());
    const source = harness.packageOf(alice);
    const peer = harness.packageOf(bob);

    expect(allText(source)).toContain('BoldPaste');
    expect(allText(peer)).toContain('BoldPaste');
    expect(journals.length).toBeGreaterThan(0);
    expectPackagesEqual(source, peer);
    harness.expectConverged(alice, bob);
  });

  test('an inline image brings media bytes, the relationship, and the drawing', async () => {
    const { alice, bob } = await harness.pair(hostDoc());
    const journals = pasteOn(alice, imageFragment());
    const source = harness.packageOf(alice);
    const peer = harness.packageOf(bob);

    expect(allText(source)).toContain('Pic');
    expect(allText(peer)).toContain('Pic');
    expect(mediaPng(source)).toBeDefined();
    expect(mediaPng(peer)).toBeDefined();
    expect([...mediaPng(peer)!]).toEqual([...PNG_1X1]);
    expect(hasRelType(source, IMG)).toBe(true);
    expect(hasRelType(peer, IMG)).toBe(true);
    expect(
      journals.some((journal) => journal.effects.some((effect) => effect.kind === 'putBinary'))
    ).toBe(true);
    expect(
      journals.some((journal) =>
        journal.effects.some((effect) => effect.kind === 'putRelationship')
      )
    ).toBe(true);
    expectPackagesEqual(source, peer);
    harness.expectConverged(alice, bob);
  });

  test('a paragraph style not in the target arrives as styles.xml plus the relationship', async () => {
    const { alice, bob } = await harness.pair(hostDoc());
    const journals = pasteOn(alice, styleFragment());
    const source = harness.packageOf(alice);
    const peer = harness.packageOf(bob);

    expect(allText(source)).toContain('Quoted');
    expect(allText(peer)).toContain('Quoted');
    expect(source.parts.has('/word/styles.xml')).toBe(true);
    expect(peer.parts.has('/word/styles.xml')).toBe(true);
    expect(hasStyleId(source, 'Quote')).toBe(true);
    expect(hasStyleId(peer, 'Quote')).toBe(true);
    expect(hasRelType(source, STYLES)).toBe(true);
    expect(hasRelType(peer, STYLES)).toBe(true);
    expect(
      journals.some((journal) => journal.effects.some((effect) => effect.kind === 'putXmlPart'))
    ).toBe(true);
    expectPackagesEqual(source, peer);
    harness.expectConverged(alice, bob);
  });

  test('a numbered list arrives as numbering.xml plus the relationship', async () => {
    const { alice, bob } = await harness.pair(hostDoc());
    const journals = pasteOn(alice, numberingFragment());
    const source = harness.packageOf(alice);
    const peer = harness.packageOf(bob);

    expect(allText(source)).toContain('ItemOne');
    expect(allText(peer)).toContain('ItemOne');
    expect(source.parts.has('/word/numbering.xml')).toBe(true);
    expect(peer.parts.has('/word/numbering.xml')).toBe(true);
    expect(hasNumId(source, '1')).toBe(true);
    expect(hasNumId(peer, '1')).toBe(true);
    expect(hasRelType(source, NUMBERING)).toBe(true);
    expect(hasRelType(peer, NUMBERING)).toBe(true);
    expect(
      journals.some((journal) => journal.effects.some((effect) => effect.kind === 'putXmlPart'))
    ).toBe(true);
    expectPackagesEqual(source, peer);
    harness.expectConverged(alice, bob);
  });
});
