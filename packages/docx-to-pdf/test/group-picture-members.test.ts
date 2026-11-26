/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The PDF writer paints the members of a drawing group (`wpg:wgp`, CT_WordprocessingGroup; ECMA-376
// Part 1, 20.4.2.39) in document order, each picture in its own frame:
//
// - Shapes paint in bands between the pictures.
// - The geometry of a picture member (`a:prstGeom`, Part 1, 20.1.9.18) is a clip path.
// - One picture content is one PDF image object, also when two parts hold the same bytes
//   (a header part and the main document part, or two media parts).
// - A group that paints without a member reports `Shape group paints without N of its
//   members`, and the other members still paint.

import { expect, test } from 'bun:test';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';
import { exportPdf, PdfFidelityError, type PdfDiagnostic } from '../src/index.ts';
import { formatDefaultsDocx as docx } from './fixture.ts';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const IMAGE_RELATIONSHIP = `${OFFICE}/image`;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PT = 12_700;

const NAMESPACES =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"';

/** A 100pt x 50pt picture at `y` points under the group top. */
function picture(y: number, rel = 'rIdImg', geometry = 'rect'): string {
  return (
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="${y * PT}"/><a:ext cx="${100 * PT}" cy="${50 * PT}"/></a:xfrm>` +
    `<a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
  );
}

/** A 100pt x 1pt bar at `y` points under the group top, filled with an RGB colour. */
function bar(y: number, hex: string): string {
  return (
    '<wps:wsp><wps:cNvSpPr/><wps:spPr>' +
    `<a:xfrm><a:off x="0" y="${y * PT}"/><a:ext cx="${100 * PT}" cy="${PT}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>`
  );
}

/** A member that paint cannot represent. */
const FRAME_MEMBER =
  '<wpg:graphicFrame><wpg:cNvPr id="9" name="Frame"/><wpg:cNvFrPr/><wpg:xfrm>' +
  '<a:off x="0" y="0"/><a:ext cx="100" cy="100"/></wpg:xfrm></wpg:graphicFrame>';

/** A page-anchored group at (72pt, 72pt), 100pt x 200pt, behind the text. */
function groupRun(members: string): string {
  return (
    `<w:r><w:drawing ${NAMESPACES}>` +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" ' +
    'behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="1270000" cy="2540000"/><wp:wrapNone/><wp:docPr id="1" name="Group"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">' +
    '<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
    '<a:ext cx="1270000" cy="2540000"/><a:chOff x="0" y="0"/><a:chExt cx="1270000" cy="2540000"/>' +
    `</a:xfrm></wpg:grpSpPr>${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor>` +
    '</w:drawing></w:r>'
  );
}

function relationships(entries: Readonly<Record<string, string>>): string {
  const items = Object.entries(entries).map(
    ([id, target]) => `<Relationship Id="${id}" Type="${IMAGE_RELATIONSHIP}" Target="${target}"/>`
  );
  return `<Relationships xmlns="${RELS}">${items.join('')}</Relationships>`;
}

/** The group in the main document, with one media part for each relationship target. */
function input(
  members: string,
  targets: Readonly<Record<string, string>> = {},
  bytesOf: (target: string) => Uint8Array = () => PNG_1X1
): Uint8Array {
  const entries = { rIdImg: 'media/image1.png', ...targets };
  const media = Object.fromEntries(
    Object.values(entries).map((target) => [`word/${target}`, bytesOf(target)])
  );
  return docx(`<w:p>${groupRun(members)}<w:r><w:t>Text</w:t></w:r></w:p>`, {
    'word/_rels/document.xml.rels': relationships(entries),
    ...media,
  });
}

async function exported(
  bytes: Uint8Array,
  fidelityPolicy: 'strict' | 'best-effort' = 'strict',
  diagnostics: readonly Partial<PdfDiagnostic>[] = []
) {
  const result = await exportPdf(bytes, { useSystemFonts: false, fidelityPolicy });
  expect(result.diagnostics).toEqual(diagnostics.map((d) => expect.objectContaining(d)));
  const pdf = await PDFDocument.load(result.bytes);
  const streams = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, value]) => (value instanceof PDFRawStream ? [value] : []));
  /** Every image object in the file, whichever page or form uses it. */
  const imageObjects = streams.filter(
    (stream) => stream.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
  ).length;
  const commands = streams
    .filter((stream) => stream.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image'))
    .map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode()))
    .filter((text) => text.includes(' Do Q') || text.includes(' rg'))
    .join('\n');
  const names = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  return { imageObjects, pageImageNames: names?.keys().length ?? 0, commands };
}

