// A behind-text drawing group in a header, anchored to the column and the paragraph, with a
// picture member and a line member. The header layer moves the drawing from story to sheet
// coordinates; the picture frame must move with it, or it paints offset by the header's own
// position on the page while the line paints in place.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  CT_NS,
  DRAWING_NS,
  IMG_REL,
  OD_REL,
  PNG_1X1,
  REL_NS,
  mountWithImages,
} from './image-decode-harness.ts';

const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const HDR_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';

/** Group child space 7200 x 3600 at 0, drawn at 360 x 180pt: 1 child unit = 0.05pt. */
const GROUP_CX = 360 * 12_700;
const GROUP_CY = 180 * 12_700;

const PICTURE =
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:off x="4000" y="3000"/><a:ext cx="2000" cy="400"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';

const LINE =
  '<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="200" y="0"/><a:ext cx="100" cy="3000"/>' +
  '</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '<a:solidFill><a:srgbClr val="000000"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>';

const GROUP =
  '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
  'relativeHeight="10" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="column"><wp:posOffset>-127000</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>1270000</wp:posOffset></wp:positionV>' +
  `<wp:extent cx="${GROUP_CX}" cy="${GROUP_CY}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
  '<wp:wrapNone/><wp:docPr id="1" name="Group 1"/>' +
  `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
  `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${GROUP_CX}" cy="${GROUP_CY}"/>` +
  '<a:chOff x="0" y="0"/><a:chExt cx="7200" cy="3600"/></a:xfrm></wpg:grpSpPr>' +
  `${PICTURE}${LINE}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;

function docx(): Uint8Array {
  const image = `<Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rIdHdr" Type="${HDR_REL}" Target="header1.xml"/></Relationships>`
    ),
    'word/_rels/header1.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">${image}</Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
    'word/header1.xml': strToU8(
      `<w:hdr ${DRAWING_NS} xmlns:wpg="${WPG}"><w:p>${GROUP}</w:p></w:hdr>`
    ),
    'word/document.xml': strToU8(
      `<w:document ${DRAWING_NS}><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p>` +
        '<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/>' +
        '<w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

const px = (value: string) => Number.parseFloat(value);

test('a header group picture paints at its member frame inside the group', async () => {
  const { surface, container } = await mountWithImages(docx());
  try {
    const frame = container.querySelector<HTMLElement>('.docx-drawing-image-frame');
    expect(frame).not.toBeNull();
    const group = frame!.closest<HTMLElement>('.docx-drawing')!;
    // The paint scale, from the group's painted width.
    const scale = px(group.style.width) / 360;
    expect(scale).toBeGreaterThan(0);
    // The picture sits at child (4000, 3000) of 7200 x 3600: (200pt, 150pt) in the group.
    expect(px(frame!.style.left) / scale).toBeCloseTo(200, 1);
    expect(px(frame!.style.top) / scale).toBeCloseTo(150, 1);
    expect(px(frame!.style.width) / scale).toBeCloseTo(100, 1);
    expect(px(frame!.style.height) / scale).toBeCloseTo(20, 1);
  } finally {
    surface.destroy();
    container.remove();
  }
});
