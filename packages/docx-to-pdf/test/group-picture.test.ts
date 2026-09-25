/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function pictureMember(y: number): string {
  return (
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:off x="0" y="${y}"/><a:ext cx="1270000" cy="635000"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
  );
}

const BAR_MEMBER =
  '<wps:wsp><wps:cNvSpPr/><wps:spPr>' +
  '<a:xfrm><a:off x="0" y="1270000"/><a:ext cx="1270000" cy="12700"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>';

/** A page-anchored group at (72pt, 72pt), 100pt x 200pt, behind the text. */
function input(members: string): Uint8Array {
  return docx(
    `<w:p><w:r><mc:AlternateContent
      xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
      xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
      xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
      xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
      xmlns:v="urn:schemas-microsoft-com:vml"><mc:Choice Requires="wpg"><w:drawing>
      <wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1"
        behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>
      <wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH>
      <wp:positionV relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionV>
      <wp:extent cx="1270000" cy="2540000"/><wp:wrapNone/><wp:docPr id="1" name="Group"/>
      <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">
      <wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/>
      <a:ext cx="1270000" cy="2540000"/><a:chOff x="0" y="0"/><a:chExt cx="1270000" cy="2540000"/>
      </a:xfrm></wpg:grpSpPr>${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor>
      </w:drawing></mc:Choice><mc:Fallback><w:pict><v:group id="Group"/></w:pict></mc:Fallback>
      </mc:AlternateContent></w:r><w:r><w:t>Text</w:t></w:r></w:p>`,
    {
      'word/_rels/document.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
      'word/media/image1.png': PNG_1X1,
    }
  );
}

async function pageCommands(bytes: Uint8Array) {
  const result = await exportPdf(bytes, { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  const resources = pdf.getPage(0).node.Resources()!;
  const images = resources.lookup(PDFName.of('XObject'), PDFDict);
  const commands = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, value]) =>
      value instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(value).decode())]
        : []
    )
    .filter((text) => text.includes(' Do Q') || text.includes(' rg'))
    .join('\n');
  return { imageCount: images?.keys().length ?? 0, commands };
}

test('a group picture paints in its member frame, under the vector members', async () => {
  const { imageCount, commands } = await pageCommands(input(pictureMember(0) + BAR_MEMBER));
  expect(imageCount).toBe(1);
  // Clipped to the 100pt x 200pt group at (72pt, 72pt) on the 792pt page; the image fills
  // only the 100pt x 50pt picture member at the top of the group.
  expect(commands).toMatch(
    /q 72 720 m 172 720 l 172 520 l 72 520 l h W n 100 0 0 50 72 670 cm \/Im\d+ Do Q/
  );
  const image = commands.search(/\/Im\d+ Do/);
  const bar = commands.indexOf('1 0 0 rg');
  expect(image).toBeGreaterThan(-1);
  expect(bar).toBeGreaterThan(image);
});

test('a group with only a picture paints it at its offset inside the group', async () => {
  const { imageCount, commands } = await pageCommands(input(pictureMember(635000)));
  expect(imageCount).toBe(1);
  // The member starts 50pt below the group top: PDF y = 792 - 72 - 50 - 50.
  expect(commands).toMatch(/100 0 0 50 72 620 cm \/Im\d+ Do Q/);
});

test('a group with two pictures still exports no image', async () => {
  const { imageCount } = await pageCommands(input(pictureMember(0) + pictureMember(635000)));
  expect(imageCount).toBe(0);
});