/** A 2 x 1 pixel RGB picture: other bytes than {@link PNG_1X1}. */
const PNG_2X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg=='
  ),
  (c) => c.charCodeAt(0)
);
const HEADER_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';

/**
 * Two pages. The first-page header, the default header and the first body paragraph hold the
 * same group, and each part has its own relationship to the one media part.
 */
function withHeaders(members: string): Uint8Array {
  const header = `<w:hdr xmlns:w="${W}" xmlns:r="${OFFICE}"><w:p>${groupRun(members)}</w:p></w:hdr>`;
  const page = '<w:p><w:r><w:t>Page</w:t></w:r></w:p>';
  const types =
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    `<Override PartName="/word/header1.xml" ContentType="${HEADER_TYPE}"/>` +
    `<Override PartName="/word/header2.xml" ContentType="${HEADER_TYPE}"/></Types>`;
  return docx(
    `<w:p>${groupRun(members)}<w:r><w:t>Page</w:t></w:r></w:p>` +
      `<w:p><w:r><w:br w:type="page"/></w:r></w:p>${page}` +
      '<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr1"/>' +
      '<w:headerReference w:type="first" r:id="rIdHdr2"/><w:titlePg/>' +
      '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" ' +
      'w:left="1440" w:header="720" w:footer="720"/></w:sectPr>',
    {
      '[Content_Types].xml': types,
      'word/_rels/document.xml.rels':
        `<Relationships xmlns="${RELS}">` +
        `<Relationship Id="rIdImg" Type="${IMAGE_RELATIONSHIP}" Target="media/image1.png"/>` +
        `<Relationship Id="rIdHdr1" Type="${OFFICE}/header" Target="header1.xml"/>` +
        `<Relationship Id="rIdHdr2" Type="${OFFICE}/header" Target="header2.xml"/></Relationships>`,
      'word/header1.xml': header,
      'word/header2.xml': header,
      'word/_rels/header1.xml.rels': relationships({ rIdImg: 'media/image1.png' }),
      'word/_rels/header2.xml.rels': relationships({ rIdImg: 'media/image1.png' }),
      'word/media/image1.png': PNG_1X1,
    }
  );
}

/** The clip of the 100pt x 200pt group at (72pt, 72pt) on the 792pt page. */
const GROUP_CLIP = 'q 72 720 m 172 720 l 172 520 l 72 520 l h W n';

test('shapes paint in bands between the pictures, in document order', async () => {
  const members =
    bar(0, 'FF0000') + picture(10) + bar(70, '00FF00') + picture(80) + bar(150, '0000FF');
  const { pageImageNames, commands } = await exported(input(members));
  expect(pageImageNames).toBe(1);
  // Each picture clips to the group, then to its own 100pt x 50pt frame.
  const first = commands.indexOf(
    `${GROUP_CLIP} 72 710 m 172 710 l 172 660 l 72 660 l h W n 100 0 0 50 72 660 cm`
  );
  const second = commands.indexOf(
    `${GROUP_CLIP} 72 640 m 172 640 l 172 590 l 72 590 l h W n 100 0 0 50 72 590 cm`
  );
  const red = commands.indexOf('1 0 0 rg\n0 0 m 100 0 l 100 1 l 0 1 l h');
  const green = commands.indexOf('0 1 0 rg\n0 70 m 100 70 l 100 71 l 0 71 l h');
  const blue = commands.indexOf('0 0 1 rg\n0 150 m 100 150 l 100 151 l 0 151 l h');
  expect(red).toBeGreaterThan(-1);
  expect(first).toBeGreaterThan(red);
  expect(green).toBeGreaterThan(first);
  expect(second).toBeGreaterThan(green);
  expect(blue).toBeGreaterThan(second);
  // Each member paints once.
  expect(commands.match(/\/Im\d+ Do/g)).toHaveLength(2);
  expect(commands.match(/ rg\n\d+ \d+ m 100 /g)).toHaveLength(3);
});

