/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { OoxmlNode, OoxmlPackage } from '@docx-editor.dev/core/store';
import { CT, R, REL, createPeerHarness, walk } from './document-peer-support.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

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

function imageDocx(): Uint8Array {
  const inline =
    `<w:p><w:r><w:t xml:space="preserve">Inline: </w:t></w:r>` +
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    '<wp:extent cx="190500" cy="190500"/>' +
    '<wp:docPr id="1" name="red"/>' +
    `${picture('rId2')}</wp:inline></w:drawing></w:r>` +
    `<w:r><w:t xml:space="preserve"> red</w:t></w:r></w:p>`;
  const block =
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    '<wp:extent cx="2857500" cy="762000"/>' +
    '<wp:docPr id="2" name="banner"/>' +
    `${picture('rId2')}</wp:inline></w:drawing></w:r></w:p>`;
  const floating =
    `<w:p><w:r><w:drawing>` +
    '<wp:anchor distT="0" distB="0" distL="114300" distR="0" simplePos="0" ' +
    'allowOverlap="1" behindDoc="0" locked="0" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="952500" cy="952500"/>' +
    '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="114300" distR="0"/>' +
    '<wp:docPr id="3" name="float"/>' +
    `${picture('rId2')}</wp:anchor></w:drawing></w:r>` +
    `<w:r><w:t>Wrap text beside the floating image.</w:t></w:r></w:p>`;
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
        `<w:body>${inline}${block}${floating}<w:sectPr/></w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId2" Type="${IMG}" Target="media/image1.png"/>` +
        '</Relationships>'
    ),
    'word/media/image1.png': PNG_1X1,
  });
}

function drawingKinds(pkg: OoxmlPackage): string[] {
  const kinds: string[] = [];
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return kinds;
  walk(main.root, (node) => {
    if (
      node.kind === 'drawing' ||
      node.kind === 'inlineDrawing' ||
      node.kind === 'anchoredDrawing'
    ) {
      kinds.push(node.kind);
    }
  });
  return kinds;
}

function embedIds(node: OoxmlNode, found: string[]): void {
  if (node.kind === 'textValue') return;
  for (const attribute of node.attributes) {
    if (attribute.localName === 'embed') found.push(attribute.value);
  }
  for (const child of node.children) embedIds(child, found);
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

function pngBytes(pkg: OoxmlPackage): Uint8Array | undefined {
  return pkg.partBytes.get('/word/media/image1.png') ?? pkg.partBytes.get('word/media/image1.png');
}

const harness = createPeerHarness('image-join-room');

afterEach(() => harness.cleanup());

describe('inline and anchored images replicate on join', () => {
  test('the joining peer keeps drawing kinds, embeds, and image bytes', async () => {
    const { alice, bob } = await harness.pair(imageDocx());
    const source = harness.packageOf(alice);
    const joined = harness.packageOf(bob);

    expect(drawingKinds(joined)).toContain('inlineDrawing');
    expect(drawingKinds(joined)).toContain('anchoredDrawing');
    expect(drawingKinds(joined).sort()).toEqual(drawingKinds(source).sort());

    const sourceEmbeds: string[] = [];
    const joinedEmbeds: string[] = [];
    walk(source.parts.get(source.mainDocumentPart)!.root, (node) => embedIds(node, sourceEmbeds));
    walk(joined.parts.get(joined.mainDocumentPart)!.root, (node) => embedIds(node, joinedEmbeds));
    expect(joinedEmbeds).toEqual(sourceEmbeds);
    expect(joinedEmbeds.every((id) => id === 'rId2')).toBe(true);

    const sourcePng = pngBytes(source);
    const joinedPng = pngBytes(joined);
    expect(sourcePng).toBeDefined();
    expect(joinedPng).toBeDefined();
    expect([...joinedPng!]).toEqual([...sourcePng!]);
    expect([...joinedPng!]).toEqual([...PNG_1X1]);

    const owner = joined.mainDocumentPart;
    expect(joined.relationships.get(owner)?.some((record) => record.id === 'rId2')).toBe(true);

    const text = allText(joined);
    expect(text).toContain('Inline:');
    expect(text).toContain(' red');
    expect(text.includes('d if')).toBe(false);
    expect(text.includes('Invalid image')).toBe(false);

    harness.expectConverged(alice, bob);
  });
});
