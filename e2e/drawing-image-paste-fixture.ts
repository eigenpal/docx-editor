import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const EMU = 12_700;

/** A 1x1 PNG: the picture in the document and the pasted file. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const spPr = (cx: number, cy: number, fill: string) =>
  `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` +
  '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr>';

/** A floating drawing in front of the text, offset from the paragraph's left margin. */
function anchor(id: number, name: string, y: number, cy: number, uri: string, graphic: string) {
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ` +
    `relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="margin"><wp:posOffset>${300 * EMU}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="margin"><wp:posOffset>${y * EMU}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${120 * EMU}" cy="${cy * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${id}" name="${name}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic><a:graphicData uri="${uri}">${graphic}</a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>'
  );
}

const picture =
  `<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Logo"/><pic:cNvPicPr/></pic:nvPicPr>` +
  '<pic:blipFill><a:blip r:embed="pic"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${120 * EMU}" cy="${60 * EMU}"/></a:xfrm>` +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';
const shape = `<wps:wsp><wps:cNvSpPr/>${spPr(120 * EMU, 60 * EMU, '9DC3E6')}<wps:bodyPr/></wps:wsp>`;
const textBox =
  `<wps:wsp><wps:cNvSpPr txBox="1"/>${spPr(120 * EMU, 60 * EMU, 'FFFFFF')}` +
  '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Boxed</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
  '<wps:bodyPr/></wps:wsp>';

const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;

/** A floating picture, shape and text box, each anchored in its own paragraph. */
export function drawingPasteFixture(): Buffer {
  const body =
    `<w:p>${run('Alpha')}${anchor(1, 'Logo', 0, 60, PIC, picture)}</w:p>` +
    `<w:p>${run('Bravo')}${anchor(2, 'Shape', 120, 60, WPS, shape)}</w:p>` +
    `<w:p>${run('Charlie')}${anchor(3, 'Box', 240, 60, WPS, textBox)}</w:p>` +
    `<w:p>${run('Delta')}</w:p>` +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="png" ContentType="image/png"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="pic" Type="${R}/image" Target="media/pic.png"/></Relationships>`
      ),
      'word/media/pic.png': PNG_1X1,
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
          `xmlns:pic="${PIC}" xmlns:wps="${WPS}"><w:body>${body}</w:body></w:document>`
      ),
    })
  );
}