// The ring clips the picture to the member's geometry, and the frame clips the cropped part
// of the image. Both apply.
test('an ellipse picture member clips its picture to its ring and its frame', async () => {
  const { commands } = await exported(input(picture(10, 'rIdImg', 'ellipse')));
  const match = commands.match(
    /q 72 720 m 172 720 l 172 520 l 72 520 l h W n ((?:[\d.]+ [\d.]+ [ml] )+)h W n 72 710 m 172 710 l 172 660 l 72 660 l h W n 100 0 0 50 72 660 cm \/Im\d+ Do Q/
  );
  expect(match).not.toBeNull();
  const ring = Array.from(match![1]!.matchAll(/([\d.]+) ([\d.]+) [ml]/g), (point) => ({
    x: Number(point[1]),
    y: Number(point[2]),
  }));
  // The ring is the ellipse inside the member frame: x in [72, 172], y in [660, 710].
  expect(ring.length).toBeGreaterThanOrEqual(8);
  expect(Math.min(...ring.map((point) => point.x))).toBeCloseTo(72, 3);
  expect(Math.max(...ring.map((point) => point.x))).toBeCloseTo(172, 3);
  expect(Math.min(...ring.map((point) => point.y))).toBeCloseTo(660, 3);
  expect(Math.max(...ring.map((point) => point.y))).toBeCloseTo(710, 3);
  for (const point of ring) {
    const radius = Math.hypot((point.x - 122) / 50, (point.y - 685) / 25);
    expect(radius).toBeGreaterThan(0.95);
    expect(radius).toBeLessThan(1.0001);
  }
  // A rectangle member clips to its frame: four corners.
  const plain = await exported(input(picture(10)));
  expect(plain.commands).toContain(
    `${GROUP_CLIP} 72 710 m 172 710 l 172 660 l 72 660 l h W n 100 0 0 50 72 660 cm`
  );
});

test('two media parts with the same bytes make one image object', async () => {
  const one = await exported(input(picture(10)));
  const twoParts = { rIdTwo: 'media/image2.png' };
  const same = await exported(input(picture(10) + picture(80, 'rIdTwo'), twoParts));
  expect(same.commands.match(/\/Im\d+ Do/g)).toHaveLength(2);
  // Both pictures paint with one image name.
  expect(new Set(same.commands.match(/\/Im\d+ Do/g)).size).toBe(1);
  expect(same.pageImageNames).toBe(1);
  expect(same.imageObjects).toBe(one.imageObjects);
  // Two parts with different bytes stay two pictures.
  const other = await exported(
    input(picture(10) + picture(80, 'rIdTwo'), twoParts, (target) =>
      target === 'media/image2.png' ? PNG_2X1 : PNG_1X1
    )
  );
  expect(other.pageImageNames).toBe(2);
  expect(other.imageObjects).toBeGreaterThan(one.imageObjects);
});

test('the same picture in two header parts and the body makes one image object', async () => {
  const one = await exported(input(picture(10)));
  const result = await exportPdf(withHeaders(picture(10)), { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  expect(result.pageCount).toBe(2);
  const pdf = await PDFDocument.load(result.bytes);
  const streams = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, value]) => (value instanceof PDFRawStream ? [value] : []));
  const isImage = (stream: PDFRawStream) =>
    stream.dict.get(PDFName.of('Subtype')) === PDFName.of('Image');
  expect(streams.filter(isImage)).toHaveLength(one.imageObjects);
  const draws = streams
    .filter((stream) => !isImage(stream))
    .map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode()))
    .map((text) => text.match(/\/Im\d+ Do/g) ?? [])
    .filter((names) => names.length > 0);
  // Page 1 paints the first-page header and the body group; page 2 paints the default header.
  expect(draws.map((names) => names.length).sort()).toEqual([1, 2]);
  expect(new Set(draws.flat()).size).toBe(1);
});

test('a group with a member that cannot paint reports it and paints the others', async () => {
  for (const [frames, count] of [
    [FRAME_MEMBER, 1],
    [FRAME_MEMBER + FRAME_MEMBER, 2],
  ] as const) {
    const bytes = input(bar(0, 'FF0000') + frames + picture(10) + bar(70, '00FF00'));
    const diagnostic = {
      code: 'drawing',
      severity: 'unsupported',
      message: `Shape group paints without ${count} of its members`,
    } as const;
    // Strict export refuses the lost content.
    const error = await exportPdf(bytes, { useSystemFonts: false }).catch(
      (cause: unknown) => cause
    );
    expect(error).toBeInstanceOf(PdfFidelityError);
    expect((error as PdfFidelityError).diagnostics).toEqual([expect.objectContaining(diagnostic)]);
    // Best-effort export reports it once and paints the picture between the two bars.
    const { commands } = await exported(bytes, 'best-effort', [diagnostic]);
    const red = commands.indexOf('1 0 0 rg');
    const image = commands.search(/100 0 0 50 72 660 cm \/Im\d+ Do Q/);
    const green = commands.indexOf('0 1 0 rg');
    expect(red).toBeGreaterThan(-1);
    expect(image).toBeGreaterThan(red);
    expect(green).toBeGreaterThan(image);
  }
});

