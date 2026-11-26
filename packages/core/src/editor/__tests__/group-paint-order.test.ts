// A full-page header decoration that some PDF converters write: one drawing group that holds
// a background picture, a filled band (custom geometry), a logo picture on the band, and a
// rule (custom geometry). The members overlap, so their order shows: the band covers the
// bottom of the background picture, and the logo sits on the band.
//
// A group paints its members in document order (`wpg:grpSp`, CT_WordprocessingGroup; ECMA-376 Part 1,
// 20.4.2.32). The group used to show an "Unsupported shape group" placeholder over the whole
// page, because a picture came after a shape.

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
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';
const HDR_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';

/** The group fills a US Letter page: 612 x 758pt in EMU, child space at the same scale. */
const CX = 7_772_400;
const CY = 9_628_505;

function picture(id: number, rel: string, x: number, y: number, cx: number, cy: number): string {
  return (
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Image ${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rel}" cstate="print"/><a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill><pic:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/>` +
    '</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
  );
}

/** A custom geometry band, filled, with no outline. */
const BAND =
  '<wps:wsp><wps:cNvPr id="7" name="Graphic 7"/><wps:cNvSpPr/><wps:spPr>' +
  `<a:xfrm><a:off x="0" y="7721964"/><a:ext cx="${CX}" cy="1906905"/></a:xfrm>` +
  '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/>' +
  `<a:pathLst><a:path w="${CX}" h="1906905"><a:moveTo><a:pt x="7772399" y="1906510"/></a:moveTo>` +
  '<a:lnTo><a:pt x="0" y="1906510"/></a:lnTo><a:lnTo><a:pt x="0" y="0"/></a:lnTo>' +
  '<a:lnTo><a:pt x="7772399" y="0"/></a:lnTo><a:lnTo><a:pt x="7772399" y="1906510"/></a:lnTo>' +
  '<a:close/></a:path></a:pathLst></a:custGeom>' +
  '<a:solidFill><a:srgbClr val="385381"/></a:solidFill></wps:spPr>' +
  '<wps:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0"><a:noAutofit/></wps:bodyPr></wps:wsp>';

/** A custom geometry rule: an open path with an outline, and a path that states no height. */
const RULE =
  '<wps:wsp><wps:cNvPr id="9" name="Graphic 9"/><wps:cNvSpPr/><wps:spPr>' +
  '<a:xfrm><a:off x="2642615" y="1725729"/><a:ext cx="2487295" cy="1270"/></a:xfrm>' +
  '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/>' +
  '<a:pathLst><a:path w="2487295"><a:moveTo><a:pt x="0" y="0"/></a:moveTo>' +
  '<a:lnTo><a:pt x="2487167" y="0"/></a:lnTo></a:path></a:pathLst></a:custGeom>' +
  '<a:ln w="19049"><a:solidFill><a:srgbClr val="EC7D2F"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
  '</wps:spPr><wps:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0"><a:noAutofit/></wps:bodyPr></wps:wsp>';

const MEMBERS =
  picture(6, 'rId1', 499_559, 0, 6_773_280, 9_198_548) +
  BAND +
  picture(8, 'rId2', 1_390_129, 8_044_009, 4_991_099, 1_047_749) +
  RULE;

const GROUP =
  '<w:r><mc:AlternateContent><mc:Choice Requires="wpg"><w:drawing>' +
  '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251661312" ' +
  'behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="page"><wp:posOffset>-16008</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="page"><wp:posOffset>424741</wp:posOffset></wp:positionV>' +
  `<wp:extent cx="${CX}" cy="${CY}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
  '<wp:docPr id="5" name="Group 5"/><wp:cNvGraphicFramePr/>' +
  `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
  `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${CX}" cy="${CY}"/>` +
  `<a:chOff x="0" y="0"/><a:chExt cx="${CX}" cy="${CY}"/></a:xfrm></wpg:grpSpPr>` +
  `${MEMBERS}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing>` +
  '</mc:Choice><mc:Fallback><w:pict><v:group/></w:pict></mc:Fallback></mc:AlternateContent></w:r>';

function docx(): Uint8Array {
  const namespaces = `${DRAWING_NS} xmlns:wpg="${WPG}" xmlns:mc="${MC}" xmlns:v="${V}"`;
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
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${IMG_REL}" Target="media/image1.png"/>` +
        `<Relationship Id="rId2" Type="${IMG_REL}" Target="media/image2.png"/></Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
    // A second part with other bytes, so the two pictures are two resources.
    'word/media/image2.png': Uint8Array.from([...PNG_1X1]),
    'word/header1.xml': strToU8(`<w:hdr ${namespaces}><w:p>${GROUP}</w:p></w:hdr>`),
    'word/document.xml': strToU8(
      `<w:document ${DRAWING_NS}><w:body><w:p><w:r><w:t>GENERAL LIABILITY</w:t></w:r></w:p>` +
        '<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/>' +
        '<w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

test('a header group paints picture, band, picture, rule in document order', async () => {
  const { surface, container } = await mountWithImages(docx());
  try {
    expect(container.querySelector('.docx-drawing-placeholder')).toBeNull();
    const group = container.querySelector<HTMLElement>('.docx-drawing-ready');
    expect(group).not.toBeNull();
    // One frame for each layer, lowest first: the background, the band, the logo, the rule.
    const layers = Array.from(group!.children).filter((child) =>
      child.classList.contains('docx-drawing-image-frame')
    );
    const kinds = layers.map((layer) => {
      if (layer.querySelector('img')) return 'picture';
      const path = layer.querySelector('svg path');
      return path?.getAttribute('fill') !== 'none'
        ? `fill ${path?.getAttribute('fill')}`
        : `stroke ${path?.getAttribute('stroke')}`;
    });
    expect(kinds).toEqual(['picture', 'fill #385381', 'picture', 'stroke #EC7D2F']);
    // The logo keeps its place against the background picture: on the band, near the foot.
    // An offset of zero has no style entry.
    const px = (value: string) => Number.parseFloat(value) || 0;
    const background = layers[0] as HTMLElement;
    const logo = layers[2] as HTMLElement;
    const scale = px(background.style.width) / (6_773_280 / 12_700);
    expect((px(logo.style.top) - px(background.style.top)) / scale).toBeCloseTo(
      8_044_009 / 12_700,
      1
    );
    expect((px(logo.style.left) - px(background.style.left)) / scale).toBeCloseTo(
      (1_390_129 - 499_559) / 12_700,
      1
    );
  } finally {
    surface.destroy();
    container.remove();
  }
});
