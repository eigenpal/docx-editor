/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';

/** A 1x1 GIF89a: a format PDF has no filter for, so the writer cannot embed it. */
const GIF: Uint8Array<ArrayBuffer> = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
  0x01, 0x00, 0x3b,
]);

/** A 1x1 opaque PNG: a format the writer does embed. */
function png(): Uint8Array<ArrayBuffer> {
  const crcTable = Array.from({ length: 256 }, (_unused, index) => {
    let c = index;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Uint8Array): number => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (tag: string, data: Uint8Array): number[] => {
    const tagged = Uint8Array.from([...strToU8(tag), ...data]);
    const length = data.length;
    return [
      (length >>> 24) & 0xff,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
      ...tagged,
      (crc(tagged) >>> 24) & 0xff,
      (crc(tagged) >>> 16) & 0xff,
      (crc(tagged) >>> 8) & 0xff,
      crc(tagged) & 0xff,
    ];
  };
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
    ...chunk('IDAT', new Uint8Array(deflateSync(Uint8Array.from([0, 0x40, 0x80, 0xc0])))),
    ...chunk('IEND', new Uint8Array(0)),
  ]);
}

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * A fixture that already exports cleanly, with a picture bullet spliced into its numbering.
 *
 * Built by replacing parts of a package that already exports, rather than hand-rolling a
 * minimal one: only `numbering.xml`, its rels, the media part and the content types move,
 * plus one paragraph's `w:numId` so a marker is actually published.
 */
function withPictureBullet(media: Uint8Array<ArrayBuffer>, extension: 'gif' | 'png'): Uint8Array {
  const source = new Uint8Array(
    readFileSync(new URL('../../../e2e/fixtures/issue-483-firstline-marker.docx', import.meta.url))
  );
  const files = unzipSync(source);
  const numbering = strFromU8(files['word/numbering.xml']!);
  const bullet =
    `<w:numPicBullet w:numPicBulletId="0"><w:pict>` +
    `<v:shape id="_x0000_i1030" type="#_x0000_t75" style="width:9pt;height:9pt" o:bullet="t">` +
    `<v:imagedata r:id="rId1" o:title="bullet"/></v:shape></w:pict></w:numPicBullet>`;
  // `w:numPicBullet` leads the CT_Numbering sequence; abstractNum 0 / ilvl 0 is the level
  // every `w:num` in this fixture points at.
  files['word/numbering.xml'] = strToU8(
    numbering
      .replace('><w:abstractNum', `>${bullet}<w:abstractNum`)
      .replace('<w:lvlText w:val="%1."/>', '<w:lvlText w:val="%1."/><w:lvlPicBulletId w:val="0"/>')
  );
  // The fixture's numbered paragraphs name `w:numId="0"`, which is "no numbering". Point the
  // first one at a real definition so the level resolves and a marker is published.
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']!).replace('<w:numId w:val="0"/>', '<w:numId w:val="1"/>')
  );
  files['word/_rels/numbering.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${R}/image" Target="media/bullet.${extension}"/>` +
      `</Relationships>`
  );
  files[`word/media/bullet.${extension}`] = media;
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace(
      '<Default',
      `<Default Extension="${extension}" ContentType="image/${extension}"/><Default`
    )
  );
  return zipSync(files);
}

test('a GIF picture bullet still exports under the strict fidelity policy', async () => {
  // The regression this pins: drawing the bullet at all made the writer report an
  // `unsupported` format, and strict fidelity then refused the WHOLE document — much worse
  // than the text marker it replaced. PDF has no GIF filter, so the level's own `w:lvlText`
  // is drawn and the fact is reported at `information`, which strict accepts.
  const result = await exportPdf(withPictureBullet(GIF, 'gif'), { useSystemFonts: false });
  expect(result.pageCount).toBeGreaterThan(0);
  expect(result.diagnostics.length).toBeGreaterThan(0);
  for (const diagnostic of result.diagnostics) {
    expect(diagnostic.code).toBe('list-picture-bullet');
    expect(diagnostic.severity).toBe('information');
    expect(diagnostic.message).toBe(
      'Picture bullet drawn as its level text (format not embeddable: image/gif)'
    );
  }
});

test('an embeddable picture bullet is drawn, and reports nothing', async () => {
  const result = await exportPdf(withPictureBullet(png(), 'png'), { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  const images = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  expect(images.keys().length).toBeGreaterThan(0);
});

test('a picture bullet whose relationship is missing falls back without refusing', async () => {
  const files = unzipSync(withPictureBullet(GIF, 'gif'));
  delete files['word/_rels/numbering.xml.rels'];
  const result = await exportPdf(zipSync(files), { useSystemFonts: false });
  expect(result.pageCount).toBeGreaterThan(0);
  expect(new Set(result.diagnostics.map((entry) => entry.severity))).toEqual(
    new Set(['information'])
  );
  expect(result.diagnostics[0]!.message).toContain('image missing');
});