test('a group of vector members only reports a member that cannot paint', async () => {
  const bytes = input(bar(0, 'FF0000') + FRAME_MEMBER);
  const { commands } = await exported(bytes, 'best-effort', [
    {
      code: 'drawing',
      severity: 'unsupported',
      message: 'Shape group paints without 1 of its members',
    },
  ]);
  expect(commands).toContain('1 0 0 rg');
});

test('a turned and mirrored picture member paints turned about the centre of its frame', async () => {
  // `a:xfrm` (CT_Transform2D; ECMA-376 Part 1, 20.1.7.6) mirrors the picture, then turns it a
  // quarter turn clockwise about the frame centre, which is (122, 685) in PDF space.
  const turned = picture(10).replace('<a:xfrm>', '<a:xfrm rot="5400000" flipH="1">');
  for (const members of [turned + picture(80), picture(80) + turned]) {
    const { commands } = await exported(input(members));
    // The image's bottom left corner lands at (97, 635): its x axis runs up the page and its
    // y axis runs to the right. The turned picture paints whole, past the group extent.
    expect(commands).toContain(
      'q 147 635 m 147 735 l 97 735 l 97 635 l h W n 147 635 m 147 735 l 97 735 l 97 635 l h W n ' +
        '0 100 50 0 97 635 cm'
    );
    // The other picture stays upright in its own frame.
    expect(commands).toContain(
      `${GROUP_CLIP} 72 640 m 172 640 l 172 590 l 72 590 l h W n 100 0 0 50 72 590 cm`
    );
  }
});

test('a:alphaModFix makes its own picture translucent, and no other picture', async () => {
  // `a:alphaModFix` (ECMA-376 Part 1, 20.1.8.6) on the blip of one picture member.
  const alpha = picture(10).replace(
    '<a:blip r:embed="rIdImg"/>',
    '<a:blip r:embed="rIdImg"><a:alphaModFix amt="50000"/></a:blip>'
  );
  for (const members of [alpha + picture(80), picture(80) + alpha]) {
    const { commands } = await exported(input(members));
    const draws = commands.split('\n').filter((line) => line.includes(' Do Q'));
    expect(draws).toHaveLength(2);
    const translucent = draws.filter((line) => /^q \/Alpha\d+ gs /.test(line));
    expect(translucent).toHaveLength(1);
    expect(translucent[0]).toContain('100 0 0 50 72 660 cm');
  }
});

test('the outline of a turned picture member paints whole, past the group extent', async () => {
  // The frame of a picture member is its outline (`a:ln`, CT_LineProperties; ECMA-376 Part 1,
  // 20.1.2.2.24). It turns with the picture, as the outline of a turned shape member does.
  const outline = '<a:ln w="38100"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>';
  const turned = picture(0)
    .replace('<a:xfrm>', '<a:xfrm rot="1800000">')
    .replace('</pic:spPr>', `${outline}</pic:spPr>`);
  const { commands } = await exported(input(turned));
  // The corners of the turned frame reach 21.65pt above the group top (y = 741.65) and 5.80pt
  // to its left (x = 66.20). The clip of the outline adds half of the 3pt line on each side.
  const clip =
    /q ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re W n\n[^Q]*Q\nq[^\n]*Do Q\nq ([\d.]+) /.exec(commands);
  expect(clip).not.toBeNull();
  const [x, y, width, height] = clip!.slice(1, 5).map(Number) as [number, number, number, number];
  expect(x).toBeCloseTo(66.19873 - 1.5, 3);
  expect(y + height).toBeCloseTo(741.650635 + 1.5, 3);
  expect(x + width).toBeCloseTo(177.80127 + 1.5, 3);
  expect(commands).toContain('19.19873 -21.650635 m 105.80127 28.349365 l');
});

test('an upright picture that reaches past the group extent paints whole', async () => {
  // A member is not cut at the group extent. The picture starts
  // 20pt above the group top, so its frame runs from y = 740 down to y = 690.
  const { commands } = await exported(input(picture(-20) + bar(60, 'FF0000')));
  expect(commands).toContain(
    'q 72 740 m 172 740 l 172 690 l 72 690 l h W n 72 740 m 172 740 l 172 690 l 72 690 l h W n ' +
      '100 0 0 50 72 690 cm'
  );
});

test('the link of a group covers the group when a picture reaches past the extent', async () => {
  // The group is 100pt by 200pt, from (72, 520) to (172, 720) in PDF space. The picture
  // starts 20pt above it, and the link area stays that of the group.
  const rects: number[][] = [];
  for (const members of [picture(10), picture(-20)]) {
    const body = `<w:p>${groupRun(members).replace(
      '<wp:docPr id="1" name="Group"/>',
      '<wp:docPr id="1" name="Group"><a:hlinkClick r:id="rIdLink"/></wp:docPr>'
    )}<w:r><w:t>Text</w:t></w:r></w:p>`;
    const bytes = docx(body, {
      'word/_rels/document.xml.rels':
        `<Relationships xmlns="${RELS}">` +
        `<Relationship Id="rIdImg" Type="${IMAGE_RELATIONSHIP}" Target="media/image1.png"/>` +
        `<Relationship Id="rIdLink" Type="${OFFICE}/hyperlink" Target="https://example.com/" TargetMode="External"/>` +
        '</Relationships>',
      'word/media/image1.png': PNG_1X1,
    });
    const result = await exportPdf(bytes, { useSystemFonts: false });
    const pdf = await PDFDocument.load(result.bytes);
    const annotations = pdf.getPage(0).node.Annots()!;
    expect(annotations.size()).toBe(1);
    const rect = annotations.lookup(0, PDFDict).lookup(PDFName.of('Rect'), PDFArray);
    rects.push(rect.asArray().map((value) => (value as PDFNumber).asNumber()));
  }
  expect(rects[0]).toEqual([72, 520, 172, 720]);
  expect(rects[1]).toEqual(rects[0]);
});

test('a table cell still cuts a picture and the text of a group that paint past the extent', async () => {
  // An inline group, 400pt wide, in a fixed cell 200pt wide: the cell cuts the members on its
  // right edge, also when a member reaches above the extent.
  const cx = 400 * PT;
  const cy = 100 * PT;
  const textbox =
    '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr>' +
    `<a:xfrm><a:off x="${150 * PT}" y="${60 * PT}"/><a:ext cx="${200 * PT}" cy="${30 * PT}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></wps:spPr>' +
    '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Text box text here</w:t></w:r></w:p>' +
    '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>';
  // The bar reaches above the extent, so the text of the group paints past the group too.
  const members =
    picture(-5).replace('<a:off x="0"', `<a:off x="${150 * PT}"`) + bar(-5, '2040C0') + textbox;
  const drawing =
    `<w:r><w:drawing ${NAMESPACES}><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Group"/>` +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">' +
    `<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="${cx}" cy="${cy}"/></a:xfrm></wpg:grpSpPr>${members}` +
    '</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const cell = (content: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
  const bytes = docx(
    '<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr>' +
      `${cell(`<w:p>${drawing}</w:p>`)}${cell('<w:p><w:r><w:t>Next</w:t></w:r></w:p>')}` +
      '</w:tr></w:tbl><w:p/>',
    {
      'word/_rels/document.xml.rels': relationships({ rIdImg: 'media/image1.png' }),
      'word/media/image1.png': PNG_1X1,
    }
  );
  const result = await exportPdf(bytes, { useSystemFonts: false, fidelityPolicy: 'best-effort' });
  const pdf = await PDFDocument.load(result.bytes);
  const text = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, value]) => (value instanceof PDFRawStream ? [value] : []))
    .filter((stream) => stream.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image'))
    .map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode()))
    .join('\n');
  // The picture: a region rectangle, then the picture's own frame, then the image.
  const pictureClip =
    /q ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re W n [\d.]+ [\d.]+ m [^\n]* Do Q/.exec(text);
  expect(pictureClip).not.toBeNull();
  const [left, , width] = pictureClip!.slice(1, 4).map(Number) as [number, number, number];
  // The cell starts at the 72pt margin and is 200pt wide.
  expect(left + width).toBeGreaterThan(270);
  expect(left + width).toBeLessThan(273);
  // The frame of the picture reaches past that edge, so only the region rectangle cuts it.
  expect(text).toMatch(/322(\.\d+)? [\d.]+ l/);
  // The group text paints past the group, inside a region rectangle with the same right edge.
  const textClips = [...text.matchAll(/q 0 0 ([\d.]+) [\d.]+ re W n/g)].map((match) =>
    Number(match[1])
  );
  expect(textClips.some((right) => right > 270 && right < 273)).toBe(true);
});
